// 简历文字提取：直接复用 ResumeIQ 的实现（src/lib/resume-text.ts），支持 PDF、DOCX，扫描版 PDF 自动识别文字。
// 修改时请同步考虑 ResumeIQ 中的同名文件。
import 'server-only';

import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

const maxResumeBytes = 10 * 1024 * 1024;
const maxResumeCharacters = 60_000;
const maxOcrPages = 8;
const maxOcrPayloadCharacters = 42 * 1024 * 1024;

export class ResumeTextError extends Error {}

function cleanText(value: string) {
  return value
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, maxResumeCharacters);
}

async function extractScannedPdf(parser: PDFParse, fileName: string) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new ResumeTextError('尚未配置 DeepSeek API Key，无法识别扫描版 PDF。');

  let screenshots;
  try {
    screenshots = await parser.getScreenshot({ desiredWidth: 1200, imageDataUrl: true });
  } catch {
    throw new ResumeTextError('无法渲染这份扫描版 PDF，请另存为清晰的 PDF 或 DOCX 后重试。');
  }
  if (screenshots.pages.length > maxOcrPages) throw new ResumeTextError(`扫描版 PDF 最多支持 ${maxOcrPages} 页，请精简简历后重试。`);

  const images = screenshots.pages.map((page, index) => ({
    type: 'file' as const,
    file_data: page.dataUrl || '',
    filename: `${fileName}-page-${index + 1}.png`,
  })).filter(item => item.file_data);
  if (!images.length || images.reduce((sum, item) => sum + item.file_data.length, 0) > maxOcrPayloadCharacters) {
    throw new ResumeTextError('扫描版 PDF 图像过大，请压缩文件或上传 DOCX 后重试。');
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com').replace(/\/$/, '');
  const model = process.env.DEEPSEEK_OCR_MODEL?.trim() || 'deepseek-flash';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        thinking: { type: 'disabled' },
        max_tokens: 16_000,
        messages: [{ role: 'user', content: [
          { type: 'text', text: '请按页面顺序完整识别这些简历图片中的文字。保留标题、段落、项目符号、日期和数字，只输出识别到的简历正文，不要评价、总结或使用 Markdown 代码围栏。看不清的内容标记为[无法识别]，不要猜测。' },
          ...images,
        ] }],
      }),
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new ResumeTextError('DeepSeek API Key 无效或没有 OCR 模型权限。');
      if (response.status === 402) throw new ResumeTextError('DeepSeek 账户余额不足，暂时无法识别扫描版 PDF。');
      if (response.status === 429) throw new ResumeTextError('扫描版 PDF 识别请求较多，请稍后重试。');
      throw new ResumeTextError('扫描版 PDF 识别失败，请稍后重试或上传 DOCX。');
    }
    const body = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null;
    return body?.choices?.[0]?.message?.content || '';
  } catch (error) {
    if (error instanceof ResumeTextError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new ResumeTextError('扫描版 PDF 识别超时，请稍后重试。');
    throw new ResumeTextError('无法连接 DeepSeek OCR 服务，请检查服务器网络后重试。');
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractResumeText(file: File) {
  if (!file.size) throw new ResumeTextError('简历文件为空，请返回重新上传。');
  if (file.size > maxResumeBytes) throw new ResumeTextError('简历文件不能超过 10MB。');

  const extension = file.name.split('.').pop()?.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = '';

  if (extension === 'pdf') {
    const parser = new PDFParse({ data: bytes });
    try {
      text = (await parser.getText()).text;
      if (cleanText(text).length < 40) text = await extractScannedPdf(parser, file.name.replace(/\.pdf$/i, ''));
    } catch (error) {
      if (error instanceof ResumeTextError) throw error;
      console.error('PDF resume extraction failed', error);
      if (text) throw new ResumeTextError('扫描版 PDF 识别失败，请稍后重试或上传 DOCX。');
      throw new ResumeTextError('无法读取这份 PDF。请确认文件未加密，或另存为可复制文字的 PDF 后重试。');
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } else if (extension === 'docx') {
    try {
      text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
    } catch {
      throw new ResumeTextError('无法读取这份 DOCX。请确认文件没有损坏后重试。');
    }
  } else if (extension === 'doc') {
    throw new ResumeTextError('暂不支持旧版 DOC 文件，请在 Word 中另存为 DOCX 或 PDF 后重新上传。');
  } else {
    throw new ResumeTextError('只支持 PDF、DOCX 格式的简历。');
  }

  const cleaned = cleanText(text);
  if (cleaned.length < 40) {
    throw new ResumeTextError('没有从简历中识别到足够的文字，请上传内容清晰的 PDF 或 DOCX。');
  }
  return cleaned;
}
