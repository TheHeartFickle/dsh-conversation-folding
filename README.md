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

- **辅助项可见性可配置**
  - 代码内部默认将上下文注入、skill 加载等辅助项全部隐藏。
  - 插件默认配置把 `context` 和 `skill` 列为例外，因此安装后仍会显示。
  - 在 profile 中用 `auxVisible: []` 可覆盖为全部隐藏。

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
3. 想要关闭整轮折叠时，修改配置中的 `foldMode` 即可。

## ⚙️ 配置

在 profile 的 `cordis.patch.yml` 中配置：

```yaml
- id: conversation-folding
  name: '@the-heart-fickle/dsh-conversation-folding'
  config:
    foldMode: 'all'
    auxVisible:
      - context
      - skill
```

`foldMode` 可选值：

| 值 | 行为 |
|---|---|
| `all` | 整轮折叠，默认值 |
| `toolcall` | 只折叠 thinking 之间的 tool call |
| `none` | 关闭整轮折叠和 tool-call 分组，保留 thinking 增强样式 |

`auxVisible` 是“折叠时仍显示”的辅助项例外列表：

- `context`：上下文注入行；不在列表中时折叠状态下隐藏。
- `skill`：skill 加载行；不在列表中时折叠状态下隐藏。
- `auxVisible: []` 表示所有辅助项都隐藏（相当于之前的全隐藏行为）。

## 🗂️ 效果示意

**思考阶段（正文未开始）**

```text
用户输入
┌──────────────────────────────┐
│ 折叠栏：展开过程              │
└──────────────────────────────┘
最近一次 thinking / tool call（增强样式）
```

**正文输出后**

```text
用户输入
┌──────────────────────────────┐
│ 折叠栏：展开过程              │
└──────────────────────────────┘
LLM 输出（原生正文样式）
```

## 🔧 环境要求

- Node.js ≥ 20
- DSH（DeepSeek Harness）

## 许可证

MIT
