import { Agent, type AgentTool } from "../pi/packages/agent/src/index.ts";
import { createModels, Type } from "../pi/packages/ai/src/index.ts";
import { anthropicProvider } from "../pi/packages/ai/src/providers/anthropic.ts";

const models = createModels();
models.setProvider(anthropicProvider());
const modelId = process.env.PI_STUDY_MODEL ?? "claude-sonnet-4-6";
const model = models.getModel("anthropic", modelId);
if (!model) throw new Error(`本地模型目录中没有 ${modelId}`);

const parameters = Type.Object({ a: Type.Number(), b: Type.Number() });
const add: AgentTool<typeof parameters, { sum: number }> = {
  name: "add",
  label: "加法",
  description: "计算两个数字的和",
  parameters,
  async execute(_id, args) {
    const sum = args.a + args.b;
    return { content: [{ type: "text", text: String(sum) }], details: { sum } };
  },
};

let turns = 0;
const agent = new Agent({
  initialState: { model, systemPrompt: "回答计算问题时先调用 add 工具。用中文回答。", tools: [add] },
  streamFn: models.streamSimple.bind(models),
  finishTurn: () => (++turns >= 4 ? { action: "end" } : undefined),
});

agent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
  if (event.type === "tool_execution_start") console.log(`\n工具调用：${event.toolName}`);
});

if (process.argv.includes("--check")) {
  console.log(`初始化通过：${model.provider}/${model.id}；没有发送模型请求。`);
} else {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("请先在当前终端设置 ANTHROPIC_API_KEY，再运行 demo:live。");
  await agent.prompt("请使用 add 工具计算 19 + 23，再简短回答结果。");
  console.log();
  if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
}
