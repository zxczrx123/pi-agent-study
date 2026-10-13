# Pi Agent Core 学习资料

资料按学习顺序排列。当前版本行为优先参考本次下载的源码和测试；作者文章用于理解设计动机。在线 `main` 和 `latest` 会继续变化。

## 第一组：先读这些

| 优先级 | 资料 | 阅读目标 |
| --- | --- | --- |
| 1 | [本地中文源码解析](pi-agent-core-guide.md) | 建立 `Agent → agent-loop → streamFn → tools` 的整体认识 |
| 2 | [官方 Agent Core README，固定提交版](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/README.md) | API 用法、事件、steering/follow-up、工具钩子 |
| 3 | [官方 pi-ai README](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/ai/README.md) | 先读 Quick Start、Tools、Complete Event Reference、System Messages、Error Handling |
| 4 | [作者 Mario Zechner：What I learned building an opinionated and minimal coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) | 重点看 pi-ai and pi-agent-core、Structured split tool results、Minimal agent scaffold |
| 5 | [Agent Core CHANGELOG](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/CHANGELOG.md) | 解释旧教程中的包名、方法和职责为何不同 |

作者文章发表于 **2025-11-30**，本次源码获取于 **2026-10-13**。文章里有旧包名、旧路径和旧接口；例如早期 loop 所属目录、尚无工具进度流、没有 MCP 等描述已经发生变化。它对“明确控制上下文”“给模型和 UI 提供不同的工具结果”“减少运行框架的固定策略”的解释仍然值得读。

当前源码的工具校验使用 `typebox/compile`；不要因为旧文章提到 AJV 就到当前核心包里寻找 AJV 调用。

## 第二组：带着问题读实现和测试

关注状态和 Prompt 时，先读 [State 管理、Prompt 编排与动态更新](state-and-prompt.md)，再运行 [对照示例 04](../study/04-state-and-prompt.ts)。重点补充资料是 [system 重放测试](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/ai/test/system-message-replay.test.ts)、[工具声明更新测试](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/ai/test/transcript-tool-changes.test.ts) 和 [上层 Prompt 构造器](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/src/core/system-prompt.ts)。

| 问题 | 实现入口 | 可执行证据 |
| --- | --- | --- |
| 自定义消息怎么变成标准消息？ | [streamAssistantResponse](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent-loop.ts#L381) | [自定义消息测试](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/test/agent-loop.test.ts#L199) |
| transform 与 convert 的先后顺序？ | 同上 | [转换顺序测试](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/test/agent-loop.test.ts#L253) |
| 输出被截断后为什么不执行工具？ | [failToolCallsFromTruncatedMessage](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent-loop.ts#L478) | [截断测试](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/test/agent-loop.test.ts#L456) |
| 并行完成顺序为什么不同于消息顺序？ | [executeToolCallsParallel](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent-loop.ts#L586) | [并行顺序测试](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/test/agent-loop.test.ts#L668) |
| steering 会不会跳过本批工具？ | [runLoop](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent-loop.ts#L163) | [队列注入测试](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/test/agent-loop.test.ts#L762) |
| 某个工具要求串行时怎么处理？ | [executeToolCalls](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent-loop.ts#L508) | [混合工具模式测试](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/test/agent-loop.test.ts#L949) |
| finishTurn 如何停止本次运行？ | [runLoop](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent-loop.ts#L163) | [停止后不抽取队列的测试](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/test/agent-loop.test.ts#L1217) |
| 多个工具中只有一个 terminate 会停止吗？ | [shouldTerminateToolBatch](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent-loop.ts#L690) | [混合终止结果测试](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/test/agent-loop.test.ts#L1899) |
| prompt 是否会等待异步订阅者？ | [processEvents](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent.ts#L565) | [异步订阅测试](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/test/agent.test.ts#L361) |
| 请求如何只从历史里拿 system 和工具声明？ | [declareToolChanges](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent-loop.ts#L333) | [Transcript 测试](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/test/agent-loop.test.ts#L160) |

建议先看测试里的输入和断言，再回到实现定位分支。`e2e.test.ts` 会涉及外部模型，本工作区已验证的是上述本地单元测试。

## 第三组：从核心进入完整应用

| 方向 | 入口 | 学习目标 |
| --- | --- | --- |
| 完整编码 Agent 如何组装 | [sdk.ts](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/src/core/sdk.ts#L411) | 创建 Agent、注入流函数、消息转换和上下文转换 |
| 会话生命周期与上下文压缩 | [agent-session.ts](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/src/core/agent-session.ts#L898)、[compaction.ts](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/src/core/compaction/compaction.ts) | 观察上层怎样利用 Core 的钩子实现策略 |
| 历史如何保存与恢复 | [session-manager.ts](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/src/core/session-manager.ts) | 区分内存消息数组与持久化会话 |
| 真实工具实现 | [read.ts](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/src/core/tools/read.ts)、[bash.ts](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/src/core/tools/bash.ts) | 参数 schema、输出截断、取消与进度通知 |
| 应用 SDK 用法 | [SDK 文档](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/docs/sdk.md)、[SDK 示例目录说明](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/examples/sdk/README.md) | 需要现成编码会话时，可直接使用更高层 SDK |
| MCP 和代码调用工具 | [mcp-codemode/main.ts](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/examples/mcp-codemode/main.ts)、[tools.ts](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/examples/mcp-codemode/tools.ts) | 把外部工具适配为 AgentTool，并让嵌套调用复用 hooks |
| 持久化任务运行时 | [pi-durable README](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/durable/README.md) | 第二阶段再看 durable conversation、恢复、任务和子任务 |

产品使用手册：[Pi 官方文档](https://pi.dev/docs/latest)。它适合了解 CLI、模型配置和扩展；研究 Core 内部循环时，包内 README 与测试更直接。

## 第四组：遇到语法障碍时查阅

| 基础知识 | 推荐资料 | 在源码里对应什么 |
| --- | --- | --- |
| TypeScript 可辨识联合类型 | [TypeScript Handbook：Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) | 根据 `event.type` 或 `message.role` 缩小类型 |
| 异步迭代 | [MDN：for await...of](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of) | 消费模型响应流与 Agent 事件流 |
| 协作式取消 | [MDN：AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) | 一次 run 的取消信号如何传入模型和工具 |
| 运行时 schema 和静态类型 | [TypeBox 官方仓库](https://github.com/sinclairzx81/typebox) | `Type.Object`、`Static`、工具参数校验 |
| 事件流的具体实现 | [pi-ai EventStream](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/ai/src/utils/event-stream.ts) | 队列、异步迭代与 `result()` 的关系 |
| System 与工具声明重放 | [pi-ai transcript.ts](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/ai/src/utils/transcript.ts) | 如何从一串 system 更新获得当前有效提示词与工具 |

推荐分配：60% 时间看 Core 和测试，25% 做小实验，15% 阅读 pi-ai 与上层集成。先掌握一次工具循环，再扩展到会话、压缩或多 Agent。
