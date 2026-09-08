# dsh-conversation-folding 缺陷台账

来源标记：`[commit]` 用户在 git commit 中报告；`[browser]` 浏览器实测复现；
`[code]` 代码/官方 bundle 分析确认。状态：`待修复` / `修复待验证` / `已修复`。

## 架构重构（2026-09-07）

「修一个 bug 又出新 bug / 老 bug 复发」的机制级根因（`[code]` 对照官方
dsh-client-ui-chat 0.1.2 分析）：

1. **分段在每个视图组件的每次渲染中重复推导**（旧 `segmentsOfTurn` 无缓存），
   栏与内容可能在同一次更新中读到不同的分段结果 →「栏在、展开却无内容」类 bug。
2. **可见性分散在三处判定**（React 分支 + 动态 CSS + 静态 CSS 与官方
   `hidden="until-found"` 的对抗），结果依赖挂载顺序与优先级细节 → 按下葫芦
   浮起瓢（B10「漏出↔过隐藏」振荡即此）。
3. **segKey 有 4 种临时格式且流式中漂移**（`turn:N:pending` ↔
   `turn:N:pending:<startKey>`）→ 展开态丢失、规则反复重建。
4. **边界条件以视图补丁实现**（无正文轮挂样式同步器、steering 特判），
   新场景必然再打补丁。

重构范式（SPEC.md §0）：**对话视口 = 轨迹的可视化 + 信息过滤**——
轨迹模型（纯函数，R 规则）→ 视图投影（纯函数，F/B/S 规则）→ 单一生效层；
`buildTimeline` / `projectView` 为可单测纯函数，经 `exports.__test` 由
Node 加载真实 bundle 驱动（test/model.test.mjs）。

## 待修复

（无）

## 修复待验证（已实现 + 浏览器实测通过，待用户验收）

### B1 `[commit]` 点击一次「加载更早」补不完整
- **现象**：折叠模式下历史过程被隐藏，官方「加载更早」每次只 prepend 50 条
  事件；点一次常常看不到任何变化，需要连点多次。
- **修复**：`apply()` 捕获用户对「加载更早」的真实点击，`autoLoadOlderTick()`
  由 `setTimeout` 驱动持续补点（`AUTOLOAD_TICK_MS=120`），不依赖 React 某次
  渲染；官方每次翻页会重挂按钮节点，旧节点断连后按 `findLoadOlderBtn()` 按文本
  重新找到当前按钮再续点。
- **停止条件**：点击时记录最旧折叠栏（`data-seg-key`/步骤数），每完成一页后若
  该折叠栏已经不再是第一个折叠栏（它前面的上一段/上一轮加载出来了），或步骤数
  不再增长，说明它的段已补完整，立即停止；**不一次加载全部历史**。

### B2 `[commit]` 多正文输出被合并折叠
- **现象**：一轮内多次输出正文，所有中间过程被合并到同一个折叠栏。
- **修复**：折叠单位改为「段」（`segmentsOfTurn`），阶段状态按段后正文 key
  存储；每段独立折叠栏、独立计数、独立展开/收起。

### B3 `[commit]` 0.1.2 座位全灭
- **现象**：插件注册 `assistant-step` 后出现 11 个 `data-slot-error`，正文座位全灭。
- **根因 `[code]`**：官方 chat 以默认 priority 0 注册同名 key；同 key 同
  priority 抛 `already has an entry`。
- **修复**：注册 `assistant-step` 时显式 `priority: -1`（同 key 不同 priority
  是合法影子，低者渲染）。

### B9 `[browser]` 正文含代码块时崩溃
- **现象**：插件 AssistantMarkdown 给官方 `MarkdownText` 的 props 名写错
  （`codeLabels`），官方代码渲染器读取 `labels.code.copyLabel` 时崩溃。
- **根因 `[code]`**：官方 `MarkdownText` 期望 `{text, streaming, labels,
  fileMentions}`，`labels` 由 `markdownLabels` 生成（code/footnotes）。
- **修复**：按官方结构传 `labels`。

### B10 `[browser]` 无正文轮的 tool-call：漏出 ↔ 过隐藏（两轮修复）
- **现象**：
  1. 初版：被中断/中止的轮（没有最终正文，只有 reasoning + tool-call）里，
     思维链被折叠，但 tool-call 仍出现在对话流中；
  2. 第一轮修复后反向过隐藏：收起时全部隐藏了，但**展开折叠栏也不显示任何
     步骤**（用户 2026-09-07 报告）。
- **根因 `[code]`**：
  1. 初版 `closingOfTurn` 要求 turn-tail 带 `closing`（最终正文），中止轮被
     误判为「流式中」→ 保留 tool-call 预览；
  2. 第一轮修复（`turnEnded` + 尾段节点挂样式同步器）解决了收起方向，但可见
     性仍分散判定 + 分段无共享缓存：展开时栏与内容的分段判定/样式写入不同步
     （详见「架构重构」），展开方向失效。
- **修复（随架构重构）**：R3（turn-tail 即闭合）+ F3（闭合轮开放段收起全隐
  无预览）+ F5（展开全显）由同一投影决定；单一样式写入器保证栏与内容一致。
- **验证 `[browser]`**：开发会话 50 条 tool-call 收起 0 可见；中止轮
  （t9:open）展开后 tool-call 与 ThinkBox 全部可见，收起还原 0 可见。
  机械化用例：model.test.mjs「R3 中止轮」「B10 展开方向」。

### B13 `[browser]` 流式尾段空档随步骤数增大
- **现象**：正文未出的流式阶段，折叠栏与内容之间的空档随过程步骤增多而变大
  （2026-09-07 用户报告「还是没修」——此前列入预期但未修复）。
- **根因 `[code]`**：旧实现可见性分散判定叠加官方 compact 过程窗口，隐藏的
  过程座位以非零高度参与布局（未逐项隔离；随重构消除）。
- **修复（随架构重构）**：投影 F3/F4 统一显隐；过程座位隐藏后不占布局。
- **验证 `[browser]`**：新会话流式轮（tool-call 2→4→6 增长期间）每 3s 采样，
  栏下空档恒定 16px（官方 flow gap）；轮结束后预览收敛（T-E2 同测）。

### B14 `[browser]` Ctrl+Enter 插入消息未使用新折叠栏
- **现象**：Ctrl+Enter 插入消息（代码逻辑上是新一轮对话）后，插入点之后的
  过程步骤未归入新折叠栏。
- **根因 `[code]`**：旧实现 steering 边界的段落账依赖 `pending` segKey
  （`turn:N:pending` ↔ `turn:N:pending:<startKey>` 流式中漂移），插入点后的
  步骤可能沿用旧栏/旧展开态。
- **修复（随架构重构）**：R2 把 user/steering 显式作为段边界——插入点后的
  过程落入新段（segKey = 边界键/`t<turn>:open`），新段必有独立折叠栏。
- **验证 `[browser]`**：新会话实测——运行中轮 Ctrl+Enter 插入，宿主排队为
  新轮（turn 2），turn 1 过程（2 工具调用）与 turn 2 过程各自独立成栏、
  无合并；同 turn 的 steering 切段由机械化用例覆盖（model.test.mjs
  「I1/R2 steering 边界」）。

### B15 `[browser]` 多正文轮的折叠栏全部堆在轮顶
- **现象**：一轮内有多次正文输出（正文 → 过程 → 正文 …）时，该轮全部折叠栏
  排列在轮顶部，不是每轮正文上方各自一栏（2026-09-07 用户报告）。
- **根因 `[code]`**：B12 的修复把「一轮的全部栏」集中渲染在该轮 turn-process
  座位（轮顶）——栏位由「渲染容器在哪」决定，而不是由段边界在轨迹中的位置
  决定（I1 违例）。轮内只有一个正文时栏顶恰好等于正文上方，掩盖了问题。
- **修复（B2 栏锚定）**：投影把 `barsByTurn`（按轮聚合）改为 `barsByAnchor`
  （锚点节点键 + before/after）：正文封口的段 → 栏落座该正文座位内、正文上方；
  steering 封口段/开放尾段 → 落座同轮前一个正文下方（收起时紧贴其后边界内容）；
  段前无正文 → 兜底落座该轮 turn-process 座位。模型层 R6 记录锚定信息（每轮
  turn-process 键、每段封口前最后正文 prevBody）。取代 B12 的「集中轮顶」落位。
  （⚠️ 本条修复时的锚点=段终点方案，其「展开步骤在栏上方」的取舍被 B16 推翻：
  锚点改为段首，展开方向与官方一致。）
- **验证 `[browser]`**：新会话构造正文→工具→正文轮——两条栏分别落座两个
  assistant-step 座位（`data-bar-pos=before`、栏-正文间隙 8px），turn-process
  座位无栏；收起 tool-call 隐藏、展开可见，正文内思维链随其栏独立联动；
  流式首段栏兜底在 turn-process 座位（segKey `t<N>:open`），出正文后迁移到
  该正文座位（segKey 换边界键，S2 稳定性不受影响）；normal/compact 模式零
  介入；0 debug error。机械化：B2 锚定系列 4 用例（model.test.mjs）。

### B16 `[browser]` 展开折叠栏后步骤出现在栏上方（与官方显示相反）
- **现象**：展开折叠栏时，栏只贴着其正文（段末），段内其他步骤出现在栏上方——
  官方 turn-process 语义是控件在上、内容在下（2026-09-07 用户报告）。
- **文档核查**：B15 修复时 SPEC B2（v2）曾把「正文封口段展开步骤在栏上方」
  写成规则——该规则本身与官方语义相悖，属文档错误，随本条修正（v3）。
- **根因 `[code]`**：B2 v2 把栏锚定在「段的边界（终点）」：收起时段内步骤
  隐藏，栏恰好紧贴其后正文（B15 达成）；展开后步骤按轨迹原位出现在栏上方。
- **修复（B2 v3）**：锚点从「段终点」改为「**段首**」——展开 =
  `[栏][步骤][正文]`（官方一致），收起时段内步骤隐藏、栏仍紧贴其后正文
  （B15 保持，栏位与点击目标不随展开状态跳动）。落座规则（barAnchorOf）：
  `a)` 无步骤思考正文段 → 正文上方；`b)` 段跟正文后 → 前正文下方；
  `c)` 轮首段 → turn-process 座位；`d)` steering 后段首步是插件过程步 →
  该步内（隐藏过程步座位也渲染栏），段首步是官方渲染 → 已知妥协（闭合段
  落座封口正文上方）。模型 R6 增加 startCtx（段首前边界类型）。
- **验证 `[browser]`**：多正文轮（正文→工具→正文）展开第二栏——tool-call
  位于栏下方（栏 bottom 172 / tool-call top 188，视口坐标），收起后紧贴其后
  正文；轮首段（含 context）栏落座 turn-process 座位；0 debug error。
  机械化：B2 v3 系列 7 用例（model.test.mjs，含 ④a/④b/回退链）。

### B17 `[browser]` 不折叠条目之间出现随折叠步数累积的异常间隔
- **现象**：一些不折叠的条目（正文、官方渲染的 tool-call/context 等）之间出现
  异常空隙，空隙大小与两条目之间被折叠的步骤数量成正比（2026-09-07 用户报告）。
- **文档核查**：SPEC/BUGS 均无座位盒子与条目间距的记载——未记载缺陷，
  随本条补入（SPEC §2.2「座位盒子契约」）。
- **根因 `[code]`**：隐藏的 assistant-step 座位此前空渲染并依赖官方
  `.flowItem:empty` 兜底隐藏——但影子座位的 slot 容器（`display:contents` div）
  永远存在，flowItem 永不为 `:empty`，兜底从不生效（代码注释中的假设错误）。
  零高座位盒子仍被官方间距规则
  `.EvIC1a_column > :not([hidden]):not(:empty) ~ :not([hidden]):not(:empty) { margin-top:16px }`
  命中，而条目容器是 flex 列布局、margin 不塌缩 → 每个被折叠 assistant-step
  座位稳定残留 16px，N 个连续折叠步骤 = N×16px。官方自身无此问题：官方
  compact 隐藏是在 flowItem 元素上设 `hidden` 属性（其间距规则显式
  `:not([hidden])`，display:none 连 margin 一起消失）；插件影子只控制座位
  内容、不拥有 flowItem 元素，设不了 `hidden`，必须自备等价机制。
- **修复**：隐藏且无锚定栏的过程步、空载步 → 渲染 `data-dsh-hidden-turn`
  隐藏占位，由既有静态 CSS `:has` 规则 display:none 收掉座位盒子（其 margin
  随之消失）；FoldStyleMount 保留在座位内（display:none 不影响 effect 运行），
  样式写入覆盖面不变。有锚定栏的隐藏座位（B2 ④a）照旧渲染栏、座位保持可见。
- **验证 `[browser]`**：修复前 1 个空载步即令相邻条目间距 32px
  （16 幻影 + 16 正常，flex 实测）；同页 A/B——单段 4 个被折叠思考步的轮，
  修复态间距 16px，DOM 移除 4 个标记（模拟修复前）→ 64px = 4×16 幻影 + 16
  正常，重载恢复 → 16px：间隔 ∝ 折叠步数实测成立，展开态行为无损。
  全会话扫描（9 栏原位 / 5 标记座位 / 间距最大 16px / 0 debug error）
  见 REGRESSION T-B5。

### B12 `[browser]` 折叠栏位置在步骤下方，展开后步骤全在栏上方
- **现象**：展开折叠栏后，该段的过程步骤出现在折叠栏上方，与官方 turn-process
  的“控件在上、内容在下”不一致。
- **根因**：插件原先把折叠栏挂在正文节点顶部；过程节点在 DOM 中位于正文之前，
  因此展开后它们显示在栏上方。
- **修复**：影子替换官方 `turn-process`，把一轮的全部段折叠栏渲染到轮顶部
  （turns 级过程区），展开后各段步骤位于栏下方。
  （⚠️ 该落位方案已被 B15 的 B2 栏锚定取代：栏改锚定到各段边界原位，
  不再集中轮顶。）
- **验证 `[browser]`**：真实会话 `turn-process` 项包含全部折叠栏，展开首栏后
  下方出现对应 Think 内容；21 栏 / 0 slot error / 折叠步骤 0 溢出。

### B11 `[browser]` 加载全部历史后步骤从折叠栏溢出
- **现象**：点击一次「加载更早」把所有历史加载完后，新增的 tool-call /
  context 过程没有被折叠栏收住，直接显示在对话流里（类似从折叠栏溢出）。
- **根因 `[code]`**：compact 视图给这些过程座位 `hidden="until-found"`，
  插件的静态 unhide 规则
  `[data-chat-flow-key][hidden]:not(:has([data-dsh-hidden-turn])){display:block!important}`
  优先级高于动态隐藏规则，导致带 `hidden` 的过程节点被强制显示；动态样式后插入
  并未取胜（优先级不足）。
- **修复**：`pushHideRules` 生成的动态规则增加 `[data-chat-flow-kind]`，
  拉平与静态 unhide 规则的优先级，并靠动态样式后插入胜出。
- **验证 `[browser]`**：真实会话 139 条 tool-call，修复前 30 条可见，
  修复后 0 条可见；按钮一次加载完，0 slot error。

## 已修复（保留历史记录）

| # | 缺陷 | 根因 | 修复 |
|---|---|---|---|
| B4 | tool-call 折叠失效 | 0.1.2 按座位选举，shadow tool-call 后官方树不可见 | 不 shadow tool-call，改动态 CSS 按 anchor key 隐藏 |
| B5 | context 折叠失效 | 同上 | 同上 |
| B6 | 官方 turn-process 栏与插件重复 | compact 视图官方栏仍显示 | all 模式隐藏官方 turn-process 栏 |
| B7 | hidden="until-found" 使过程座位消失 | compact 用 content-visibility:hidden | 抵消官方隐藏并还原 display:block |
| B8 | normal/compact 行为不一致 | 上述因素叠加 | CSS/规则统一，SPEC §2.4 |

## 验收纪律

- 修改后先跑 `npm test`（模型/投影机械化用例），再在浏览器实际操作验证生效层
  （normal/compact、收起/展开、多正文分段、一次点击补点、流式过程、中止轮、
  Ctrl+Enter 插入）；条目清单见 REGRESSION.md。
- 插件 client.js 变更后须重启 dsh web 实例（composition 缓存）；页面若经
  HMR 多次热更，先整页刷新再验证（多实例会累积旧样式元素，干扰判定）。
- 语法通过 ≠ 功能正确。
