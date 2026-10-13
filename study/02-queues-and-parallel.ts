import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Type, contentText } from "../pi/packages/ai/src/index.ts";
import { Agent, type AgentTool, type StreamFn } from "../pi/packages/agent/src/index.ts";
import { assistant, model, streamMessage } from "./mock-model.ts";

const sequential = process.argv.includes("--sequential");
const parameters = Type.Object({ name: Type.String(), milliseconds: Type.Number() });
const wait: AgentTool<typeof parameters, { name: string }> = {
  name: "wait",
  label: "等待",
  description: "等待指定毫秒数后返回名称",
  parameters,
  async execute(_id, args, signal) {
    await delay(args.milliseconds, undefined, { signal });
    return { content: [{ type: "text", text: args.name }], details: { name: args.name } };
  },
};

let requests = 0;
const completionOrder: string[] = [];
const savedOrder: string[] = [];
const injectedMessages: string[] = [];
const streamFn: StreamFn = (_model, context) => {
  requests++;
  if (requests === 1) {
    return streamMessage(assistant([
      { type: "toolCall", id: "slow", name: "wait", arguments: { name: "slow", milliseconds: 80 } },
      { type: "toolCall", id: "fast", name: "wait", arguments: { name: "fast", milliseconds: 10 } },
    ], "toolUse"));
  }
  const last = context.messages.at(-1);
  assert.equal(last?.role, "user");
  if (last?.role !== "user") throw new Error("未收到排队消息");
  const text = contentText(last.content);
  injectedMessages.push(text);
  console.log(`模型请求 ${requests} 收到：${text}`);
  return streamMessage(assistant([{ type: "text", text: `已处理：${text}` }]));
};

const agent = new Agent({
  initialState: { model, tools: [wait] },
  streamFn,
  toolExecution: sequential ? "sequential" : "parallel",
  beforeToolCall: async ({ assistantMessage }) => {
    // message_end 已经更新了 Agent.state，随后才进行工具预检。
    // 串行模式下，前一个工具的结果此时也可能已经写入历史。
    assert.ok(agent.state.messages.includes(assistantMessage));
    return undefined;
  },
});

let queued = false;
agent.subscribe((event) => {
  if (event.type === "tool_execution_start" && !queued) {
    queued = true;
    agent.steer({ role: "user", content: "先用中文解释结果", timestamp: Date.now() });
    agent.followUp({ role: "user", content: "再给一句总结", timestamp: Date.now() });
    console.log("工具开始时加入 steer 和 followUp；工具继续执行。");
  }
  if (event.type === "tool_execution_end") {
    assert.equal(event.isError, false);
    completionOrder.push(event.toolCallId);
    console.log(`工具完成：${event.toolCallId}`);
  }
  if (event.type === "message_end" && event.message.role === "toolResult") {
    savedOrder.push(event.message.toolCallId);
    console.log(`消息写入：${event.message.toolCallId}`);
  }
});

console.log(`执行模式：${agent.toolExecution}`);
await agent.prompt("依次声明 slow 和 fast 两个工具调用");
assert.equal(requests, 3);
assert.deepEqual(completionOrder, sequential ? ["slow", "fast"] : ["fast", "slow"]);
assert.deepEqual(savedOrder, ["slow", "fast"]);
assert.deepEqual(injectedMessages, ["先用中文解释结果", "再给一句总结"]);
assert.equal(agent.hasQueuedMessages(), false);
console.log("\n通过：执行顺序、消息保存顺序、steer 和 followUp 的注入时机均符合预期。");
