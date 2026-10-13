# Pi Agent Core 动手学习

建议先分三次学习，每次 60–90 分钟，再做 State 与 Prompt 专题实验。先运行本地模拟模型，观察确定的事件顺序，再接真实模型。

首次使用先按 [README](../README.md) 获取子模块和依赖。除代码块中另有 `cd` 命令外，以下命令都从学习仓库根目录执行。

## 第一次：看懂最小工具循环

```bash
# 在学习仓库根目录执行
npm run demo:loop
```

打开 [01-tool-loop.ts](../study/01-tool-loop.ts)，找出三个部分：`AgentTool` 的实现、模拟模型 `streamFn`、Agent 的订阅与 `prompt()`。

运行后应看到两次模型请求：

```text
第一次：system → user
工具执行：add(2, 3) → 5
第二次：system → user → assistant → toolResult
最终历史：system → user → assistant → toolResult → assistant
```

模型响应是脚本预设的，但消息转换、schema 校验、工具执行、循环推进和状态更新都由下载的源码完成。[mock-model.ts](../study/mock-model.ts) 只实现模型边界，不包含 Agent 循环。

接着读 [types.ts](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/types.ts)、[Agent.prompt](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent.ts#L371)、[runLoop](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent-loop.ts#L163)。

完成标准：你能解释为什么只输入一次问题，却调用了两次模型；也能指出完整答案存放在哪里。

## 第二次：理解并行与消息队列

```bash
# 在学习仓库根目录执行
npm run demo:queues
npm run demo:sequential
```

[02-queues-and-parallel.ts](../study/02-queues-and-parallel.ts) 声明两个工具调用：先 slow，后 fast。工具开始时，应用分别加入一条 steering 和一条 follow-up。

| 观察点 | parallel | sequential |
| --- | --- | --- |
| 工具完成顺序 | fast、slow | slow、fast |
| toolResult 保存顺序 | slow、fast | slow、fast |
| 第 2 次模型请求 | 收到 steering | 收到 steering |
| 第 3 次模型请求 | 收到 follow-up | 收到 follow-up |

再读 [并行实现](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent-loop.ts#L586)、[队列类](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent.ts#L143)，对照 [官方队列测试](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/test/agent-loop.test.ts#L762)。

完成标准：能够区分“工具实际完成”“工具结果加入历史”“新用户消息注入”三个时间点。

## 第三次：修改一个行为并观察

在 `study/` 示例的副本里做以下练习即可。示例末尾有断言；实验改变预期行为时，需要相应修改断言，避免把故意改变后的行为当成源码 bug。

| 练习 | 修改位置 | 预期现象 |
| --- | --- | --- |
| 错误参数 | 示例 01 的模拟 toolCall，把 `a` 改为无法转换为数值的字符串 | 工具不执行，第二次模型请求收到错误 toolResult；改模拟响应以检查 `isError: true` |
| 执行失败 | `add.execute` 中抛出一个 Error | 外层继续收到错误工具结果，模型可据此回答或修正 |
| 执行前阻止 | 增加 `beforeToolCall`，返回 `{ block: true, reason: "学习用拦截" }` | `execute` 不调用；收到错误结果 |
| 限制轮数 | 增加 `finishTurn`，第一个 turn 返回 `{ action: "end" }` | 本轮工具仍执行完，但没有第二次模型请求 |
| 单工具要求串行 | 示例 02 的 wait 设置 `executionMode: "sequential"` | 即使全局 parallel，整批也按 slow、fast 执行 |
| 取消 | 在 wait 工具开始执行后，安排调用 `agent.abort()` | `timers/promises` 收到 signal，取消等待；观察错误结果与运行结束 |
| 异步订阅者 | 在 `agent_end` 回调中延迟约 100ms 再完成 | `await prompt()` 会等它完成，期间仍未 idle |
| 上下文转换 | 加一条应用自定义消息，在 `convertToLlm` 中转成 user 或过滤 | 应用能保留自己的消息类型，模型只收到标准消息 |

优先做“错误参数、限轮、串行”三个练习，然后画一张自己的调用链。源码分析中最值得掌握的是这些行为边界。

## 专题实验：State 与 Prompt 动态更新

```bash
# 在学习仓库根目录执行
npm run demo:state
```

[示例 04](../study/04-state-and-prompt.ts) 对同一个两轮任务运行两种配置：先只修改公开状态，再使用 `prepareNextTurnWithContext` 同步到循环。

| 观察点 | 只修改 state | 通过下一轮钩子同步 |
| --- | --- | --- |
| 第二次请求的模型 | 仍为 A | 切换为 B |
| 第二次请求的声明工具 | 仍有 add | 空工具集 |
| 有效 phase | 调用工具计算 | 根据结果总结 |
| 临时 request_context | 仅请求可见 | 仅请求可见 |
| `agent_end` 与 idle | 回调期间仍 active，`await prompt()` 后 idle | 相同 |

详细解释见 [State 与 Prompt 专题](state-and-prompt.md)。完成标准：能指出一次修改改变的是公开状态、循环上下文还是请求视图，并解释为什么 `content` 追加不能替代具名 section 覆盖。

## 运行官方本地测试

本机已准备依赖与模型目录数据，可以直接运行：

```bash
cd pi/packages/agent
node ../../node_modules/vitest/dist/cli.js --run test/agent-loop.test.ts test/agent.test.ts test/proxy.test.ts
```

本次结果是 **3 个测试文件、81 个测试通过**。这些指定测试使用本地模拟数据；不包含 `e2e.test.ts`。

聚焦一个行为时，可以只运行对应测试：

```bash
cd pi/packages/agent
node ../../node_modules/vitest/dist/cli.js --run test/agent-loop.test.ts -t 'should emit tool_execution_end in completion order'
```

如果在另一台电脑重新准备这个工作区，或删除了依赖，使用仓库的锁文件安装：

```bash
cd pi
npm ci --ignore-scripts --no-audit --no-fund
npm run hydrate:model-data
```

`hydrate:model-data` 会联网下载公开模型目录，生成被 Git 忽略的数据文件；它不会发送推理请求。`agent.test.ts` 通过兼容入口加载内置模型目录，因此全新克隆缺少这些 JSON 时会无法导入。本地模拟示例不依赖这些模型目录。

示例采用 Node 自带的 TypeScript 类型擦除执行，需要 Node `>=22.19.0`。本次使用 `v24.18.0`。检查示例静态类型的命令：

```bash
# 在学习仓库根目录执行
./pi/node_modules/.bin/tsc -p study/tsconfig.json
```

## 调试时放哪些断点

用 Node Inspector 启动最小示例：

```bash
# 在学习仓库根目录执行
node --inspect-brk --import ./study/register-source.mjs ./study/01-tool-loop.ts
```

在支持 Node 调试的编辑器中连接，或在 Chrome 的 `chrome://inspect` 页面连接 Node 进程。推荐按顺序观察：

| 断点 | 重点看哪些变量 |
| --- | --- |
| [Agent.prompt](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent.ts#L373) | 输入字符串怎样变成消息数组 |
| [runLoop](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent-loop.ts#L163) | `currentContext`、`pendingMessages`、`hasMoreToolCalls` |
| [streamAssistantResponse](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent-loop.ts#L381) | 转换前后 messages、最终传给 streamFn 的上下文 |
| [prepareToolCall](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent-loop.ts#L708) | 原始 arguments 与校验后的 args |
| [processEvents](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent.ts#L565) | message_end 如何更新 state.messages |

[register-source.mjs](../study/register-source.mjs) 把两个内部包名映射到本地 TS 入口，让示例直接运行下载的源码。它是本工作区的学习辅助文件；正常 npm 应用使用已发布包的构建产物即可。

## 换成真实模型

[03-real-model.ts](../study/03-real-model.ts) 使用 `createModels()`、Anthropic provider 和同样的加法工具，展示如何替换模型边界。它最多运行 4 个 turn。

先检查 provider、模型目录和 Agent 初始化，不发送模型请求：

```bash
# 在学习仓库根目录执行
npm run demo:live:check
```

在当前终端已有 `ANTHROPIC_API_KEY` 后，运行下面的命令才会调用真实模型并产生对应服务商用量：

```bash
# 在学习仓库根目录执行
npm run demo:live
```

默认模型是官方快速开始示例中的 `claude-sonnet-4-6`；可通过 `PI_STUDY_MODEL` 选择同一 provider 的其他模型 ID。需要其他服务商时，参考 [pi-ai provider 文档](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/ai/README.md)。

本次已验证初始化与 TypeScript 类型，未执行真实模型请求。模拟模型保证了演示行为可重复；真实模型是否按预期调用工具，还取决于模型响应。

## 需要历史版本时

当前源码是浅克隆，包含当前提交完整工作树。需要 `git log`、追踪演进或检出更老版本时，可以补齐历史：

```bash
cd pi
git fetch --unshallow --tags origin
```

中文指南对应固定提交 `7bd01fb92485c06f92ecfff7ccf3197148bc16af`。以后切换或更新源码版本时，先阅读 changelog，再检查指南中的行号和接口。
