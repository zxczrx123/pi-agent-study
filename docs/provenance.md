# 版本与验证记录

记录日期：2026-10-13，时区 Asia/Shanghai。

## 来源与版本

| 项目 | 记录 |
| --- | --- |
| 旧 npm 元数据 | [@mariozechner/pi-agent-core/latest](https://registry.npmjs.org/@mariozechner/pi-agent-core/latest)，查询返回版本 0.73.1，deprecated 指向新包 |
| 新 npm 元数据 | [@earendil-works/pi-agent-core/latest](https://registry.npmjs.org/@earendil-works/pi-agent-core/latest)，查询返回版本 1.1.0 |
| 仓库确认 | GitHub API 对 `badlogic/pi-mono` 跟随重定向后返回 `earendil-works/pi` |
| 下载来源 | `https://github.com/earendil-works/pi.git` |
| 本地目录 | `pi/`（相对于学习仓库） |
| 检出分支 | `main` |
| 检出提交 | `7bd01fb92485c06f92ecfff7ccf3197148bc16af` |
| 提交日期 | 2026-10-12 |
| 提交主题 | `fix(ai): retry "The upstream provider returned an error"` |
| 获取方式 | `git clone --depth 1`；完整工作树，浅历史 |
| 许可证 | [MIT](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/LICENSE) |
| Node / npm | v24.18.0 / 11.16.0 |

本次分析的是这个 main 提交，而非断言 npm 1.1.0 tarball 与 main 的所有文件完全相同。在线 latest 结果和模型目录均会随时间改变。

## 本地准备

1. 用 `npm ci --ignore-scripts --no-audit --no-fund` 根据上游锁文件安装依赖，命令成功，安装 299 个包。
2. 用 `npm run hydrate:model-data` 补齐 `packages/ai/src/providers/data/` 中被 Git 忽略的公开模型目录数据，命令成功。
3. 中文文档和学习示例放在源码仓库之外。验证后上游 `git status --short` 为空，已跟踪文件未发生修改。

初次执行官方测试时，`agent-loop.test.ts` 与 `proxy.test.ts` 的 41 项通过；`agent.test.ts` 因缺少模型目录 JSON 无法导入。补齐数据后重新执行，三个文件全部通过。

## 验证结果

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| 官方 `agent-loop.test.ts`、`agent.test.ts`、`proxy.test.ts` | 3 files / 81 tests passed | 使用仓库原有 Vitest 配置和源码别名，约 0.6 秒 |
| `npm run demo:loop` | 通过 | 两次模型请求、一次工具执行、消息历史与 idle 状态断言通过 |
| `npm run demo:queues` | 通过 | 并行完成顺序、消息顺序、steering 与 follow-up 顺序断言通过 |
| `npm run demo:sequential` | 通过 | 串行顺序与队列顺序断言通过 |
| `npm run demo:live:check` | 通过 | Anthropic provider、模型目录和 Agent 初始化成功，无推理请求 |
| `tsc -p study/tsconfig.json` | 通过 | 学习示例及其引用类型检查通过，无输出产物 |
| 文档链接与代码块检查 | 通过 | 5 份 Markdown、100 个本地链接有效，代码块闭合 |

可查看本地运行输出：[工具循环](sample-output/tool-loop.txt)、[并行队列](sample-output/parallel-queues.txt)、[串行队列](sample-output/sequential-queues.txt)、[真实模型初始化](sample-output/live-init.txt)。

上述代码验证未运行真实对话模型请求、付费对话推理或 `e2e.test.ts`；验证范围是核心本地行为和示例初始化，不代表全部服务商端到端兼容性已测试。后续说明图制作按用户要求调用了配置的图片模型服务，见下方记录。

## 证据、结论与阅读路径

| 证据 Evidence | 结论 Finding | 阅读/复现路径 Path |
| --- | --- | --- |
| npm repository 字段与 GitHub 重定向 | 项目已更名迁移，核心包在 `packages/agent` | 新仓库 README 与 npm 元数据 |
| agent.ts 构造器、默认消息转换器、types.ts | 需要明确模型边界；system 属于标准消息；Core 维护运行状态 | [Agent 构造器](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/src/agent.ts#L230) |
| runLoop、executeToolCallsParallel、官方测试、本地示例 | 默认并行，结束事件按完成顺序，结果消息按声明顺序 | `npm run demo:queues` |
| runLoop 队列抽取位置与官方队列测试 | steering 在本轮工具完成后注入，follow-up 在自然停止点注入 | [队列测试](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/test/agent-loop.test.ts#L762) |
| processEvents 与异步订阅测试 | 状态先更新，订阅者随后被等待，真正 idle 晚于 agent_end 发出 | [异步订阅测试](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/test/agent.test.ts#L361) |
| 1.0.0 CHANGELOG 与 coding-agent 集成源码 | 当前核心库和会话、持久化、压缩策略分层 | [版本变更](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/CHANGELOG.md#L25) |

本指南对“订阅回调内等待同一 run 的 idle 会互相等待”的说明属于由源码等待关系推导出的使用建议；不将它表述为本次额外运行过的专项测试结果。

## 说明图补充记录

2026-10-13，根据用户指定，使用 imagegen 技能的配置服务商 CLI 和 `gpt-image-2.5-flare`（`gpt-image-2.5` 的配置别名）制作四张 2048×1536 PNG：架构、工具循环、并行/串行顺序、输入队列时机。

图片嵌入中文解析第 1、4、8、9 节；原 Mermaid 图保留为可展开内容。原图、完整生成/编辑提示词和服务商信息见 [说明图集](illustrations.md)，文件尺寸和 SHA-256 见 [图片清单](../output/imagegen/manifest.json)。

第三张图在视觉检查中发现串行时间条位置错误，使用同一模型修正，再移除不必要的数字刻度。最终图以中文标注和条形的先后/重叠关系说明机制；它不是性能测试结果。

补图后检查通过：6 份 Markdown、123 个本地链接、8 处图片嵌入；四张最终 PNG 均为 2048×1536。已逐张查看中文标签、流程箭头和执行顺序。本轮只修改说明材料与图片，未重复运行代码测试。

## State 与 Prompt 专题补充记录

2026-10-13，新增 [专题解析](state-and-prompt.md) 与 [可运行示例 04](../study/04-state-and-prompt.ts)，并更新首页、主指南、动手学习和资料入口。

`npm run demo:state` 通过，验证了同一次 run 中只改公开 state 与钩子显式同步的差异、工具移除声明、具名 Prompt 更新/删除、请求临时上下文、事件后的公开状态与 idle 边界。`tsc -p study/tsconfig.json` 通过。运行结果保存为 [state-and-prompt.txt](sample-output/state-and-prompt.txt)。本次没有修改上游源码，未重复执行前面已通过的 81 项官方测试。

第五张说明图继续使用配置服务商 CLI 和 `gpt-image-2.5` 别名生成，解析为 `gpt-image-2.5-flare`。请求尺寸 2048×1536，服务实际返回透明 PNG 1448×1086；本地仅合成浅色底，保存为文档使用的 [05-state-and-prompt-opaque.png](../output/imagegen/05-state-and-prompt-opaque.png)，保留原始返回文件和完整提示词。已查看并核对中文标签、两条对照路径和 Prompt 更新规则。

最终检查通过：7 份 Markdown、172 个本地链接、10 处图片嵌入，代码块均闭合；5 张最终图和 1 张保留原图的尺寸与 SHA-256 均与清单一致。上游提交仍为上述固定版本，`git -C pi status --short` 为空。

## GitHub 仓库准备

将学习资料发布到 `zxczrx123/pi-agent-study` 时，原来的嵌套 Pi 检出登记为 Git 子模块，仍固定在同一个上游提交。源码正文没有改动，依赖和本机临时输出不上传。

文档的本机绝对路径转换为仓库内相对链接；源码引用转换为上游固定提交的 GitHub 链接，行号转换为 `#L` 锚点。五份已验证的运行输出复制到 `docs/sample-output/` 供在线查阅。README 补充了包含子模块的克隆命令与依赖准备步骤。

上传准备检查通过：37 项版本控制条目、64 个仓库内文件链接、108 个固定版本源码链接、10 处图片嵌入；Markdown 中没有本机绝对路径。子模块登记后重新运行 `npm run demo:state`，所有断言通过，上游工作树保持干净。
