import assert from "node:assert/strict";
import {
  Type,
  getCurrentSystemMessage,
  getCurrentSystemPrompt,
  getCurrentTools,
  toToolDeclaration,
  type SystemMessage,
} from "../pi/packages/ai/src/index.ts";
import { Agent, type AgentTool, type StreamFn } from "../pi/packages/agent/src/index.ts";
import { assistant, model, streamMessage } from "./mock-model.ts";

// 使用真实 Agent Core，只把模型响应替换成可重复的本地脚本。
const modelA = { ...model, id: "model-A", name: "计算模型 A" };
const modelB = { ...model, id: "model-B", name: "总结模型 B" };
const parameters = Type.Object({ a: Type.Number(), b: Type.Number() });
const add: AgentTool<typeof parameters, { sum: number }> = {
  name: "add",
  label: "加法",
  description: "计算两个数的和",
  parameters,
  async execute(_id, { a, b }) {
    const sum = a + b;
    return { content: [{ type: "text", text: String(sum) }], details: { sum } };
  },
};

type Observation = {
  model: string;
  tools: string[];
  phase: string | null | undefined;
  legacy: string | null | undefined;
  requestContext: string | null | undefined;
};

async function runScenario(syncNextTurn: boolean) {
  console.log(`\n=== ${syncNextTurn ? "通过下一轮钩子同步" : "只修改公开 state"} ===`);
  const observations: Observation[] = [];
  let turns = 0;
  let requestPreparations = 0;
  let transforms = 0;
  let nextTurnPreparations = 0;
  let activeAtAgentEnd = false;

  const streamFn: StreamFn = (requestedModel, context) => {
    const sections = getCurrentSystemMessage(context.messages)?.sections;
    const observation: Observation = {
      model: requestedModel.id,
      tools: getCurrentTools(context.messages).map((tool) => tool.name),
      phase: sections?.phase,
      legacy: sections?.legacy,
      requestContext: sections?.request_context,
    };
    observations.push(observation);
    console.log(`请求 ${observations.length}：${JSON.stringify(observation)}`);

    const response = observations.length === 1
      ? assistant([{ type: "toolCall", id: "add-1", name: "add", arguments: { a: 2, b: 3 } }], "toolUse")
      : assistant([{ type: "text", text: "2 + 3 = 5" }]);
    return streamMessage({
      ...response,
      model: requestedModel.id,
      api: requestedModel.api,
      provider: requestedModel.provider,
    });
  };

  const agent = new Agent({
    initialState: {
      model: modelA,
      tools: [add],
      messages: [{
        role: "system",
        content: "你是一个计算助手。",
        sections: {
          phase: "<phase>调用工具计算</phase>",
          legacy: "<legacy>计算阶段临时规则</legacy>",
        },
        toolsAdded: [toToolDeclaration(add)],
        timestamp: 0,
      }],
    },
    streamFn,
    // 钩子在启动前安装；下一轮读取应用的最新配置。
    prepareNextTurnWithContext: syncNextTurn ? ({ context }) => {
      nextTurnPreparations++;
      console.log("prepareNextTurn：同步模型/工具，并追加具名 Prompt 更新。");
      return {
        context: { ...context, tools: agent.state.tools.slice() },
        model: agent.state.model,
        thinkingLevel: agent.state.thinkingLevel,
        messages: [{
          role: "system",
          content: "",
          sections: { phase: "<phase>根据结果总结</phase>", legacy: null },
          timestamp: Date.now(),
        }],
      };
    } : undefined,
    prepareRequest: () => {
      requestPreparations++;
      console.log(`prepareRequest：第 ${requestPreparations} 次，包括首次请求。`);
      // 此示例仅观察调用时机；此处也可返回请求的 model/context 更新。
    },
    transformContext: async (messages) => {
      transforms++;
      // 返回新数组。这里是应用自己生成的可信信息，不是检索来的外部指令。
      // 它只出现在本次请求，不会通过 message_end 保存到 Agent.state。
      return [...messages, {
        role: "system",
        content: "",
        sections: { request_context: `<request_context>本次请求序号 ${transforms}</request_context>` },
        timestamp: Date.now(),
      }];
    },
  });

  agent.subscribe((event) => {
    if (event.type === "message_end") {
      // Core 先更新公开 state，再等待应用订阅者。
      assert.ok(agent.state.messages.includes(event.message));
      if (event.message.role === "system") {
        console.log(`保存 system 更新：${JSON.stringify(event.message)}`);
      }
    }
    if (event.type === "tool_execution_start") {
      assert.ok(agent.state.pendingToolCalls.has(event.toolCallId));
    }
    if (event.type === "tool_execution_end") {
      assert.equal(agent.state.pendingToolCalls.has(event.toolCallId), false);
    }
    if (event.type === "turn_end" && ++turns === 1) {
      agent.state.model = modelB;
      agent.state.tools = [];
      console.log("应用设置 state.model = B，state.tools = []；当前循环不会自动重新取快照。");
    }
    if (event.type === "agent_end") {
      activeAtAgentEnd = agent.state.isStreaming;
    }
  });

  await agent.prompt("计算 2 + 3，然后总结。");
  assert.equal(agent.state.errorMessage, undefined);
  assert.equal(observations.length, 2);
  assert.equal(requestPreparations, 2);
  assert.equal(nextTurnPreparations, syncNextTurn ? 1 : 0);
  assert.deepEqual(observations.map((item) => item.model), ["model-A", syncNextTurn ? "model-B" : "model-A"]);
  assert.deepEqual(observations.map((item) => item.tools), [["add"], syncNextTurn ? [] : ["add"]]);
  assert.equal(observations[1].phase, syncNextTurn ? "<phase>根据结果总结</phase>" : "<phase>调用工具计算</phase>");
  assert.equal(observations[1].legacy, syncNextTurn ? undefined : "<legacy>计算阶段临时规则</legacy>");
  assert.ok(observations[0].requestContext?.includes("请求序号 1"));
  assert.ok(observations[1].requestContext?.includes("请求序号 2"));
  assert.equal(agent.state.systemPrompt.includes("request_context"), false);
  assert.equal(agent.state.model.id, "model-B");
  assert.deepEqual(agent.state.tools, []);
  assert.equal(activeAtAgentEnd, true);
  assert.equal(agent.state.isStreaming, false);
  assert.equal(agent.state.pendingToolCalls.size, 0);
  assert.equal(agent.state.streamingMessage, undefined);

  const updates = agent.state.messages.filter((message) => message.role === "system").slice(1);
  assert.equal(updates.length, syncNextTurn ? 1 : 0);
  if (syncNextTurn) {
    assert.deepEqual(updates[0].toolsRemoved, [{ name: "add" }]);
    assert.equal(getCurrentSystemMessage(agent.state.messages)?.sections?.legacy, undefined);
  }
  console.log(`最终公开 Prompt：\n${agent.state.systemPrompt}`);
  console.log("通过：请求配置、system 补丁、临时上下文和 idle 时机均符合断言。");
}

await runScenario(false);
await runScenario(true);

// content 是累加，具名 sections 才能覆盖和删除。
const replay: SystemMessage[] = [
  { role: "system", content: "基础规则", sections: { phase: "计算", old: "过期" }, timestamp: 0 },
  { role: "system", content: "补充规则", sections: { phase: "总结", old: null }, timestamp: 1 },
];
assert.equal(getCurrentSystemPrompt(replay), "基础规则\n\n补充规则\n\n总结");
console.log("\n通过：content 累加，sections 同名覆盖、null 删除；section 名不会自动变成正文标签。");
