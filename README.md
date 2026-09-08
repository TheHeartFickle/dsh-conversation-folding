# dsh-conversation-folding

`dsh-conversation-folding` 是一个纯 UI 增强插件，用于优化 DSH 对话流的阅读体验。它把思考过程、工具调用等中间过程折叠起来，同时保持用户输入和 LLM 输出使用原生渲染样式，不改变内容本身。


## ✨ 功能一览

- **整轮折叠（默认）**
  - 用户输入保持原生样式。
  - 思考/工具调用过程被折叠为一个独立的折叠栏。
  - 尚未生成正文时，折叠栏下方保留最近一次过程预览；开始生成正文后，过程自动隐藏，只显示正文。
  - 点击“展开过程”可以查看完整过程。

- **Tool call 分组折叠**
  - 连续的 `tool-call` 步骤会折叠成组，默认只显示最新一个，减少对话流中的重复工具调用刷屏。

- **思维链增强**
  - `Think` 块默认展开为可滚动子框。
  - 生成过程中自动跟随底部，方便实时阅读。
  - 新的思维链出现时，只折叠紧邻的前一个，保持上下文连续。

- **折叠的步骤类型可按类型配置**
  - 设置 →「对话折叠」独立标签页：18 个步骤类型分别开关是否折叠
    （bash / think / read / write / edit / glob / grep / web / skill / 子代理 /
    后台任务 / goal / 任务清单 / 提问 / ralph / workflow / 上下文注入 / 系统提示词）。
  - 默认不折叠：上下文注入、skill、系统提示词；其余类型折叠。

## 📦 安装

前置条件：已安装 DSH，且 `dsh web` 可以正常运行。

### 通过 npm / DSH CLI 安装

```sh
dsh plugin --profile web add @the-heart-fickle/dsh-conversation-folding@latest
```

### 通过 plugin-registry 安装

```sh
npm run package:registry
dsh registry install ./registry
dsh registry enable the-heart-fickle/dsh-conversation-folding
```

> `registry/` 是本地生成的安装暂存目录，不会提交到仓库。

## 🚀 快速上手

1. 安装插件后重启 DSH，并刷新浏览器页面。
2. 发送一条消息，观察：
   - 思考/工具调用过程被折叠为独立折叠栏；
   - 正文开始输出后，过程自动隐藏；
   - 点击“展开过程”可查看完整过程。
3. 想回到官方渲染时，在设置中把「对话显示」切换为 Normal / Compact 即可。

## ⚙️ 配置

全部配置在浏览器端「设置」内完成，经 host 设置系统持久化到
`~/.dsh/settings.yaml`（`dsh-conversation-folding:` 命名空间），跨端/重载恢复：

- **对话显示**（设置 → 对话显示）：`Normal` / `Compact` / `Fold`。仅「Fold」由
  本插件接管过程折叠，折叠行为只有一种：整轮折叠，正文永不折叠。
- **对话折叠**（独立标签页）：各步骤类型的「是否折叠」开关。工具调用按 host
  工具注册表的字面注册名经匹配表精确匹配（如 `pwsh`→Shell 命令、
  `str_replace_editor`→编辑文件、`todo_write`→任务清单、`ask_user_question`→提问）；
  未列入匹配表的工具类型始终折叠。默认不折叠：上下文注入、skill、系统提示词。
  浏览器 localStorage 不存任何配置。

> 0.1.x 曾支持 profile `cordis.patch.yml` 下发 `foldMode` / `auxVisible`；自本版本起
> 配置全部移到浏览器设置，host 不再持有配置。

## 🗂️ 效果示意

**思考阶段（正文未开始）**

```text
用户输入
┌──────────────────────────────────┐
│ 折叠栏：展开过程   N 个步骤      │
└──────────────────────────────────┘
最近一次 thinking / tool call（增强样式）
```

**正文输出后（多段正文全部保留，仅过程折叠）**

```text
用户输入
┌──────────────────────────────────┐
│ 折叠栏：展开过程   N 个步骤      │
└──────────────────────────────────┘
LLM 输出（原生正文样式，中间播报也完整可见）
```

## 🔧 环境要求

- Node.js ≥ 20
- DSH ≥ 0.1.2-rc.1（client 半边依赖 0.1.2 的 `useChat` ChatSnapshot）

## 📡 通信架构

host 半边只经官方 settings 服务触达配置：注册自有 settings 命名空间，经插件
RPC 路由 `/conversation-folding/config` 读写（`src/index.ts`）；client 半边经
官方 Loader + slots 注入（0.1.2 slot 选举制约束见 `docs/SPEC.md` 与
`docs/BUGS.md`）：

- **构建**：源码在 `src/`（host 半边 `src/index.ts`，浏览器端 `src/client/`），
  `npm run build` 经 esbuild 生成 `lib/`——`lib/index.js` 与以
  `window.__ModuleLoader__.load({ id, factory })` 包装注册的单文件 bundle
  `lib/client.js`（除 react 与官方 primitives 外全部内联）。`lib/` 为构建产物
  不入库，`npm test` 前自动构建。
- **官方 Loader**：`dsh.plugin.json` 仅负责装载浏览器半边 `lib/client.js`；
  host 壳（`lib/index.js`）是零依赖占位，不注入任何官方服务。
- 显隐实现约束（0.1.2 slot 选举制）：shadow 官方 tool-call 树再转发不可行
  （shadowed entry 对查询不可见，输赢取决于 bundle 加载顺序），插件只 shadow
  `assistant-step` / `turn-process`，tool-call / context 由按座位 anchor key
  生成的动态 CSS 控制显隐，官方组件原生渲染。

## 许可证

MIT
