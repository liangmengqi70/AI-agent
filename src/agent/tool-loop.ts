import 'server-only';
// 推理循环：大模型决定调用哪个工具 → 程序执行 → 把结果交回大模型，直到它说"调查完毕"或达到步数上限。
// 调查步数用完时进入"收尾阶段"：只允许调用指定的工具（如提交建议），让模型把已有结论落成建议。
import { callTools, MODELS, type ChatMessage, type ToolCall } from '@/llm/client';
import type { Tool, ToolContext } from './tools';

export type LoopStep = { tool: string; args: unknown; plain: string; result: unknown; phase: 'investigate' | 'wrap_up' };

type Options = {
  task: string; promptVersion: string; system: string; user: string; tools: Tool[]; ctx: ToolContext;
  maxSteps: number; visitorId: string; onStep: (step: LoopStep, seq: number) => Promise<void>;
  /** 剩余几步时提醒模型尽快下结论 */
  remindAt?: number;
  /** 步数用完后的收尾阶段 */
  wrapUp?: { toolNames: string[]; prompt: string; maxCalls: number };
};

export async function runToolLoop(opt: Options) {
  const messages: ChatMessage[] = [{ role: 'system', content: opt.system }, { role: 'user', content: opt.user }];
  const steps: LoopStep[] = [];
  let final = '';
  let reminded = false;

  const execute = async (call: ToolCall, allowed: Tool[], phase: LoopStep['phase']) => {
    const tool = allowed.find(t => t.name === call.function.name);
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* 参数不是合法 JSON，按空参数处理 */ }
    let result: unknown;
    if (!tool) result = { 错误: `现在不能调用 ${call.function.name}` };
    else {
      try { result = await tool.run(args, opt.ctx); } catch (e) { result = { 错误: e instanceof Error ? e.message : String(e) }; }
      const step = { tool: tool.name, args, plain: tool.plain(args, opt.ctx), result, phase };
      steps.push(step);
      await opt.onStep(step, steps.length);
    }
    messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
  };
  const ask = (tools: Tool[]) => callTools({
    task: opt.task, promptVersion: opt.promptVersion, model: MODELS.reason(), messages, visitorId: opt.visitorId,
    tools: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })),
  });

  // 1. 调查阶段
  let hitLimit = false;
  while (true) {
    const reply = await ask(opt.tools);
    messages.push(reply);
    if (!reply.tool_calls?.length) { final = reply.content ?? ''; break; }
    for (const call of reply.tool_calls) {
      if (steps.length >= opt.maxSteps) { messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ 错误: '调查步数已用完' }) }); continue; }
      await execute(call, opt.tools, 'investigate');
    }
    if (steps.length >= opt.maxSteps) { hitLimit = true; break; }
    if (opt.remindAt && !reminded && opt.maxSteps - steps.length <= opt.remindAt) {
      reminded = true;
      messages.push({ role: 'user', content: `还剩 ${opt.maxSteps - steps.length} 步。如果已经找到原因，请现在用 propose_change 提交建议，不要再做重复的查询。` });
    }
  }

  // 2. 收尾阶段：步数用完时，只允许提交建议
  if (hitLimit && opt.wrapUp) {
    const allowed = opt.tools.filter(t => opt.wrapUp!.toolNames.includes(t.name));
    messages.push({ role: 'user', content: opt.wrapUp.prompt });
    let calls = 0;
    while (calls < opt.wrapUp.maxCalls) {
      const reply = await ask(allowed);
      messages.push(reply);
      if (!reply.tool_calls?.length) { final = reply.content ?? ''; break; }
      for (const call of reply.tool_calls) {
        if (calls >= opt.wrapUp.maxCalls) { messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ 错误: '已达到提交上限' }) }); continue; }
        calls++;
        await execute(call, allowed, 'wrap_up');
      }
    }
  }
  return { steps, final };
}
