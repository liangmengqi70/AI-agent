import 'server-only';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { db } from '@/db/pool';
import { UserFacingError } from '@/lib/api';
import { assertLlmQuota } from './quota';

// 大模型统一客户端：要求返回 JSON → 用 zod 校验 → 不合格自动重试 1 次 → 每次调用写入 llm_calls
export const MODELS = {
  fast: () => process.env.DEEPSEEK_FAST_MODEL?.trim() || 'deepseek-flash',
  reason: () => process.env.DEEPSEEK_REASON_MODEL?.trim() || 'deepseek-v4-pro',
};

type CallOptions<T> = {
  task: string;              // 任务名，如 extract-profile
  promptVersion: string;     // 提示词版本，修改提示词时 +1
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  visitorId?: string | null;
  maxTokens?: number;
  timeoutMs?: number;
  thinking?: boolean;        // 是否让模型先思考；快速任务关闭，避免把输出额度用在思考上
};

export class LlmError extends UserFacingError {}

/** 服务繁忙（429）或临时故障（5xx）时等一会儿重试，最多重试 3 次；其他错误直接返回 */
const RETRY_DELAYS = [2000, 5000, 12000];
async function postChat(baseUrl: string, apiKey: string, body: unknown, timeoutMs: number): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).finally(() => clearTimeout(timer));
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= RETRY_DELAYS.length) return res;
    const after = Number(res.headers.get('retry-after')) * 1000;
    await new Promise(r => setTimeout(r, after > 0 ? Math.min(after, 30_000) : RETRY_DELAYS[attempt] * (0.75 + Math.random() * 0.5)));
  }
}

export async function callJson<T>(opt: CallOptions<T>): Promise<T> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new LlmError('尚未配置大模型 Key，请在 .env.local 中填写 DEEPSEEK_API_KEY', 503);
  await assertLlmQuota(opt.visitorId); // 每日调用上限
  const baseUrl = (process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com').replace(/\/$/, '');
  const inputHash = createHash('sha256').update(`${opt.task}|${opt.promptVersion}|${opt.system}|${opt.user}`).digest('hex');

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: opt.system },
    { role: 'user', content: opt.user },
  ];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    let raw = '', usage: { prompt_tokens?: number; completion_tokens?: number } = {};
    try {
      const res = await postChat(baseUrl, apiKey, {
        model: opt.model, temperature: 0.1, max_tokens: opt.maxTokens ?? 4096,
        response_format: { type: 'json_object' }, messages,
        ...(opt.thinking ? {} : { thinking: { type: 'disabled' } }),
      }, opt.timeoutMs ?? 90_000);
      if (!res.ok) throw new LlmError(httpMessage(res.status), 503);
      const body = await res.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: typeof usage };
      raw = body.choices?.[0]?.message?.content ?? '';
      usage = body.usage ?? {};
    } catch (error) {
      await logCall(opt, inputHash, started, usage, false, error instanceof Error ? error.message : String(error));
      if (error instanceof LlmError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw new LlmError('AI 分析超时，请稍后重试', 504);
      throw new LlmError('无法连接大模型服务，请检查网络后重试', 503);
    }

    // 校验格式
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
    const result = opt.schema.safeParse(parsed);
    if (result.success) {
      await logCall(opt, inputHash, started, usage, true, null);
      return result.data;
    }
    const problem = result.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    await logCall(opt, inputHash, started, usage, false, `格式不合格：${problem}`.slice(0, 500));
    // 把错误告诉模型，重试一次
    messages.push({ role: 'assistant', content: raw }, { role: 'user', content: `你的输出不符合要求的 JSON 格式（${problem}）。请只输出修正后的完整 JSON。` });
  }
  throw new LlmError('AI 返回的内容格式不正确，请稍后重试', 502);
}

/* ========== 工具调用（复盘推理循环用）========== */
export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; reasoning_content?: string }
  | { role: 'tool'; tool_call_id: string; content: string };

/** 一次对话请求：模型可以选择调用工具或直接回答。调用方负责执行工具并继续循环。 */
export async function callTools(opt: {
  task: string; promptVersion: string; model: string; messages: ChatMessage[]; tools: ToolDef[];
  visitorId?: string | null; maxTokens?: number; timeoutMs?: number;
}): Promise<Extract<ChatMessage, { role: 'assistant' }>> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new LlmError('尚未配置大模型 Key，请在 .env.local 中填写 DEEPSEEK_API_KEY', 503);
  await assertLlmQuota(opt.visitorId); // 每日调用上限
  const baseUrl = (process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com').replace(/\/$/, '');
  const log = { task: opt.task, promptVersion: opt.promptVersion, model: opt.model, visitorId: opt.visitorId } as CallOptions<unknown>;
  const inputHash = createHash('sha256').update(`${opt.task}|${JSON.stringify(opt.messages)}`).digest('hex');
  const started = Date.now();
  let usage: { prompt_tokens?: number; completion_tokens?: number } = {};
  try {
    const res = await postChat(baseUrl, apiKey, {
      model: opt.model, temperature: 0.2, max_tokens: opt.maxTokens ?? 2048, messages: opt.messages,
      tools: opt.tools.map(t => ({ type: 'function', function: t })), thinking: { type: 'disabled' },
    }, opt.timeoutMs ?? 120_000);
    if (!res.ok) throw new LlmError(httpMessage(res.status), 503);
    const body = await res.json() as { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[]; reasoning_content?: string } }>; usage?: typeof usage };
    usage = body.usage ?? {};
    const m = body.choices?.[0]?.message;
    if (!m) throw new LlmError('AI 没有返回内容', 502);
    await logCall(log, inputHash, started, usage, true, null);
    return { role: 'assistant', content: m.content ?? null, ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) };
  } catch (error) {
    await logCall(log, inputHash, started, usage, false, error instanceof Error ? error.message : String(error));
    if (error instanceof LlmError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new LlmError('AI 分析超时，请稍后重试', 504);
    throw new LlmError('无法连接大模型服务，请检查网络后重试', 503);
  }
}

function httpMessage(status: number) {
  if (status === 401 || status === 403) return '大模型 Key 无效或没有权限，请检查配置';
  if (status === 402) return '大模型账户余额不足';
  if (status === 429) return '大模型请求较多，请稍后重试';
  return '大模型服务暂时不可用，请稍后重试';
}

async function logCall<T>(opt: CallOptions<T>, inputHash: string, started: number, usage: { prompt_tokens?: number; completion_tokens?: number }, ok: boolean, error: string | null) {
  try {
    await db().query(
      `INSERT INTO llm_calls (visitor_id, task, model, prompt_version, input_hash, input_tokens, output_tokens, latency_ms, ok, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [opt.visitorId ?? null, opt.task, opt.model, opt.promptVersion, inputHash, usage.prompt_tokens ?? null, usage.completion_tokens ?? null, Date.now() - started, ok, error],
    );
  } catch (e) { console.error('写入 llm_calls 失败', e); }
}
