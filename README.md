# Pi Agent Core 中文学习工作区

围绕 Pi Agent Core 的中文源码解析、运行示例和说明图。`pi/` 子模块固定到 [本文分析的上游提交](https://github.com/earendil-works/pi/tree/7bd01fb92485c06f92ecfff7ccf3197148bc16af)，重点学习 [packages/agent](https://github.com/earendil-works/pi/blob/7bd01fb92485c06f92ecfff7ccf3197148bc16af/packages/agent/README.md)，npm 名称为 `@earendil-works/pi-agent-core`。

建议先运行一个本地例子，再按中文指南阅读 `types.ts → agent.ts → agent-loop.ts → test`。

| 内容 | 入口 |
| --- | --- |
| 源码架构、调用链、事件、工具、队列、错误处理 | [中文源码解析](docs/pi-agent-core-guide.md) |
| State 生命周期、Prompt 组装、运行中更新、会话保存 | [State 与 Prompt 专题](docs/state-and-prompt.md) |
| GPT Image 2.5 绘制的五张说明图、原图与提示词 | [说明图集](docs/illustrations.md) |
| 官方文档、作者文章、源码与测试索引 | [学习资料](docs/resources.md) |
| 三阶段阅读计划、运行命令、练习与调试 | [动手学习](docs/practice.md) |
| 下载版本、依赖准备和验证结果 | [版本与验证记录](docs/provenance.md) |

## 下载与准备

需要 Node.js `>=22.19.0` 和 npm。首次下载时一并获取固定版本的 Pi 源码，再安装上游依赖：

```bash
git clone --recurse-submodules https://github.com/zxczrx123/pi-agent-study.git
cd pi-agent-study
npm --prefix pi ci --ignore-scripts --no-audit --no-fund
npm --prefix pi run hydrate:model-data
```

仓库为私有时，需要先通过 GitHub 账号完成 Git 身份认证。`hydrate:model-data` 下载公开模型目录，不发送推理请求。

如果之前克隆时没有带子模块，在学习仓库根目录执行 `git submodule update --init --recursive`，然后执行上面的两条 npm 准备命令。源码只跟随本仓库记录的提交；日常学习不需要运行 `git submodule update --remote`。

## 先运行

完成准备后，在学习仓库根目录运行。这四个命令使用本地模拟模型，实际运行下载的 Agent Core 源码，不调用模型服务，也不需要 API Key。

```bash
# 在学习仓库根目录执行
npm run demo:loop
npm run demo:queues
npm run demo:sequential
npm run demo:state
```

- `demo:loop`：观察 `prompt → 模型请求 → add 工具 → 工具结果 → 模型回答`。
- `demo:queues`：观察工具按 `fast, slow` 完成，消息按 `slow, fast` 保存，以及 `steer` 优先于 `followUp`。
- `demo:sequential`：用相同场景对照串行执行顺序。
- `demo:state`：对比只改公开 state 与通过钩子同步下一轮，观察 Prompt 片段替换/删除和请求临时上下文。

示例文件：[工具循环](study/01-tool-loop.ts)、[并行与队列](study/02-queues-and-parallel.ts)、[State 与 Prompt](study/04-state-and-prompt.ts)。

## 本次源码版本

| 项目 | 值 |
| --- | --- |
| 官方仓库 | [earendil-works/pi](https://github.com/earendil-works/pi) |
| 获取日期 | 2026-10-13，Asia/Shanghai |
| 分支 | `main` |
| 提交 | `7bd01fb92485c06f92ecfff7ccf3197148bc16af` |
| 核心包 package.json 版本 | `1.1.0`；本次检出的是 main 提交，不等同于检出发布标签 |
| 下载方式 | `git clone --depth 1`，包含当前提交的全部源码，历史仅保留最近一层 |
| Node 要求 / 本机版本 | `>=22.19.0` / `v24.18.0` |

旧仓库 `badlogic/pi-mono` 已重定向到当前仓库。旧包 `@mariozechner/pi-agent-core` 的 npm 元数据已标记弃用并指向新包。阅读旧文章时同时对照当前源码和 changelog。

`pi/` 以 Git 子模块记录上游地址与固定提交；`docs/`、`study/`、`output/imagegen/` 和此 README 是学习材料。文档中的源码链接指向固定提交，图片和学习文件使用仓库内相对链接，支持 GitHub 阅读。

`docs/sample-output/` 保存本次验证的示例输出；本机临时运行输出 `study/output/` 和依赖目录不纳入版本管理。
