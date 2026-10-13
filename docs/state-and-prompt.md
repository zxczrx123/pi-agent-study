# Pi Agent Core：State 管理、Prompt 编排与动态更新

基于本地提交 `7bd01fb92485c06f92ecfff7ccf3197148bc16af`。本文分析当前源码；旧教程中的 `setSystemPrompt()`、`setModel()` 等接口不能直接套用。

**最重要的关系是：应用配置 → 本次运行的上下文 → 本次模型请求。** `Agent.state` 保存公开状态；循环在启动时取一份浅快照；每次请求还会经过钩子和消息转换。三者可以不同，动态更新要明确更新哪一层、在哪个边界生效。

先运行这个不需要 API Key 的实验：

```bash
# 在学习仓库根目录执行
npm run demo:state
```

[完整示例](../study/04-state-and-prompt.ts) 使用下载的真实 Core，只把模型替换为本地脚本。它验证了同一次 run 内更新模型、工具、Prompt，以及临时上下文不写入历史的行为。[本次运行输出](sample-output/state-and-prompt.txt) 可直接对照阅读。

## 1. 先把三种“状态”分清楚

| 层次 | 保存什么 | 谁更新 | 生存范围 |
| --- | --- | --- | --- |
| 应用业务状态 | 当前任务阶段、用户选择、项目配置、检索结果、会话分支等 | 你的应用或 `AgentSession` | 应用自行决定，可持久化 |
| `Agent.state` | 模型、思考级别、可执行工具、消息历史、流式进度、错误 | 应用设置配置，Core 根据事件维护运行字段 | 这个 Agent 实例 |
| 循环内部 `currentContext` / `config` | 本次运行实际使用的消息、工具、模型及钩子配置 | 启动时取快照，之后由 loop 和钩子推进 | 一次 `prompt()` / `continue()` |

模型并不能直接读取你的 JS 对象。业务状态需要通过 system sections、user/toolResult 消息或请求投影转换为模型能看到的输入。反过来，模型写一句“阶段已完成”，也不会自动更改应用对象。

这里的一次 **run** 可以包含多次模型请求；一次 **turn** 包含一次助手响应及其工具执行。讨论“下一次生效”时，必须区分同一个 run 内的下一轮和下一次 `prompt()`。

![State 与 Prompt 的动态更新：只改公开状态与通过下一轮钩子同步的对照](../output/imagegen/05-state-and-prompt-opaque.png)

图 5 对应 `demo:state` 的具体两轮实验。完整请求流水线和钩子边界见下文。[图片提示词](../output/imagegen/prompts/05-state-and-prompt.txt)

## 2. Agent.state 怎样管理

类型定义见 [AgentState](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/types.ts#L382)，构造逻辑见 [createMutableAgentState](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent.ts#L82)。

| 字段 | 含义与更新方式 |
| --- | --- |
| `messages` | 已完成消息的历史，包含 system/user/assistant/toolResult 以及应用扩展消息；`message_end` 时追加 |
| `systemPrompt` | **只读 getter**：每次从 `messages` 中重放 system 更新，计算当前有效文本 |
| `model`、`thinkingLevel` | 应用选中的模型与思考级别；新 run 会取当前值，同一 run 内的切换见第 3 节 |
| `tools` | 真正包含 `execute()` 的工具实现；赋值时复制顶层数组 |
| `isStreaming` | 整个 run 是否仍在处理，包括工具与等待订阅者的时间，不只表示模型正在吐字 |
| `streamingMessage` | 当前正在发送的消息；助手流式更新时反复替换，消息结束后清空 |
| `pendingToolCalls` | 已发出 `tool_execution_start`、尚未发出 end 的调用 ID；开始事件早于校验/执行，不能据此断言 `execute()` 已经开始 |
| `errorMessage` | 最近失败或取消的助手轮次的错误信息；新 run 开始时清空 |

Core 的状态更新可以看成一个简单的事件归约器。`processEvents()` 先改状态，再按订阅顺序 `await` 你的回调：

```text
message_start / message_update → streamingMessage = 当前消息
message_end                    → 清空 streamingMessage，追加 messages
 tool_execution_start          → pendingToolCalls 加入 ID
 tool_execution_end            → pendingToolCalls 移除 ID
turn_end                       → 助手带错误时记录 errorMessage
agent_end                      → 清空 streamingMessage，等待所有订阅者
finally: finishRun             → isStreaming = false，释放 activeRun
```

因此，你在 `message_end` 订阅者中读取 `state.messages`，已经能看到该消息；在 `agent_end` 回调中，`isStreaming` 仍为 true。外部等待结束用 `await agent.prompt(...)` 或 `await agent.waitForIdle()`。不要在同一次运行的订阅回调内部等待 `waitForIdle()`，两者会互相等待。

实现位置：[processEvents](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent.ts#L565)、[runWithLifecycle](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent.ts#L507)。`prompt()` 返回 `Promise<void>`，结果从历史或事件读取；判断成功还要检查 `errorMessage` 和助手的 `stopReason`。

### 数组不是不可变状态容器

给 `state.messages`、`state.tools` 赋值会执行 `.slice()`，只隔离顶层数组。读取 getter 得到的数组仍可变；消息对象和工具对象也没有深拷贝或冻结。

建议用新数组、新消息表示修改。不要通过改共享消息对象的属性来“绕过快照”：这会让公开状态、循环和已经发给订阅者的对象相互影响，更新边界难以解释。

同一 Agent 同时只能有一个 active run。运行中再次 `prompt()` 会报错；新输入用 `steer()`、`followUp()` 排队。`reset()` 也要求 idle，它保留重放后的 system/工具声明基线，清掉对话与队列，**不会恢复成构造时的全部默认配置**。

## 3. 为什么运行中改 state 不一定生效

[createContextSnapshot](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent.ts#L460) 和 [createLoopConfig](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent.ts#L467) 在 run 启动时做了类似下面的操作：

```typescript
// 对应源码的关键逻辑，省略其他选项。
const context = {
  messages: agent.state.messages.slice(),
  tools: agent.state.tools.slice(),
};
const config = {
  model: agent.state.model,
  reasoning: agent.state.thinkingLevel === "off" ? undefined : agent.state.thinkingLevel,
};
```

之后执行 `agent.state.model = anotherModel` 或 `agent.state.tools = []`，不会自动替换已经交给 loop 的引用。执行 `state.messages.push(...)` 也只是在公开历史数组上追加，当前循环不会自动看到这个新元素。

示例先请求模型 A、执行 add，然后在 `turn_end` 订阅者中把公开状态改成模型 B、空工具集：

| 模式 | 第一次请求 | 修改公开 state 后的第二次请求 |
| --- | --- | --- |
| 只赋值 `state.model` / `state.tools` | A + add | **仍是 A + add** |
| 预先安装下一轮同步钩子 | A + add | **B + 无工具**，同时收到 Prompt 更新 |

这里验证的是“赋新值没有自动同步”，不表示状态被冻结。对象仍是浅共享，部分队列/回调也通过闭包读取最新信息。可靠做法是在启动前安装钩子，让钩子在约定边界读取最新业务配置。

反方向也不自动同步：钩子返回 `model` 或替换 `context.messages` 后，Core 不会把整个替换结果写回 `Agent.state`。通过 `messages` 字段正常发出的新消息会触发事件、写入公开历史；其他配置或历史替换需要应用自行管理。

## 4. Prompt 不是单个字符串

一次模型请求至少包含几类信息：

| 输入 | 来源 | 作用 |
| --- | --- | --- |
| System 文本及具名 sections | 初始化和后续 system 更新 | 角色、规则、阶段目标、项目配置 |
| User / assistant / toolResult 历史 | 用户输入、模型响应、工具结果 | 当前任务及已发生的交互 |
| 工具声明 | system 上的 `toolsAdded` / `toolsRemoved` | 告诉模型可调用哪些工具及其参数 |
| 请求临时上下文 | `transformContext` 等应用钩子 | 本次需要的检索资料、裁剪后的历史等 |
| 请求选项 | model、thinkingLevel 等 | 选择模型与推理配置；它们不是 Prompt 文本 |

Core 的初始化有一个边界：只有当 `initialState.messages` **没有以 system 开头**时，`initialState.systemPrompt` 和工具声明才会生成一个前置 system 消息。如果传了自己的前置 system，必须自己放好初始 Prompt；工具声明差异仍会由循环在请求前补齐。

### content 累加；sections 按名字更新

当前版本的 system 消息允许这样组织可变 Prompt：

```typescript
const initial = {
  role: "system",
  content: "你是一个计算助手。", // 适合固定基础文本
  sections: {
    phase: "<phase>调用工具计算</phase>",
    output: "<output>用中文回答</output>",
  },
  timestamp: 0,
};

const patch = {
  role: "system",
  content: "", // 不重复追加基础文本
  sections: {
    phase: "<phase>根据结果总结</phase>", // 替换同名片段
    output: null,                         // 删除片段
  },
  timestamp: Date.now(),
};
```

`getCurrentSystemMessage()` 顺序扫描 system 消息：非空 `content` 累加；`sections[name]` 是字符串就更新该键，是 `null` 就删除。最终 `getSystemMessageText()` 先输出累加的 content，再拼接有效 sections，段落间用空行分隔。

对应结果为：

```text
你是一个计算助手。

<phase>根据结果总结</phase>
```

**再追加一条 `content: "你是另一个助手"` 不会覆盖之前的角色描述。** 会动态变化的部分应从开始就放入具名 sections。section 名本身不会自动成为标题或 XML 标签；上例的 `<phase>` 是我们写进值的内容。

替换一个已有 section 不会自动把它移动到最后。提示词段落的顺序由重放时的键插入顺序决定；应用应保持构造次序稳定。

源码：[system 重放](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/ai/src/utils/transcript.ts#L73)、[文本渲染](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/ai/src/utils/text.ts#L15)。

### 模型看见声明，运行库持有函数

`context.tools` 包含 `execute()`，用于真正执行调用。system 消息只保存 `name`、`description`、参数 schema 等声明，不会把 JS 函数发给模型。

loop 的 `declareToolChanges()` 比较执行集合与历史声明，生成 `toolsAdded`、`toolsRemoved`。同名工具的声明发生变化时，按“删除旧定义 + 添加新定义”表达。工具只变更 `execute()`、接口声明不变时，没有必要重复发送声明。

## 5. 一次请求前，究竟按什么顺序编排

下面突出同一次 run 的后续轮次；首轮没有 `prepareNextTurnWithContext`：

```text
已完成上一轮，且调度器确定还要继续
  ↓
prepareNextTurnWithContext
  可返回 context / model / thinkingLevel / 待追加的 messages
  ↓
必要时再抽取 steering；发出 turn_start
  ↓
declareToolChanges
  对比工具，处理准备好的消息与已选中的排队消息
  通过 message_start / message_end 正式写入更新
  ↓
prepareRequest                        ← 每次都有，包括首次请求
  可返回 context / model / thinkingLevel
  ↓
transformContext                      ← AgentMessage[] → AgentMessage[]
  ↓
convertToLlm                          ← AgentMessage[] → 标准 Message[]
  ↓
normalizeContext({ messages })
  ↓
streamFn(model, transcript, options)
  ↓
pi-ai provider 适配 → 模型服务
```

[streamAssistantResponse](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent-loop.ts#L381) 传给 `streamFn` 的是标准 transcript，system 和工具声明都在 `messages` 里，不再是独立的 `context.systemPrompt` / `context.tools` 字段。

`normalizeContext` 不等于“把所有 system 压成一条”。provider 会根据模型能力保留中途的 system 更新，或通过 `resolveTranscript` 把更新重放成一个前置 system。`state.systemPrompt` 是有效 Prompt 的文本视图，未必逐字等于某个服务商最终的 HTTP 请求字段。

### 钩子选择表

| 需求 | 适合入口 | 需要记住的边界 |
| --- | --- | --- |
| 首次运行之前设置模型、工具与历史 | `initialState` 或 idle 时赋 `state` | 新 run 会取当前值 |
| 同一 run 的后续轮次切换阶段、模型、工具 | `prepareNextTurnWithContext` | 只有已确定继续时才调用；不包含首轮 |
| 每次请求前从会话存储刷新，或路由模型 | `prepareRequest` | 包含首轮；没有可触发消息事件的 `messages` 返回字段 |
| 本次请求筛选历史或加入临时资料 | `transformContext` 返回新数组 | 不自动改公开历史或循环历史 |
| 将自定义角色转换成模型支持的消息 | `convertToLlm` | 保留需要的 system、工具调用与结果关联 |
| 用户在运行中纠正方向 | `steer()` | 排队到轮次边界，不改写已发出的请求 |
| 当前任务结束后再做一件事 | `followUp()` | 在自然停止点取出 |
| 让没有工具调用的一轮仍然继续 | `finishTurn` 返回 `{ action: "continue" }` | 给出继续理由，并设置轮数/预算退出条件 |

三个容易遗漏的边界：

1. `prepareNextTurn` **不会凭空创造下一轮**。需要工具结果、排队消息或 `finishTurn` 的继续决定先使调度器选中下一轮。
2. `prepareRequest` 运行时，工具声明差异已经处理过了；它返回后不会再跑一次 `declareToolChanges`。如果在这里单独更换 `context.tools`，可能使执行集合与模型声明不一致。工具集合切换优先放在下一轮钩子；若必须在请求钩子做，要同时保证 transcript 中的声明正确。
3. `prepareRequest` 返回的 `context` 会成为 loop 的新上下文并继续被使用，**不一定只影响一次请求**。临时投影更适合 `transformContext`；两者都不会自动产生持久化事件。

`prepareRequest` 也不会在执行完后再抽取新排队的 steering。长时间请求准备过程中收到的输入，不应假设一定进入眼前这次请求。

## 6. 怎样实现“计算 → 总结”的动态更新

示例中，第一轮工具完成后应用选择模型 B 并清空可执行工具。提前安装的钩子在下一轮同步：

```typescript
// 从 study/04-state-and-prompt.ts 提炼；agent、context 来自实际示例。
prepareNextTurnWithContext: ({ context }) => ({
  context: { ...context, tools: agent.state.tools.slice() },
  model: agent.state.model,
  thinkingLevel: agent.state.thinkingLevel,
  messages: [{
    role: "system",
    content: "",
    sections: { phase: "<phase>根据结果总结</phase>", legacy: null },
    timestamp: Date.now(),
  }],
})
```

随后 loop 自动将 `toolsRemoved: [{ name: "add" }]` 合并进 system 更新，发出正常消息事件；于是运行上下文、公开历史与模型可见声明有了可追踪的更新记录。

实际应用中还应比较“当前有效 sections”和“期望 sections”，只提交变化部分；不要每一轮无条件追加同一个补丁。上层 Pi 正是通过 `diffSystemPromptSections()` 做这个差异计算。

### 只想在下一次用户输入时改变 Prompt

Agent 已 idle 时，可以用 `prompt()` 一次提交“system 补丁 + user 消息”，让两条消息都走正常事件：

```typescript
await agent.prompt([
  {
    role: "system",
    content: "",
    sections: { phase: "<phase>总结</phase>" },
    timestamp: Date.now(),
  },
  { role: "user", content: "总结刚才的结果。", timestamp: Date.now() },
]);
```

idle 时直接给 `state.messages` 赋新数组也能影响下一次运行，但这种赋值不会触发消息事件。如果会话存储依赖 `message_end`，就需要应用显式同步存储；否则内存与保存的历史可能不同。

### 临时上下文：只送给模型，不写入历史

```typescript
transformContext: async (messages) => {
  const temporaryContext = {
    role: "system" as const,
    content: "",
    sections: { request_context: "<request_context>本次请求的应用配置</request_context>" },
    timestamp: Date.now(),
  };
  return [...messages, temporaryContext];
}
```

这里的 system 内容来自应用自身的可信配置。检索到的网页、文档等外部资料应作为明确标识的数据放入适当的 user/toolResult 内容，避免把资料中的指令当成应用规则。

示例在两次请求中分别加入“请求序号 1/2”，断言模型输入能看到，但 `state.systemPrompt` 和历史都没有它们。不要对传进来的 `messages` 做 `push()` 后原样返回，否则会修改 loop 共用的数组，失去“临时”的性质。

## 7. 完整 Pi Coding Agent 怎样组装 Prompt

Core 提供循环和消息机制。读取 `AGENTS.md`、技能目录、Prompt 模板以及编码助手默认规则的是上层 `pi-coding-agent`。

[buildSystemPromptSections](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/src/core/system-prompt.ts#L128) 通常按以下内容组装：

| Section | 来源与作用 |
| --- | --- |
| `preamble` | 默认编码助手角色，或自定义基础 Prompt |
| `tools`、`rules` | 当前可见工具的文字说明，以及工具相关规则 |
| `docs` | Pi 自身文档的查阅指引 |
| `addendum` | 追加的 system prompt |
| `project_context` | 资源加载器读取的项目上下文文件，包括 AGENTS 文件 |
| `skills` | 可用技能说明；是否加入取决于读取技能文件的工具是否可用 |
| `cwd` | 当前工作目录 |
| 自定义 sections | 应用或扩展补充的具名段落 |

上层构造器给大多数 section 加 `<name>…</name>` 标签；Core 的底层渲染器只拼接值。`customPrompt` 会改变基础部分，仍可能追加项目上下文等内容；`forceSystemPrompt` 则有独立的强制文本路径。

用户输入还有另一条处理链：[AgentSession.prompt](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/src/core/agent-session.ts#L2053) 默认支持扩展命令、skill 命令和 Prompt 模板展开，再组装用户消息并进入 Core。模板用来展开用户输入；system sections 用来管理助手规则，两者用途不同。

运行中，上层通过两个关键钩子保持状态与请求一致：

- [下一轮刷新](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/src/core/agent-session.ts#L898)：按需压缩上下文、刷新活跃工具、重新计算 Prompt sections、生成差异补丁，并把模型/工具选择交回 loop。
- [每次请求投影](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/src/core/agent-session.ts#L787)：从 `SessionManager.buildSessionProjection()` 构建当前分支的请求历史，再应用模型选择/路由等规则。

所以你在完整 Pi 产品里看到的“切换后下一轮就生效”，往往是上层主动同步的结果。只使用裸 `Agent` 时，需要自己安装对应策略。

## 8. 历史如何持久化、恢复和压缩

裸 Core 的 `messages` 是内存历史。`sessionId` 是转发给 provider 的会话标识，不能代替磁盘存储。

完整 Pi 的 [SessionManager](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/src/core/session-manager.ts#L977) 使用 JSONL 保存追加式会话树。当前分支、压缩记录、上下文编辑会影响从存储投影出的请求消息，磁盘上的完整记录不必全部发送给模型。

[AgentSession 的事件处理器](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/src/core/agent-session.ts#L1103) 在 `message_end` 时将 system/user/assistant/toolResult 等写入 SessionManager；Core 会等待这个订阅者，下一请求才继续。会话投影需要更新公开历史时，上层还有 [刷新最终上下文](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/src/core/agent-session.ts#L938) 的明确动作。

如果自己做应用，可沿用这种分工：

1. 保存已完成消息和可序列化业务状态；把流式草稿与最终消息区分开。
2. 恢复时重建模型对象和工具注册表，再装载历史；工具函数不能靠 JSON 反序列化恢复。
3. 在指定轮次边界进行摘要/裁剪，保留有效 system、必要上下文及成对的工具调用/结果。
4. 明确压缩改变的是“请求视图”还是“规范历史”，并同步需要受影响的状态与存储。

Core 不会因为你在 `transformContext` 返回了精简历史，就自动把 `state.messages` 或磁盘记录一起精简。这种分离允许保留完整交互记录，同时控制模型输入长度。

## 9. 按这条路线读源码

| 阅读顺序 | 文件入口 | 重点问题 |
| --- | --- | --- |
| 1 | [agent.ts:82](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent.ts#L82) | getter、setter、初始化前置 system 怎样工作？ |
| 2 | [agent.ts:460](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent.ts#L460) | 当前运行复制了哪些值，哪些还是共享引用？ |
| 3 | [agent.ts:565](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent.ts#L565) | 事件如何更新 state，为什么回调里已能看到新消息？ |
| 4 | [agent-loop.ts:163](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent-loop.ts#L163) | 两个准备钩子、队列和工具声明的具体先后顺序？ |
| 5 | [transcript.ts:73](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/ai/src/utils/transcript.ts#L73) | content 与 sections 的重放语义？ |
| 6 | [system-prompt.ts:217](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/src/core/system-prompt.ts#L217) | 上层如何只发送发生变化的 sections？ |
| 7 | [agent-session.ts:898](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/coding-agent/src/core/agent-session.ts#L898) | 状态、工具、压缩与 Prompt 如何在轮次边界接起来？ |

对应官方测试：[system-message-replay.test.ts](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/ai/test/system-message-replay.test.ts)、[transcript-tool-changes.test.ts](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/ai/test/transcript-tool-changes.test.ts)、[prepareRequest / prepareNextTurn 测试](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/test/agent-loop.test.ts#L1404)。

动手延伸：把示例改成“先检索、再计算、最后总结”三个阶段；使用一个应用 `phase` 字段驱动 model/tools/sections，并仅在阶段变化时产生补丁。每次请求记录实际 model、重放后的 Prompt 和声明工具，检查它们是否与预期一致。
