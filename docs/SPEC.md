# dsh-conversation-folding 功能规格（应实现的行为）

本文件是插件「应该做成什么样」的契约，作为后续修改与回归测试的依据。
安装与配置见 README.md；当前缺陷与根因见 BUGS.md；回归条目见 REGRESSION.md。

## 0. 核心范式：对话视口 = 轨迹的可视化 + 信息过滤

对话自上而下阅读即轨迹自上而下翻阅。任何功能修改都必须先通过这一条的检验：

- **I1 轨迹不变量**：视口内一切可见内容的位置必须与轨迹顺序一致；折叠是把
  「段」的过程信息从视口滤除并在**轨迹原位**保留折叠栏入口，绝不把信息移过
  边界（user / steering / 正文）。因此 Ctrl+Enter 插入（steering 边界，代码
  逻辑上开启新一轮对话）必须产生**新折叠栏**——若把其后步骤合入之前的栏，
  视口顺序即与轨迹错位。
- **I2 单一事实**：`chat.order + chat.nodes` 快照是唯一输入；轨迹模型由快照
  确定性推导（按快照身份缓存），所有视图共享同一份模型与投影。
- **I3 决策单点**：每个节点键的可见状态由投影**恰好决定一次**；动态样式文本
  是（模型 × UI 状态）的纯函数。禁止视图组件各自判定可见性。
- **I4 边界即规则**：边界条件（中止轮、steering、流式尾段、历史补点）是模型
  /投影里的显式规则（R/F/S 编号，见 §2），不是视图里的特判补丁。新增节点
  类型只在 `classifyNode` 分类表登记一个角色。

实现分层（lib/client.js 自上而下）：配置/显示模式/展开状态三个 store →
§4 轨迹模型（纯函数 `buildTimeline`）→ §5 视图投影（纯函数 `projectView`）→
§6-§10 生效层（缓存订阅、单一样式写入器、视图组件、补点行为、装配）。
模型与投影经 `exports.__test` 供 Node 单测加载真实 bundle 驱动（不渲染组件）。

## 1. 折叠模式（foldMode）

| foldMode | 行为 |
|---|---|
| `all`（默认） | 插件接管过程折叠：reasoning + 非 skill tool-call 折叠进折叠栏，正文永不折叠 |
| `toolcall` | 官方原生渲染（0.1.2 slots 选举制下不再做 toolcall 分组），仅保留 thinking 增强样式 |
| `none` | 关闭折叠，仅保留 thinking 增强样式 |

**启用条件（新增「折叠」对话显示模式）**：DSH 官方「对话显示」下拉中新增第三项
「折叠」；只有选中「折叠」时插件才接管过程折叠与 turn-process，官方
`normal` / `compact` 两种模式完全不受影响。插件模式存于
`localStorage["dsh-conversation-folding.displayMode"]`，选择后自动重载页面生效。

`auxVisible` 辅助显示项：`skill`、`context` 可选在折叠态保持可见。

## 2. all 模式折叠语义（核心）

规则编号与 lib/client.js §4/§5 内注释一致；机械化测试见 test/model.test.mjs。

### 2.1 轨迹模型与段（R 规则）

- **段（segment）** = 两个边界（user / steering / 正文）之间的全部过程节点
  （过程 = reasoning + 非 skill tool-call）。
- **R1 轨迹顺序**：严格按 `chat.order` 迭代，不重排、不跨边界合并。
- **R2 边界封口**：user/steering/正文 封口当前段并开启新段——steering
  （Ctrl+Enter 插入）逻辑上开启新一轮对话，必须产生**新折叠栏**（范式 I1）。
- **R3 轮闭合**：turn 内出现 `turn-tail` 即闭合，不要求带最终正文 closing；
  中止/中断轮同样闭合（B10 根因之一）。
- **R4 空段不落账**：封口时 keys 为空的段不生成；正文带思维链时例外
  （落账为「1 条消息」栏，联动正文内思维链显隐）。
- **R5 尾段开放**：轮末未封口的段 endType=open（流式尾段；轮闭合时即中止轮尾段）。
- **segKey 稳定格式**：闭合段 = 段后边界节点 key（跨「加载更早」/重渲染稳定）；
  开放段 = `t<turn>:open`（边界出现后自然换键）。展开状态按 segKey 存储。
- 一个折叠栏只折叠一个正文前的一段过程；一轮 N 次正文输出 → N 个折叠栏。
- **B2 栏锚定（渲染位置）**：栏渲染在其所折叠段的**段首上方**——官方
  turn-process 语义「控件在上、内容在下」，展开 = `[栏][步骤][正文]`（B16）；
  收起时段内步骤隐藏，栏视觉上紧贴其后边界内容，每轮正文上方各自一栏、
  不集中堆在轮顶（B15）。落座规则（`barAnchorOf`，全部显式）：
  `a)` 无步骤的思考正文段 → 该正文座位内、正文上方（联动正文内思维链）；
  `b)` 段直接跟在正文后 → 前一正文座位内、正文下方（= 段首上方）；
  `c)` 轮首段（段前是 user 边界）→ 该轮 `turn-process` 座位（缺节点按回退链
  prevBody 下方 → 封口正文上方）；
  `d)` 段跟在 steering 后 → 段首步是插件过程步时落座该步内、其内容上方；
  段首步是官方渲染（tool-call/context）时为**已知妥协**——官方 steering 座位
  不可注入，闭合段落座封口正文上方（收起仍紧贴其后正文）、开放段落座
  prevBody 下方。

### 2.2 视图投影与显隐（F/B/S 规则）

- **F1** 正文永不隐藏；**F2** 收起的闭合段：段内过程/辅助全部隐藏
  （辅助项受 auxVisible 豁免）；**F3** 收起的开放段且轮已闭合（中止轮）：
  全部隐藏、无预览；**F4** 收起的开放段且轮未闭合（流式）：仅最近一条过程
  保留为预览；**F5** 展开的段：全部可见；**F6** 过滤决策不跨段。
- **B1 栏落账**：有工具调用或过程推理的段必有栏；正文段且正文带思维链也必有栏；
  纯问答段无栏。
- **B2 栏锚定**：见 §2.1——栏锚定在其所折叠段的段首上方（官方「控件在上、
  内容在下」语义）。模型 R6 提供锚定信息（每轮 turn-process 键、段前最后正文
  prevBody、段首前边界类型 startCtx），投影输出 `barsByAnchor`（锚点键 +
  before/after），落座由纯函数 `barAnchorOf` 决定。
- **栏文案**（官方 turn-process 格式）：`N 个工具调用 · M 条消息`；
  仅思考正文段 `1 条消息`；无正文尾段 `N 个工具调用` 或 `思考了一会儿`。
- **样式契约**：动态隐藏规则选择器优先级不低于静态 unhide 规则
  （`[data-chat-flow-key][data-chat-anchor-key][data-chat-flow-kind]`），
  动态样式元素置于静态样式之后，同优先级靠源顺序取胜；assistant-step 座位由
  插件渲染、走 React 隐藏，动态 CSS 只管官方渲染的 tool-call / context。
- **座位盒子契约（B17）**：影子座位「无内容」时（隐藏且无锚定栏的过程步、
  空载步）必须渲染 `data-dsh-hidden-turn` 隐藏占位，由静态 CSS `:has` 规则
  display:none 收掉整个座位盒子；禁止空渲染。原因：影子座位的 slot 容器永远
  存在，官方 `.flowItem:empty` 兜底对影子座位永不生效；零高座位盒子仍被官方
  `~` 间距规则加 margin-top，条目容器为 flex 列布局、margin 不塌缩——空渲染
  会在不折叠条目之间留下随折叠步数累积的幻影间隔（每座位 16px）。有锚定栏的
  隐藏座位（B2 ④a）例外：渲染栏、座位保持可见。
- **S 补点停止条件**：见 §3。
- 状态跨重渲染保持；每段独立收起/展开互不影响。

### 2.3 正文

- 正文（assistant-step 的 text/image 等可见 block）永远渲染，任何折叠态都不隐藏正文。
- 正文内的 reasoning：其前段（bodySeg）收起时隐藏；展开时以增强 ThinkBox 显示
  （默认展开、可滚动、生成中自动跟随底部）；前段不存在（纯问答）时不隐藏。
- 空载步（无可见 block 且无 reasoning 的 assistant-step）恒隐藏，座位以
  隐藏占位收掉（B17，见 §2.2 座位盒子契约）。

### 2.4 工具调用与上下文的显隐

- 0.1.2 slots 为选举制（每 cell 只暴露赢家、输赢随 bundle 顺序变化），插件**只影子**
  `assistant-step` 与 `turn-process`（显式 priority: -1，见 §4），不影子
  tool-call / context。
- tool-call / context 由官方渲染，显隐由投影生成的动态 CSS 完成（F2/F3/F4）。
- 官方 compact 视图（turn-process 系统）在 all 模式下由插件接管：静态 unhide
  规则抵消 `hidden="until-found"` 的隐藏。`transcriptView=normal` 与 `compact`
  两种设置下行为一致。

## 3. 历史加载（人机交互需求）

- 点击一次「加载更早」必须**把当前最旧折叠栏的过程补完整**：持续翻页直到
  `a)`（S1）被监视的折叠栏不再是对话流中的第一个折叠栏（它前面的上一段/上一轮
  已加载），或 `b)`（S2）该折叠栏步骤数不再增长（新页没有给它补充更多过程）为止。
  S2 的步骤数读投影模型（`segByKey[watchSeg].steps`），不解析栏内文本。
- **不加载全部历史**：不得把会话一直拉到顶部；只加载到“能看到的折叠栏步骤全部
  加载完成”即可停止。
- 官方 `loadOlder` 每次只加载 50 条事件（见 BUGS.md B1），插件须消除该分页
  对折叠场景的影响。

## 4. 注册与兼容性约束（0.1.2）

- shadow 官方 key 时必须**显式声明 priority**：同 key 同 priority 会抛
  `already has an entry`；同 key 不同 priority 才是合法影子，**低 priority 渲染**。
- 插件 client.js 变更后须重启 dsh web 实例才会进入 composition batch。
- 验证分两层：`npm test` 驱动真实 bundle 的模型/投影（R/F/S/B 规则全部有
  机械化用例）；浏览器（Chrome + browser-harness）实际操作验证生效层与官方
  交互（normal/compact、收起/展开、多正文分段、补点、流式、中止轮、
  Ctrl+Enter）。语法通过 ≠ 功能正确；回归条目见 REGRESSION.md。
