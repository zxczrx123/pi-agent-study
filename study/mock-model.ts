import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
} from "../pi/packages/ai/src/index.ts";

// 只提供模型元数据；所有响应均由本地脚本产生，没有网络请求。
export const model: Model<"openai-responses"> = {
  id: "study-mock",
  name: "Local study model",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192,
  maxTokens: 1024,
};

export function assistant(
  content: AssistantMessage["content"],
  stopReason: "stop" | "toolUse" = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

export function streamMessage(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    const partial: AssistantMessage = { ...message, content: [], stopReason: "pending" };
    stream.push({ type: "start", partial: structuredClone(partial) });
    for (const [contentIndex, block] of message.content.entries()) {
      if (block.type === "text") {
        partial.content.push({ type: "text", text: "" });
        stream.push({ type: "text_start", contentIndex, partial: structuredClone(partial) });
        partial.content[contentIndex] = block;
        stream.push({ type: "text_delta", contentIndex, delta: block.text, partial: structuredClone(partial) });
        stream.push({ type: "text_end", contentIndex, content: block.text, partial: structuredClone(partial) });
      } else {
        // 工具调用直接在最终消息中提供，方便先看清 agent loop。
        partial.content.push(block);
      }
    }
    stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
    stream.end();
  });
  return stream;
}
