import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 简历解析库需要从自己的包目录加载 PDF.js 等文件，保持为外部依赖（与 ResumeIQ 一致）
  serverExternalPackages: ['mammoth', 'pdf-parse'],
};

export default nextConfig;
