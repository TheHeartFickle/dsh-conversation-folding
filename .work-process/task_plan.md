# dsh-conversation-folding 修复计划

> 用于审阅和指导后续实现。
> 目标仓库：`D:\git-project\dsh-conversation-folding`
> 配置目录：`C:\Users\admin\.dsh\profiles\web`
> 状态：已按六轮子 agent 审查修订，第六轮严重评级已并入，**关键选型已提前验证，待用户确认后再改代码**。

---

## 一、需求与 Bug 总览

### 1. 插件必须能正常加载（P0）
- 之前报错：
  ```
  Failed to load plugins @the-heart-fickle/dsh-conversation-folding
  failed to apply loader entry ...
  slot "tool.call.toolview" is already declared
  ```
- 根因：官方 `tool-call` 项已声明 `children: { "tool.call.toolview": ... }`；自定义 shadow 项不能再重复声明 `children`。
- 用户曾反馈“重启后插件压根不生效”，要求实际确认 `dsh web` 加载了 `@the-heart-fickle/dsh-conversation-folding`。
- 验收：`dsh web` 启动无 failed to load plugins；`/plugins/@the-heart-fickle/dsh-conversation-folding/client.js` 可访问；页面能出现插件效果。

### 2. 正文全部保留，只折叠过程
- 中间过程（reasoning / 非 skill 的 tool-call）折叠。
- 所有正文输出都必须保留。
- 历史 bug：“agent 输出的第一批正文会被折叠” → 正文不能被折叠进过程。
- 混合 `[reasoning + 正文]` 的 assistant-step：
  - 折叠时只显示正文，隐藏 reasoning；
  - 展开时显示完整 blocks。
- 正文渲染不能丢失官方能力（`fileMentions` / `useTurnData`），否则“保留正文”只是文字保留。

### 3. 分段折叠模型
- 节点按“用户请求 / 正文输出”或“两个正文输出之间”分段。
- 正常闭合段（已有前驱边界）的视觉顺序：
  ```
  用户输入
  折叠栏1
  正文1
  折叠栏2
  正文2
  ...
  折叠栏N
  最近一次过程    （当前段还未出正文时的预览）
  ```
- 当前段已出正文时：折叠栏下面直接显示正文；展开后显示该段全部过程。
- 边界节点本身不当作“过程”展示；同一个正文节点既结束上一段，也作为下一段的边界。
- 分段示例：
  ```
  节点: [u1, t1, b1, t2, b2]
  段:   [u1, t1]    // 用户输入开始，正文 b1 结束
        [b1, t2]    // 正文 b1 后开始，正文 b2 结束
  折叠栏1 放在 t1 上方，折叠栏2 放在 t2 上方。
  ```
- 不能把第 N 轮的步骤折叠进 N-1 轮的折叠栏。
- 历史 bug：“同一轮会话的两轮输出折叠状态同步，且所有过程都被折叠了而不是只保留最新一次。”
  - 同一轮里多个正文输出之间的过程应归各自段；
  - 当前段还没有正文时，要保留“最近一次过程”预览，不能把所有过程都彻底隐藏。

### 4. 每个折叠栏独立展开/收起
- 同一轮中多个正文之间的折叠状态互不同步。
- 最新实测 bug：“上一轮会话展开后，这一轮步骤也被展开了。”
- 状态 key 必须避免跨轮次/跨段串状态。
- 使用 `useSyncExternalStore` 模式：`segmentVersion` + `segmentListeners` + `getSnapshot`，点击后要能触发重渲染。

### 5. 折叠栏位置正确
- 折叠栏必须位于该段所有步骤的正上方，也就是该段第一个过程节点上方。
- 不能在最近一个步骤上方。
- 没有过程的正文段不要出现多余折叠栏。
- 历史反馈：“折叠栏展开后不在所有步骤的正上方，而是最近一个步骤的上方。”

### 6. 不擅自改折叠栏外部交互
- 只修折叠逻辑。
- 不改变“展开过程/收起过程”按钮的行为、外观和交互预期。

### 7. 插入 / steering 消息不能夹在折叠栏和最新步骤之间
- 历史 bug：“使用插入发送会话的时候，插入的会话会在折叠栏和最新步骤间。”
- 插入内容应作为用户输入边界。
- 折叠栏应放在插入 / steering 消息之后。
- 需要区分两种形态：
  - 已进入 `s.chat.order` 的 `steering` 节点；
  - 队列末尾 `pendingSteering` 气泡（不在 `s.chat.order` 中）。
- 如果用户反馈的是后者，计划不能只靠 `locations.getTurn(turn)` 处理，需要额外视觉/渲染方案。

### 8. 载入历史 / 刷新
- 历史 bug：“在载入历史时，如果折叠栏里面的历史过长会导致需要按下多次载入历史才能正确看到之前的历史。”
- 最新实测：
  - 刷新后历史被错误隐藏，需要手动“加载更早”；
  - 点击“加载更早”后折叠栏被错误展开；
  - 展开后折叠栏直接消失，无法折叠回去。
- 验收：
  - 不需要多次点击才能看到之前历史；
  - 加载更早后折叠状态不应错乱；
  - 展开/收起按钮稳定可用。

### 9. 折叠栏右侧显示折叠步骤数
- 在“展开过程/收起过程”按钮右边显示该折叠栏里折叠了多少步骤。
- 示例：`N 个步骤`。
- 不改变按钮本身。
- 沿用当前代码的中文硬编码风格（不新增 i18n 抽象）。

### 10. 最终确认加载
- 必须在 `dsh web` 实际确认插件加载成功。
- 不能只改完代码就说完成。

---

## 二、上一版实现失败原因

上一版在干净 HEAD 上直接实现了“数字 segment + turn”方案，实测出现：

- 刷新后历史被错误隐藏，需要加载；
- 点击“加载更早”后折叠栏被错误展开；
- 展开后折叠栏消失，无法折叠回去；
- 上一轮展开影响下一轮。

根因分析：

1. 折叠状态 key 使用 `turn + 数字 segment`。
2. 数字 segment 是“当前已加载顺序里数第几个正文”算出来的，历史加载 / 顺序变化后数字会变化，导致状态串到其他折叠栏或轮次。
3. 段索引按节点逐个 `useMemo` 且依赖 `s.chat.nodes` Map 引用，流式正文更新时可能不重算。
4. `auxVisible` 客户端默认是 `[]`，配置接口返回前 context 行会先被隐藏，刷新后历史看起来“变少”。
5. host 兜底仍返回 `[]`，会覆盖客户端默认值。

---

## 三、重构方案（修订版）

### 0. 已验证技术选型（实施前完成，不需要实现时再验证）

已在本轮提前查阅本地安装的 DSH 客户端源码确认以下选型：

1. **`useTurnData("turn-tail")` 可靠可用**
   - 来源：`@deepseek-ai/dsh-client-ui-conversation` 的 `CHAT_NODE_INJECT`。
   - `conversation.chat.node` 的父级声明注入 `turnData`，槽位渲染器会把 `useTurnData` 作为 prop 传给该 keyed 槽位内的所有 entry，包括我们的 `priority: -1` shadow。
   - 可直接在 `AssistantNodeView` 中 `const tail = props.useTurnData("turn-tail")`，不需要再扫描 `s.chat.order`。

2. **`props.sessionId` 可用**
   - 来源：`@deepseek-ai/dsh-client-ui-renderer` 的 `standardProps`。
   - session-scope 槽位（`conversation.chat.node`）的每个 entry 都会收到 `sessionId`，无歧义。

3. **`s.chat.locations.getTurn(turn)` 与 `s.chat.nodes.values()` 可作流式订阅**
   - 来源：`dsh-client-ui-conversation` 的 `MutableChatLocationIndex` / `MutableChatNodeStore`。
   - `getTurn(turn)` 返回稳定数组，内容变化时 index 会换引用；`nodes.values()` 返回缓存数组，`upsert` 后置 dirty 并返回新数组。
   - 二者都能作为 `useSession` selector 触发重渲染。

4. **DSH ModuleLoader 不支持相对子模块 require**
   - 来源：`@deepseek-ai/dsh-client-modules` 的 `makeRequire`。
   - 只解析：seed 字面量 → 已 materialize 模块 → 已注册包 id；不会解析 `./xxx`。
   - **结论：不采用 `require("./segments.js")`**，改由 `lib/segments.js` 作为 Node 测试源码 + `lib/client.js` 内嵌脚本生成的同源副本。

5. **`pendingSteering` 与 `steering` 节点是两种东西，且 Ctrl+Enter 插话会先经过 pendingSteering**
   - `pendingSteering`：`queue` 中 `placement === "steering"` 的行，由 `ChatView` 在全部 order 节点之后渲染，不在 `s.chat.order` 中。
   - 已接收的 steering：成为 `kind: "steering"` 的 chat 节点，在 `s.chat.order` 中。
   - **用户确认：描述 bug 时用的是 Ctrl+Enter 发送插入消息**。DSH 源码中 Ctrl+Enter 调用 `steerQueue()`，把 `placement === "queued"` 的行更新为 `steer`，随后以 `placement === "steering"` 的 pending 气泡渲染，最后才成为 durable `steering` 节点。
   - 但 `ChatView` 固定把 pending 渲染在所有 order 节点之后；`QueuedMessage` 没有 `seq/location`。**不要把它放进段状态机**。本轮只把落库后的 durable `steering` 作为边界；pending 气泡留给 DSH 官方渲染。

6. **分页锚点与当前 CSS 的冲突**
   - `data-chat-anchor-key` 在 ChatNodeSeat 外层 `div` 上；`loadOlder` 通过它记录并恢复 `anchorTop`。
   - 当前插件 CSS 用 `:has([data-dsh-hidden-turn]) { display:none }` 隐藏整个外层容器，会导致锚点行高度/位置消失，可能破坏分页恢复。
   - **结论：参考 master 的显示方案，隐藏行使用“非空占位 + 外层 `:has` 隐藏整行”，避免零高 flex item 继续占用列 gap；折叠栏所在行不放置隐藏占位。**

7. **`fileMentions`/owner 官方路径已确认**
   - 官方 `AssistantNodeView`：`tail = useTurnData("turn-tail")`；`owner` 需要 `turn.status === "closed"`、`data.finalNode`、`tail.closing.finalNode.seq` 匹配；最终 body 才传 `fileMentions(owner)`。

### 1. 稳定段 ID（状态机 + 前缘处理）

#### 正常状态机
- 段身份基于**真实聊天节点 key**。
- 边界节点：
  - `user`
  - `steering`
  - `body`：`assistant-step` 且 `hasVisibleBody(blocks)` 为 true。
  - `hasVisibleBody` 定义：至少有一个可见块；**text 块必须 `trim()` 后非空**，流式中的空 `""` 文本不得被当作已出正文。
- 扫描某个 turn 窗口的节点列表：
  - 输入：`turnKeys = s.chat.locations.getTurn(turn)`，`nodes = s.chat.nodes`，以及该 turn 的 `TurnLocation`（从任一节点的 `node.location.turn` 可取得）。
  - 维护 `lastBoundaryKey`、当前段统计（`firstProcessNodeKey` / `lastProcessNodeKey` / `processCount` / `hasBody`）。
  - 初始 `lastBoundaryKey = null`；窗口是否完整用 **`TurnLocation.start` 是否为 `undefined`** 判断：若已加载到 turn 起点，`start` 有值；若窗口从 turn 中间开始，`start === undefined`。**不能把当前窗口里第一个出现的边界当作前驱边界。**
  - 完整窗口（`TurnLocation.start !== undefined`，且窗口从该 turn 的开头 `user` / `steering` 开始）：
    1. 遇到 `user` / `steering`：它作为该段起点边界；`lastBoundaryKey = 该 key`，后续节点进入 `bnd:<该 key>`。
    2. 遇到**纯正文 `body`**（有可见 text/image 但无 reasoning）：该正文节点不作为过程；标记当前段 `hasBody = true`；之后 `lastBoundaryKey = 该正文 key`，后续节点进入 `bnd:<该正文 key>`。
    3. 遇到**混合 `[reasoning + 正文]` 的 `assistant-step`**（如 `[reasoning + text]`、`[reasoning + image]`）：它仍是正文边界（`hasBody = true`），且它的 `reasoning` 属于“切段前正在处理的段”的过程集合，参与该段 `processCount` / `firstProcessNodeKey` / `lastProcessNodeKey`；之后 `lastBoundaryKey = 该正文 key`，后续节点进入 `bnd:<该正文 key>`。
    4. 其他节点：属于当前段；若是 process，更新该段 `first / last / processCount`。
  - 不完整窗口（`TurnLocation.start === undefined`）：见下方前缘处理。
- `segmentIdOf(boundaryKey)`：
  - 有 `boundaryKey`：`bnd:<boundaryKey>`
  - 无 `boundaryKey`：见前缘处理。
- 纯正文 `body` 节点：永远渲染；不作为过程；不参与 `processCount`；不产生折叠栏。
- 混合 `[reasoning + 正文]` 节点：同一节点在 `segmentInfo` 中需要同时表达两种角色——`processSegmentOf(nodeKey)` 指向上一段（其 reasoning 所在），`boundarySegmentOf(nodeKey)` 指向下一段（切段后）。`buildSegmentIndex` 不得只返回单一 `segmentIdByKey` 混淆这两种角色。

#### 前缘处理（关键）
- DSH 分页实际按 message 边界，不是完整 turn 边界，因此窗口可能从 turn 中间开始。
- 窗口起点判定：
  - 用 `node.location.turn.start` 判断：`start !== undefined` 表示该 turn 的起点已在窗口内，视为完整窗口；
  - `start === undefined` 表示还有更早未加载节点，视为不完整窗口；这与第一个可见节点是 `user`、`steering`、process 还是 `body` 无关。
- 不完整窗口处理：
  - **前缘区** = “窗口起点 到 第一个已加载 durable 边界之前”的所有节点；它们标记为 `before:<该边界 key>`（如果还没有任何边界，标记 `head:<turn>`）。
  - 前缘区**不持久化折叠状态、不渲染折叠栏、也不隐藏任何已加载过程节点**；所有已加载过程按普通可见方式渲染。
  - **进入正常模型的具体规则：每遇到一个已加载 durable 边界（`user` / `steering` / `body`），该边界本身结束前缘区；它之后的所有节点进入 `bnd:<该边界 key>` 正常折叠模型，无论 `TurnLocation.start` 是否仍有值。**
  - 因此“加载更早”后无需等到 turn 起点出现；只要前缘区后面出现了任何 durable 边界，边界之后的段就进入正常模型；边界之前的节点保持前缘不折叠。
  - 折叠状态从 `undefined`（未展开）开始；不得把 `before:` / `head:` 临时状态迁移到正常段。
- 纯函数测试覆盖：
  - `[t1, b1, t2]` 且 `TurnLocation.start === undefined`：`t1` 为前缘不折叠；`t2` 为 `bnd:b1`；
  - `[u1, t1, b1, t2]` 且 `TurnLocation.start !== undefined`：`t1` 属于 `bnd:u1`；`t2` 属于 `bnd:b1`；
  - 加载更早后 `u1` 出现：`TurnLocation.start` 从未定义变为有值，`t1` 从 `before:b1` 迁移到 `bnd:u1`，且初始未展开；
  - **durable `user` 出现但 `TurnLocation.start` 仍为 undefined**：`u1` 之后的节点立即进入 `bnd:u1` 正常模型；`u1` 之前的前缘区保持不折叠；
  - 断言前缘段不产生折叠状态/折叠栏，后续段状态不串。

### 2. 折叠状态与订阅
- `Map<sessionId + ":" + segmentId, boolean>`。
- 所有组件统一从 `props.sessionId` 读取 sessionId（`conversation.chat.node` 标准注入 prop），不自行推断，避免出现 `"undefined:..."` 导致的跨会话串状态。可封装一个 `useSessionId(props)` 辅助函数。
- 不使用数字 turn/segment。
- 沿用现有 `useSyncExternalStore` 模式：
  - `segmentVersion`
  - `segmentListeners`
  - `subscribeSegment(listener)`
  - `getSegmentVersion()`
  - `isSegmentExpanded(sessionId, segmentId)`
  - `setSegmentExpanded(sessionId, segmentId, expanded)`
- **订阅约定（必做）**：所有在 `mode === "all"` 下读取 `segmentExpanded` 的组件（`AssistantNodeView`、`ToolCallGroup`、`ContextNodeView`）必须通过 `useSyncExternalStore(subscribeSegment, getSegmentVersion)` 订阅 `segmentVersion`；`ProcessFold` 自身也必须订阅，不依赖父组件重渲染。否则点击折叠栏后 ToolCallGroup/ContextNodeView 不会同步更新。
- 清理策略（定稿）：按 `sessionId` 分组存储 `segmentExpanded`；**不依赖未确认的 DSH session 卸载钩子**。**不在渲染期间用 `activeSessionId` 主动清空上一个会话**，避免切回旧会话丢状态、并发挂载互相清空；默认保留已访问 session 的折叠状态。仅当确认 DSH 提供可用的 session 卸载/scope 销毁钩子后，再调用 `clearSessionSegments(sessionId)` 做内存回收。

### 3. 段索引与内容更新订阅
- `buildSegmentIndex(turnKeys, nodes, turn, turnLocation)`：
  - 输入 `turnKeys = s.chat.locations.getTurn(turn)`，`nodes = s.chat.nodes`，`turnLocation = node.location.turn`（用于 `start` 判定完整窗口）；
  - 返回 `segmentInfo`、`processSegmentOf(nodeKey)`、`boundarySegmentOf(nodeKey)`、`segmentOfNode(nodeKey)`；**不提供单一 `segmentInfoByNode` / `segmentIdByKey`**，避免混合正文节点“过程角色”和“边界角色”冲突。
- `segmentInfo` 每项：`firstProcessNodeKey`、`lastProcessNodeKey`、`processCount`、`hasBody`、`segmentId`、`isFrontEdge`。
- 订阅方式必须让组件在流式内容更新时真正 re-render：
  ```js
  var nodes = useSession(function (s) { return s.chat.nodes; });
  var turnKeys = useSession(function (s) { return s.chat.locations.getTurn(turn); });
  var nodeValues = useSession(function (s) { return s.chat.nodes.values(); });
  var turnLocation = turnKeys.map(function (k) { return nodes.get(k)?.location?.turn; }).find(Boolean);
  var index = React.useMemo(function () {
    return buildSegmentIndex(turnKeys, nodes, turn, turnLocation);
  }, [turnKeys, nodeValues, turn, turnLocation]);
  ```
  - `turnLocation` 为空（找不到节点或 turn 无值）时按“不完整窗口/前缘”处理。
- 依赖 `s.chat.nodes.values()` 是因为 DSH 当前实现返回数组，内容变化时会换引用；若后续 DSH 改变返回值稳定性，需要额外引入 `nodeVersion` 信号。
- 不能只依赖 `s.chat.nodes` Map 引用。

### 4. 渲染规则
- 折叠栏只渲染在该段第一个过程节点上；没有过程就没有折叠栏。
- `ProcessFold` 接收 `sessionId`、`segmentId`、`processCount`；由 `AssistantNodeView` / `ToolCallGroup` 从 `buildSegmentIndex` 得到的 `segmentInfo` 传入，不再由组件内部通过 turn 自行推断。
- 所有正文节点始终渲染。
- 混合 `[reasoning + 正文]` 正文节点（`hasReasoning && hasVisibleBody`，含 reasoning+image；既是正文边界也是过程承载节点）：
  - 该节点永远作为正文节点渲染；
  - 若它属于某个段的 `firstProcessNodeKey`，其上方渲染该段的 `ProcessFold`；
  - collapsed：按 `shouldHideReasoning(...)` 判断；正常 collapsed 隐藏 reasoning、只渲染正文；展开：完整渲染全部 blocks。
  - **例外：若 `segmentInfo.isFrontEdge === true`，`shouldHideReasoning` 必须返回 false**——前缘区不折叠任何已加载过程，包括混合 nodes 的 reasoning；`shouldHideReasoning` 仅用于这种混合 `[reasoning + 正文]` 正文节点。
  - 该节点的 `reasoning` 计入所在段（切段前的那一段）的 `processCount`；`body` 部分同时作为该 turn 的正文边界，切出下一段。
- 纯正文 `body` 节点：永远渲染，不作为过程节点，不参与 `processCount`，也不产生折叠栏。
- 过程节点：
  - 折叠时隐藏；
  - 展开时全部显示；
  - 当前段还没有正文时，只显示最近一次过程预览；该预览节点必须完整渲染 blocks（含 reasoning/tool-call），不得再按 `shouldHideReasoning`/`shouldHideProcessContent` 隐藏自身。
- 单过程且无正文时：同一节点既是 first 又是 last，必须渲染 `折叠栏 + 该过程内容`，不能只渲染折叠栏。
- 折叠/展开切换不得卸载外层 `data-chat-anchor-key` 或折叠栏自身：同一次展开→收起→展开后，折叠栏元素必须仍在原位置且可再次切换（作为“展开后折叠栏直接消失”的回归验收项）。
- 模式边界：
  - 本次只重构 `all` 模式；
  - `toolcall` / `none` 保留现有分支行为；
  - `toolcall` 模式继续使用局部 `useState`，不使用新的全局 `segmentExpanded`。

### 5. 边界与插入
- `user` / durable `steering` 按状态机作为边界。
- 折叠栏放在 durable `steering` 之后；`steering` 本身不作为可折叠过程。
- **pendingSteering 不纳入段状态机（第五轮审查定稿）**：
  - DSH 源码路径：Ctrl+Enter → `steerQueue()` → `placement === "queued"` 改为 `steer` → ChatView 以 `placement === "steering"` 渲染 pending 气泡 → 落库后成为 durable `steering` 节点。
  - DSH 的 `ChatView` 渲染顺序是 `order.map(ChatNodeSeat)` → `TurnStatus` → `pendingSteering.map(PendingSteeringBubble)`；pending 气泡始终在所有 order 节点之后，不存在“旧 order 与新 order 之间的 DOM 位置”。
  - `QueuedMessage` 只有 `id` / `messageId` / `placement` / `content` 等，没有 `seq` / `location`，无法也没有必要把它插入 turn 顺序；不要用虚拟边界去建模一个不存在的中间位置。
  - 因此本轮**不**让 `buildSegmentIndex` 接收 queue/pendingSteering；pending 气泡继续由 DSH 官方渲染，插件不得隐藏或改写它的位置。
  - 实际修复点：pending 落库成为 `kind: "steering"` 的 order 节点后，状态机按 durable 边界切段，折叠栏不会把它夹在折叠栏和最新步骤之间。
- 验收：durable `steering` 不夹在折叠栏和最新步骤之间；`Ctrl+Enter` 复测时应确认 pending 气泡不被插件隐藏/遮挡，且落库后的 steering 节点正常作为边界。

### 6. `context` / `skill` 辅助项接入新段模型（仅 `all` 模式）
- `ContextNodeView` 仅当 `mode === "all"` 时使用：
  - 先用 `buildSegmentIndex` 的 `segmentOfNode(node.key)` 计算所属 `segmentId`（context 不是过程也不是正文边界，不能用 `processSegmentOf`）；
  - 可见条件：`segmentExpanded(sessionId, segmentId) || includesAux("context")`。
- `ToolCallGroup` 的 `skill` 分支仅当 `mode === "all"` 时使用：
  - 先用 `segmentOfNode(node.key)` 计算所属 `segmentId`；
  - 可见条件：`segmentExpanded(sessionId, segmentId) || includesAux("skill")`。
- **前缘段特殊规则**：前缘段不渲染折叠栏、不产生 `segmentExpanded`，但 `context` / `skill` **仍按全局 `includesAux` 判断**（默认 `context`+`skill` 显示；用户配置 `auxVisible: []` 则隐藏），不因前缘段强制全部显示。
- `toolcall` / `none` 模式保持现有逻辑，不改为 segment 判断。

### 7. 历史加载/刷新
- 段索引随 `turnKeys` / `nodeValues` 变化重算；正常闭合段的 `segmentId` 稳定，状态不串。
- 前缘不完整段不持久化状态，避免“加载更早”后状态漂移。
- 分页/锚点具体策略（第四轮审查后改为规格，不再是“优先考虑”）：
  - 删除会对 `[data-chat-flow-kind=...]` 外层 seat 设置 `display:none` 的 CSS；
  - 隐藏行改为非空 `HiddenProcessNode()` / `HiddenAuxNode()`，并通过对 `[data-chat-flow-kind=...]` 外层 seat 的 `:has(...)` 规则隐藏整行，避免零高 flex item 继续占用 16px 列 gap；
  - 折叠栏所在行只渲染 `ProcessFold`，不放置隐藏占位，避免 `:has` 把折叠栏一起隐藏；
  - 不要求固定高度占位；当前优先修复折叠栏与正文之间的大段空白；
  - 若后续实测隐藏行锚点对分页有影响，再为这些行设计非布局型锚点方案；目前不保留隐藏行的布局占位。
- 需求 8 纳入本轮：
  - 实际验证“加载更早”滚动 / 分页；
  - 若隐藏行影响 DSH 分页 / 锚点，本轮一并修复，不推迟。

### 8. 配置默认值
- client 默认 `auxVisible` 改为 `["context", "skill"]`。
- **同步修改 host 兜底**：`lib/index.js` 的 `auxVisible` 兜底也改为 `["context", "skill"]`。
- 明确取舍：
  - 如果 profile 实际配置了 `auxVisible: []`，配置接口返回前会短暂显示 context/skill，形成一次闪烁；
  - 需要同步更新 `cordis.patch.yml` 注释和 `README.md` 中“代码内部默认全部隐藏”的表述。
- 只改默认值，不改 host 加载路径。
- 增加 host 默认值测试：不传 `auxVisible` 时 `/api/conversation-folding/config` 返回 `["context","skill"]`。

### 9. 正文渲染保真
- `AssistantNodeView` 使用槽位注入的 `useTurnData("turn-tail")` 获取 `tail`，**不再扫描 `s.chat.order` 找 `turn-tail` 节点**；避免 message 边界分页下尾节点不在窗口内导致最终正文/mentions 判定错误。
- 精确镜像官方 `AssistantNodeView` 的 owner/mentions 逻辑：
  - 仅当 `turn.status === "closed"` 且 `data.finalNode !== undefined` 时构造 owner；
  - 仅当 `tail.closing.finalNode.seq === data.finalNode.seq` 时视为 final body；
  - owner 需要包含 **`TurnLocation` 对象**（`node.location.turn`，带有 `.status`），以及 `seq`、`openFile`；不能只传 `turnOf(node)` 返回的数字 turn（数字没有 `.status`，会导致 `turn.status === "closed"` 永远为 false、`fileMentions` 失效）；
  - `mentions` 只在满足官方条件时传入，其余正文传 `undefined`。
- 注意：所有有可见正文的 assistant-step 都渲染正文（需求 2），不要再用“是否最终正文”来决定是否渲染正文；`closingOfTurn` / `isClosingAssistantNode` 从实现中移除，对应静态测试同步改为断言 `useTurnData("turn-tail")` 路径。
- 不能只概括为“传官方 fileMentions/useTurnData”。
- 范围边界：本次 `useTurnData` / `fileMentions` 的正文保真只保证 `all` 模式；`toolcall` / `none` 保持现有分支行为，不额外恢复 `fileMentions`，作为已声明的已知限制。

### 10. 折叠栏步骤数
- `ProcessFold` 在按钮右侧显示 `processCount + " 个步骤"`。
- 不改变按钮本身的行为与外观。

### 11. 保持插件加载安全
- 继续使用现有 `makeToolViewRenderer`。
- 不重复声明 `tool.call.toolview`。
- 不改 host 注册结构。

### 12. 测试策略
- 纯函数模块边界（已提前验证，见 §0.4）：
  - DSH ModuleLoader 的 `require` **不支持相对子模块**，因此不采用 `require("./segments.js")`。
  - 模块格式定为：`lib/segments.js` 是 **ESM 纯函数源文件**（只有 `function` 声明 + 末尾 `export { ... }`，不依赖 `react`/`window`/其他包）。
  - `scripts/sync-segments.mjs` 读取 `lib/segments.js`，去掉末尾 `export {...}` 行，把其余函数体原样写入 `lib/client.js` 的生成标记之间；生成块不需要再写 CJS `module.exports`。
  - `lib/client.js` 使用显式生成标记：`// <<< GENERATED: lib/segments.js >>>` 与 `// <<< END GENERATED: lib/segments.js >>>`；`scripts/sync-segments.mjs` 只替换标记之间的内容。
  - 生成标记位置：位于 `factory` 函数体内、`var React = require("react")` 之后、`exports.apply = apply;` 之前，使生成函数与现有辅助函数处于同一闭包作用域。
  - `package.json` 增加 `pretest` / `prepack` 时运行 `node scripts/sync-segments.mjs`；测试里校验 `lib/client.js` 中生成块与 `lib/segments.js` 去掉 export 后的函数体一致。
  - 规范化比较定义：读取两个文件 → 生成块去掉两行标记 → 去掉最后一个换行 → 与 `lib/segments.js` 去掉 `export {...}` 尾行后的内容做精确字符串比较；不做模糊正则。
  - 不让测试退化成字符串搜索。
- `processCount` 语义固定：只统计非 skill 的 `tool-call` 和含 reasoning 的 `assistant-step`（含混合正文的 `reasoning`）；`user` / `steering` / `context` / `skill` / 纯正文 `body` 不计入。
- 从 `lib/segments.js` 导出纯决策辅助函数，供渲染层调用：
  - `buildSegmentIndex(turnKeys, nodes, turn, turnLocation)`
  - `segmentIdOfBoundary(boundaryKey)`
  - `processSegmentOf(nodeKey)` / `boundarySegmentOf(nodeKey)` / `segmentOfNode(nodeKey)`
  - `isFrontEdgeSegment(segmentInfo)`
  - `shouldRenderFoldBar(segmentInfo, nodeKey)`
  - `shouldHideProcessContent(segmentInfo, nodeKey, expanded)`
  - `shouldHideReasoning(segmentInfo, node, expanded)`
  - `shouldHideAux(segmentInfo, auxKey, expanded, includesAuxResult)`（context/skill 用）
  - 这些函数覆盖“混合 `reasoning + 正文`（含 reasoning+image）的折叠/展开渲染规则”，避免只能用 React 渲染器测试。
- `shouldHideProcessContent` 明确语义：
  - 前缘段：永不隐藏；
  - 有正文段 + collapsed：所有 process 隐藏；
  - 无正文段 + collapsed：仅最后 process 可见（预览），其余隐藏；
  - 任意段 + expanded：全部可见。
- 辅助函数契约（实施前定稿）：
  - `buildSegmentIndex` 返回 `{ segmentInfo, processSegmentOf, boundarySegmentOf, segmentOfNode }`；**不提供 `segmentInfoByNode` / 单一 `segmentIdByKey`**。
  - `SegmentInfo` 字段：`segmentId`、`isFrontEdge`、`hasBody`、`firstProcessNodeKey`、`lastProcessNodeKey`、`processCount`。
  - `processSegmentOf(nodeKey)`：节点作为“过程”所属的段；仅 process 或混合 body 有值，其余 `undefined`。
  - `boundarySegmentOf(nodeKey)`：节点作为“边界”开启的下一段；仅边界节点有值，其余 `undefined`。
  - `segmentOfNode(nodeKey)`：仅表示节点按位置落在哪个段，不承担过程/边界角色；**只供 context/skill 等既不是过程、也不是边界的辅助节点查询**。对过程、`user` / `steering`、纯正文/混合正文等过程/边界节点返回 `undefined`。
  - `shouldHideReasoning(segmentInfo, node, expanded)`：仅用于混合 `[reasoning + 正文]` 正文节点（`hasReasoning && hasVisibleBody`）；`segmentInfo.isFrontEdge === true` → `false`；普通 collapsed 且节点含 reasoning → `true`；expanded 或节点不含 reasoning → `false`。无正文段的最后预览纯过程节点不走此函数，必须完整渲染。
  - `shouldHideAux(segmentInfo, auxKey, expanded, includesAuxResult)`：接收已经算好的 `includesAux(auxKey)` 结果，不直接读全局 config。
- 现有静态测试与新行为冲突，需要**在同一批实现中同步更新**：
  - 将“仅最终正文”断言改为“所有有可见正文的 assistant-step 都渲染”；
  - 将 `closingOfTurn` / `isClosingAssistantNode` 的断言改为 `useTurnData("turn-tail")` 路径；
  - 增加 host 默认 `auxVisible` 返回 `["context","skill"]` 的测试。
- 补充纯函数测试（不需要浏览器）：
  - 稳定 segmentId：两个正文之间过程不共享段状态；
  - 窗口从 turn 中间截断：前缘段不折叠/不持久化状态；
  - 加载更早后边界出现：前缘段状态不迁移不串；
  - **durable `user` 出现但 `TurnLocation.start` 仍为 undefined**：`u1` 后的节点立即进入 `bnd:u1`；
  - **前缘区首个混合 `[reasoning + 正文]` body（含 reasoning+image）**：`shouldHideReasoning` 返回 false；
  - **空 `""` text 块**：不计入 `hasVisibleBody`，不产生正文边界；
  - 混合 `reasoning + 正文` 节点（含 reasoning+image）：属于前一段过程集合且可作为首过程渲染折叠栏；
  - `segmentOfNode`：context/skill 等非过程、非边界节点返回位置归属段；对 process、`user` / `steering`、纯正文/混合正文等过程/边界节点返回 `undefined`；与 `processSegmentOf`/`boundarySegmentOf` 不冲突；
  - 无正文段 collapsed 的最后预览纯过程节点：必须完整渲染 blocks（含 reasoning），不得被 `shouldHideReasoning`/`shouldHideProcessContent` 隐藏自身；
  - 流式场景：同一节点从纯 `reasoning` 变为混合 `[reasoning + 正文]` 时，`hasBody`、`processSegmentOf`、`boundarySegmentOf` 的最终状态正确；
  - `user` / `steering` / `body` 边界归属与独立折叠。
- 静态 / 回归验证（除纯函数外必须覆盖）：
  - 所有隐藏分支必须返回非空占位（`HiddenProcessNode` / `HiddenAuxNode`），且包含针对 `[data-chat-flow-kind=...]` 外层的 `:has` 隐藏规则，保证隐藏行不参与列 gap。
  - 交互回归：点击折叠栏后 `ToolCallGroup` 的过程隐藏状态与 `ContextNodeView` 的 aux 可见性必须同步变化，证明这些组件已订阅 `segmentVersion`。
  - 至少做轻量模拟确认 `turnKeys` / `nodeValues` 变化会使 `buildSegmentIndex` 重算；若无法自动化，必须列入强制手工回归清单。
  - 手工回归清单必须包含：刷新、加载更早、流式过程中正文从无到有（折叠栏/最后预览不消失）、展开→收起→展开后折叠栏不消失、上一轮展开不影响下一轮、`pendingSteering` 不被插件隐藏/遮挡。
- 分两阶段：
  1. 实现阶段：所有测试必须可运行，`node --test` 全绿；
  2. 用户实际验证通过后：再定稿最终断言和浏览器验收记录，不把“临时可运行”与“最终定稿”混为一谈。

---

## 四、实施步骤与验证

1. 抽取纯函数模块 `lib/segments.js` 并生成 `lib/client.js` 内嵌同源副本：实现稳定段 ID 状态机 + 前缘不完整段处理，并让 Node 可直接测试。
2. 接线 `AssistantNodeView` / `ToolCallGroup` / `ContextNodeView`，改用 `useTurnData("turn-tail")`；再接入 `ProcessFold`。
3. 同步修改 host 默认 `auxVisible` 为 `["context","skill"]`。
4. 保留 `makeToolViewRenderer`，不改 `tool-call` 注册结构。
5. 同批更新测试：更新冲突静态测试 + 增加纯函数测试 + host 默认值测试。
6. 静态验证：
   - `node --check lib/segments.js`
   - `node --check lib/client.js`
   - `node --check lib/index.js`
   - `node scripts/sync-segments.mjs`（确保生成块同步后无 diff）/ `node --test`
7. 用户实际验证 `dsh web`：
   - 插件加载；
   - 刷新后历史正常；
   - 加载更早后折叠状态不串；
   - 每个折叠栏独立展开/收起；
   - 展开后折叠栏不消失；
   - 上一轮展开不影响下一轮；
   - durable `steering` 不夹在折叠栏和步骤之间；
   - `Ctrl+Enter` 插话复测：pending 气泡不被插件隐藏/遮挡，且出现在所有 order 行（含折叠栏和最新 process）下方；落库后的 steering 节点正常作为边界；
   - 折叠栏在段首、步骤数显示正确。
8. 确认无误后再定稿测试。

---

## 五、当前状态

- 工作树未改代码：`lib/client.js`、`lib/index.js`、`lib/segments.js`（尚未创建）均保持干净/不存在。
- 第四、五、六轮子 agent 审查已完成并并入：前缘初始边界矛盾、混合 reasoning+text 边界角色、fileMentions 需 TurnLocation 对象、`TurnLocation.start` 判定完整窗口、`lib/segments.js` 模块格式等已修订。
- 第六轮严重评级：**无 SEVERE 问题**；剩余为 5 个 MODERATE 和若干 MINOR，已在本计划中定稿。
- 第七轮子 agent 审查：发现 **7 个 P2 级问题**，均已修订归档：统一 `segmentOfNode` / `shouldHideAux` 签名 / `SegmentInfo` 字段，明确 `shouldHideReasoning` 仅用于混合正文节点及最后预览完整渲染，明确 `fileMentions` 仅保证 `all` 模式，补充流式/锚点/占位回归验证，取消渲染期主动清空旧 session 状态。
- 第八轮子 agent 复核：发现 **3 个 P2 级问题**，已修订归档：`segmentOfNode` 明确只服务非过程/非边界节点且对过程/边界返回 `undefined`；混合正文统一为 `hasReasoning && hasVisibleBody`（覆盖 reasoning+image）；补充流式角色变化与前缘迁移回归。
- 第九轮子 agent 终审：发现 **1 个 P2 级问题**（`segmentVersion` 订阅未覆盖所有读取 `segmentExpanded` 的组件），已修订：明确 `AssistantNodeView` / `ToolCallGroup` / `ContextNodeView` 必须订阅 `segmentVersion`，`ProcessFold` 自身也订阅，并加入同步交互回归。
- 用户确认 Ctrl+Enter 插话走 `pendingSteering` 路径；第五轮审查定稿：**pendingSteering 不纳入段状态机**，只把落库后的 durable `steering` 作为边界。
- 文档同步已完成：`README.md` 与 `cordis.patch.yml` 注释已改为“未配置时默认 `context` + `skill`”。
- 等待用户确认本计划；确认后按本计划实施代码。
