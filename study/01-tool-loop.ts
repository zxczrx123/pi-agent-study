import assert from "node:assert/strict";
import { Type } from "../pi/packages/ai/src/index.ts";
import { Agent, type AgentTool, type StreamFn } from "../pi/packages/agent/src/index.ts";
import { assistant, model, streamMessage } from "./mock-model.ts";

const parameters = Type.Object({ a: Type.Number(), b: Type.Number() });
const add: AgentTool<typeof parameters, { sum: number }> = {
  name: "add",
  label: "加法",
  description: "计算两个数的和",
  parameters,
  async execute(_id, args, signal, onUpdate) {
    signal?.throwIfAborted();
    const sum = args.a + args.b;
    onUpdate?.({ content: [{ type: "text", text: "正在计算" }], details: { sum } });
    return { content: [{ type: "text", text: String(sum) }], details: { sum } };
  },
};

let requests = 0;
const streamFn: StreamFn = (_model, context) => {
  requests++;
  console.log(`\n模型请求 ${requests}，消息角色：${context.messages.map((m) => m.role).join(" → ")}`);
  if (requests === 1) {
    return streamMessage(assistant([
      { type: "toolCall", id: "add-1", name: "add", arguments: { a: 2, b: 3 } },
    ], "toolUse"));
  }
  const result = context.messages.at(-1);
  assert.equal(result?.role, "toolResult");
  if (result?.role !== "toolResult") throw new Error("缺少工具结果");
  assert.equal(result.isError, false);
  assert.deepEqual(result.content, [{ type: "text", text: "5" }]);
  return streamMessage(assistant([{ type: "text", text: "2 + 3 = 5" }]));
};

const agent = new Agent({
  initialState: { systemPrompt: "使用 add 工具计算，然后回答。", model, tools: [add] },
  streamFn,
});

agent.subscribe((event) => {
  const role = "message" in event ? ` [${event.message.role}]` : "";
  console.log(`${event.type}${role}`);
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    console.log(`  文本增量：${event.assistantMessageEvent.delta}`);
  }
});

await agent.prompt("请计算 2 + 3");
assert.equal(requests, 2);
assert.equal(agent.state.isStreaming, false);
assert.deepEqual(agent.state.messages.map((m) => m.role), ["system", "user", "assistant", "toolResult", "assistant"]);
console.log("\n通过：真实源码完成了两次模型调用、一次工具执行，并保留完整消息历史。");
