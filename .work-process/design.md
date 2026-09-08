# dsh-conversation-folding 代码设计

> 依据 `task_plan.md`（第六轮评审后版本）生成。
> 本文只描述实现设计，不写具体代码；待用户确认后再进入编码。
> 目标仓库：`D:\git-project\dsh-conversation-folding`

---

## 一、设计目标

1. 插件在 `dsh web` 正常加载，不重复声明 `tool.call.toolview`。
2. 保留所有正文；只折叠过程（reasoning / 非 skill 的 tool-call）。
3. 使用基于真实节点 key 的稳定 segment ID，避免数字 segment 在历史加载/刷新后漂移。
4. 每个 segment 独立展开/收起，状态 key 为 `sessionId + ":" + segmentId`。
5. 折叠栏渲染在 segment 第一个过程节点正上方。
6. 处理 durable `steering` 作为边界；`pendingSteering` 不纳入段状态机。
7. 修复分页/刷新/加载更早相关状态问题。
8. 折叠栏右侧显示 `N 个步骤`。
9. 只改 `all` 模式；`toolcall` / `none` 保持现有分支行为。

---

## 二、非目标 / 范围外

- `pendingSteering` 气泡不参与段状态机。DSH `ChatView` 渲染顺序为：
  `order.map(ChatNodeSeat) → TurnStatus → pendingSteering.map(PendingSteeringBubble)`，
  pending 始终在所有 order 节点之后，且 `QueuedMessage` 没有 `seq/location`，无法也不需要插入 turn 顺序。
- 不修改官方 `tool-call`、`assistant-step`、`context` 的注册结构。
- 不新增 i18n；沿用中文硬编码。

---

## 三、文件布局

```
dsh-conversation-folding/
├── lib/
│   ├── index.js          # host：默认 auxVisible 改为 ["context","skill"]
│   ├── client.js         # 浏览器端：嵌入生成的 segments 函数体 + 组件改造
│   └── segments.js       # ESM 纯函数源文件（Node 测试直接 import）
├── scripts/
│   └── sync-segments.mjs # 去掉 segments.js 的 export 尾行，写入 client.js 生成标记
├── test/
│   └── plugin.test.mjs   # 更新静态断言 + 增加纯函数测试
└── package.json          # 增加 pretest / prepack 调用 sync-segments.mjs
```

### `lib/segments.js` 与嵌入方式

- `lib/segments.js` 是 **ESM 纯函数源文件**：
  - 只有 `function` 声明，不依赖 `react` / `window` / 其他包；
  - 末尾有一行 `export { ... }`，供 Node `import`。
- `lib/client.js` 中放置两行生成标记：
  ```
  // <<< GENERATED: lib/segments.js >>>
  // <<< END GENERATED: lib/segments.js >>>
  ```
- `scripts/sync-segments.mjs`：
  - 读取 `lib/segments.js`；
  - 删除末尾 `export { ... };` 行；
  - 把剩余函数体原样写入 `lib/client.js` 的两个标记之间。
- 标记位置：位于 `factory` 函数体内、`var React = require("react")` 之后、`exports.apply = apply;` 之前，保证生成函数与现有辅助函数在同一闭包作用域。
- 不在浏览器端使用 `require("./segments.js")`，因为 DSH ModuleLoader 不支持相对路径。

---

## 四、核心数据结构

### 4.1 `SegmentInfo`

```ts
interface SegmentInfo {
  segmentId: string;          // 正常段 "bnd:<boundaryKey>"；前缘段 "before:<boundaryKey>" 或 "head:<turn>"
  isFrontEdge: boolean;       // 前缘不完整段
  hasBody: boolean;           // 该段是否已出现正文输出
  firstProcessNodeKey?: string;
  lastProcessNodeKey?: string;
  processCount: number;
}
```

### 4.2 `SegmentIndex` 返回值

```ts
interface SegmentIndex {
  // 不提供单一 segmentInfoByNode：混合 [reasoning + 正文] 节点同时属于上一段（过程）和下一段（边界），
  // 组件必须分别使用 processSegmentOf / boundarySegmentOf。
  // 非过程/非边界的定位查询单独用 segmentOfNode，不承担过程/边界角色。
  segmentInfo: Map<segmentId, SegmentInfo>;
  processSegmentOf: (nodeKey: string) => string | undefined;
  boundarySegmentOf: (nodeKey: string) => string | undefined;
  segmentOfNode: (nodeKey: string) => string | undefined;
}
```

- `processSegmentOf(nodeKey)`：节点作为“过程”所属的段；仅 process 或混合 `[reasoning + 正文]` body 有值。
- `boundarySegmentOf(nodeKey)`：节点作为“边界”开启的下一段；仅边界节点（user/steering/body）有值。
- `segmentOfNode(nodeKey)`：仅表示节点按 `turnKeys` 位置落在哪个段，不承担过程/边界角色；**只供 context/skill 等既不是过程、也不是边界节点的辅助节点查询**。对 process、`user` / `steering`、纯正文 `body`、混合正文等过程/边界节点返回 `undefined`；返回 `undefined` 可能表示该节点不是 `segmentOfNode` 的适用对象，也可能表示不在当前窗口段内，调用方不应将其当作错误。
- 混合 body 同时有“过程”和“边界”两个角色，所以**不使用单一 `segmentIdByKey` 代替上述三个查询**。

### 4.3 折叠状态

```ts
// 模块级
const segmentExpanded = new Map<string, boolean>(); // key = sessionId + ":" + segmentId
let segmentVersion = 0;
const segmentListeners = new Set<() => void>();

function subscribeSegment(listener): () => void;
function getSegmentVersion(): number;
function isSegmentExpanded(sessionId, segmentId): boolean;
function setSegmentExpanded(sessionId, segmentId, expanded): void;
function clearSessionSegments(sessionId): void; // 仅在确认可用的 session 卸载/销毁钩子中调用
```

清理策略（不依赖未确认的 DSH session 卸载钩子）：

- 状态按 `sessionId + ":" + segmentId` 天然隔离；**不在渲染期间用 `activeSessionId` 主动清空上一个会话**。
- 默认保留所有已访问 session 的折叠状态；切回旧会话不丢状态，并发挂载也不会互相清空。
- 只有确认 DSH 提供可用的 session 卸载/scope 销毁钩子后，才调用 `clearSessionSegments(sessionId)` 做内存回收；未确认前不主动清理。
- “当前 session 只保留自己的条目”不作为本轮强制契约；若后续内存增长成为问题，再引入 LRU/上限策略，但不得牺牲多会话状态隔离。

---

## 五、纯函数设计

### 5.1 `hasVisibleBody(blocks)`

判断一个 `assistant-step` 是否已出**正文**：

- 只有 `block.kind` 不是 `reasoning` 且不是 `tool-call` 的块才算“可见正文块”；
- `text` 块必须 `block.text.trim() !== ""` 才算可见正文；
- `image` 等非过程块按可见正文计数；
- 空 `""` text、纯 `reasoning`、纯 `tool-call` 都不产生正文边界。

### 5.2 `isProcessNode(node)`

```ts
function isProcessNode(node): boolean {
  return node &&
    (
      (node.kind === "tool-call" && !isSkillToolCall(node)) ||
      (node.kind === "assistant-step" && hasReasoning(node))
    );
}
```

- 纯正文 body 不是 process。
- 混合 `[reasoning + 正文]`（如 `[reasoning + text]`、`[reasoning + image]`）是 process，也同时是 body 边界。
- `segments.js` 需要自包含以下纯函数：`hasReasoning`、`toolCallName`、`isSkillToolCall`、`isProcessNode`、`hasVisibleBody`、`segmentIdOfBoundary`、`isFrontEdgeSegment`、`buildSegmentIndex`（含 `segmentOfNode`）及渲染决策辅助函数；`client.js` 中相应旧定义 `hasReasoning` / `isSkillToolCall` / `isProcessNode` 若与生成块重复，必须删除并统一使用生成块。

### 5.3 `buildSegmentIndex`

```ts
buildSegmentIndex(
  turnKeys: readonly string[],
  nodes: Map<string, ChatNode>,
  turn: number,
  turnLocation?: TurnLocation
): SegmentIndex
```

扫描算法：

- 初始 `lastBoundaryKey = null`；
- `turnLocation === undefined` 或 `turnLocation.start === undefined` 均表示 turn 起点未加载（不完整窗口）；
- 遍历 `turnKeys`：
  1. `user` / `steering`：
     - 结束前缘区；
     - `lastBoundaryKey = nodeKey`；
     - 后续节点进入 `bnd:<nodeKey>`。
  2. 纯正文 `body`（`hasVisibleBody && !hasReasoning`）：
     - 标记当前段 `hasBody = true`；
     - `lastBoundaryKey = nodeKey`；
     - 后续节点进入 `bnd:<nodeKey>`。
  3. 混合正文 body（`hasVisibleBody && hasReasoning`，例如 `[reasoning + text]` / `[reasoning + image]`）：
     - 标记当前段 `hasBody = true`；
     - 该节点的 `reasoning` 计入**当前段**（切段前的段）的 `processCount` / first / last；
     - `boundarySegmentOf(nodeKey) = bnd:<nodeKey>`；
     - `lastBoundaryKey = nodeKey`；
     - 后续节点进入 `bnd:<nodeKey>`。
  4. 其他节点：
     - 若是 process，更新当前段的 process 统计。
- 前缘区规则：
  - `TurnLocation.start === undefined` 时，**在前缘区（第一个 durable 边界之前）**的节点属于 `before:<边界key>` 或 `head:<turn>`；
  - 前缘区不产生折叠状态、不渲染折叠栏、不隐藏任何过程；
  - 遇到任何 durable 边界后，边界之后的节点立即进入正常 `bnd:` 模型，无需等 `TurnLocation.start` 变为有值。

### 5.4 渲染决策辅助函数

| 函数 | 返回语义 |
|---|---|
| `shouldRenderFoldBar(segmentInfo, nodeKey)` | `nodeKey === firstProcessNodeKey && !isFrontEdge && processCount > 0` |
| `shouldHideProcessContent(segmentInfo, nodeKey, expanded)` | 前缘恒 false；有正文 collapsed 时所有 process true；无正文 collapsed 时除 last 外 true；expanded 恒 false |
| `shouldHideReasoning(segmentInfo, node, expanded)` | 仅用于混合 `[reasoning + 正文]` 正文节点：前缘恒 false；普通 collapsed 且有 reasoning 时 true；expanded 时 false。无正文段的最后预览纯过程节点不走此函数，始终完整渲染 |
| `shouldHideAux(segmentInfo, auxKey, expanded, includesAuxResult)` | `isFrontEdge ? !includesAuxResult : !expanded && !includesAuxResult` |

> `shouldHideAux` 接收已经算好的 `includesAuxResult`，不在辅助函数内直接读全局 config。

> `shouldHideReasoning` 只用于“混合 `[reasoning + 正文]` 正文节点”（`hasReasoning && hasVisibleBody`）；当无正文段 collapsed 且某纯过程节点被 `shouldHideProcessContent` 判定为最后预览时，必须完整渲染其 blocks（含 reasoning），不得调用 `shouldHideReasoning` 将其隐藏成空白。

---

## 六、组件改造

### 6.1 `AssistantNodeView`

- 使用 `props.useTurnData("turn-tail")` 获取 `tail`，不再扫描 `s.chat.order` 找 `turn-tail`。`useTurnData` 已确认会注入 shadow entry。
- **流式订阅（必做）**：
  ```js
  var turnKeys = useSession(function (s) { return s.chat.locations.getTurn(turn); });
  var nodes = useSession(function (s) { return s.chat.nodes; });
  var nodeValues = useSession(function (s) { return s.chat.nodes.values(); });
  var turnLocation = turnKeys.map(function (k) { return nodes.get(k) && nodes.get(k).location && nodes.get(k).location.turn; }).find(Boolean);
  var index = React.useMemo(function () {
    return buildSegmentIndex(turnKeys, nodes, turn, turnLocation);
  }, [turnKeys, nodeValues, turn, turnLocation]);
  ```
  不能只订阅 `s.chat.nodes` Map 引用；必须让流式内容更新触发 `turnKeys` / `nodeValues` 换引用。
- `mode === "all"`：
  - 订阅 `segmentVersion`，并订阅上述 `index`；
  - 使用 `index.processSegmentOf(node.key)` 获取该节点的过程段；使用 `index.boundarySegmentOf(node.key)` 获取该节点的边界段。
  - 所有有可见正文的 `assistant-step` 始终渲染正文（`AssistantMarkdown`）。
  - 混合 body：
    - collapsed：按 `shouldHideReasoning(...)` 判断，正常 collapsed 隐藏其 reasoning、只渲染正文；若所属过程段 `isFrontEdge === true`，`hideReasoning` 必须为 `false`；
    - expanded：完整渲染；
  - 若 `index.processSegmentOf(node.key)` 对应的 segment 满足 `shouldRenderFoldBar`，先渲染 `ProcessFold`（父组件会因 index/segmentVersion 变化重渲染）。
  - 纯 process 节点：
    - 若 `shouldHideProcessContent(...)` 为 true，返回非空 `HiddenProcessNode()`（内部 `data-dsh-hidden-process`），由外层 `:has` 隐藏整行；
    - 展开时渲染完整内容；
    - 若当前段无正文且 collapsed，仅最后 process 可见作为预览；该预览节点必须完整渲染 blocks（含 reasoning/tool-call），不得再按 `shouldHideReasoning`/`shouldHideProcessContent` 隐藏自身。
- **fileMentions / owner（正文保真，必须实现）**：
  - 仅当 `turn.status === "closed"` 且 `data.finalNode !== undefined` 时构造 owner；
  - `tail` 来自 `props.useTurnData("turn-tail")`；
  - 仅当 `tail && tail.closing && tail.closing.finalNode.seq === data.finalNode.seq` 时视为最终正文；
  - owner 必须包含 `TurnLocation` 对象（`node.location.turn`），以及 `seq`、`openFile`；不能使用 `turnOf(node)` 数字 turn；
  - 只有满足最终正文条件时才传 `mentions = fileMentions(owner)`，其余正文传 `mentions: undefined`。
- `mode === "toolcall"` / `"none"`：保持现有分支，不接入 segment 状态；本次也不额外恢复 `fileMentions`/owner 路径。**正文保真（`useTurnData` + `fileMentions`）只保证 `all` 模式**，`toolcall` / `none` 沿用现有行为作为已知范围限制。

### 6.2 `ToolCallGroup`

- `mode === "all"`：
  - **必须订阅 `segmentVersion`**（`useSyncExternalStore(subscribeSegment, getSegmentVersion)`），并订阅相同的 `buildSegmentIndex` 输入（`turnKeys` / `nodeValues` 换引用触发重算）；点击折叠栏后 ToolCallGroup 必须同步重渲染；
  - `skill` tool-call：段归属用 `index.segmentOfNode(node.key)`；`segmentExpanded(sessionId, segmentId) || includesAux("skill")` 时可见，否则返回非空 `HiddenAuxNode()`（内部 `data-dsh-hidden-aux`），由外层 `:has` 隐藏整行；
  - 非 skill tool-call：
    - 若 `shouldHideProcessContent(...)` 为 true，折叠时隐藏；
    - 展开时渲染；
    - 首过程位置渲染 `ProcessFold`；
    - 无正文 collapsed 时最后 process 预览。
- `mode === "toolcall"`：保留现有 group 逻辑，不接入 segment 状态。
- `mode === "none"`：直接渲染官方 tool 树。

### 6.3 `ContextNodeView`

- `mode === "all"`：
  - **必须订阅 `segmentVersion`**（`useSyncExternalStore(subscribeSegment, getSegmentVersion)`），并订阅相同的 `buildSegmentIndex` 输入（`turnKeys` / `nodeValues` 换引用触发重算）；
  - segment 归属：**context 节点本身不是过程也不是正文边界**，统一使用 `index.segmentOfNode(node.key)` 取它位置落在哪个段；不要使用 `processSegmentOf`（对 context 返回 `undefined`）。
  - 可见条件：`segmentExpanded(sessionId, segmentId) || includesAux("context")`；
  - 判断为不可见时返回非空 `HiddenAuxNode()`（内部 `data-dsh-hidden-aux`），由外层 `:has` 隐藏整行，避免零高 flex item 仍占用 16px 列 gap；
  - 前缘段不渲染折叠栏，但 context/skill 仍按 `includesAux` 判断，不强制显示。
- `toolcall` / `none`：保持现有逻辑。

### 6.4 `ProcessFold`

```js
ProcessFold({ sessionId, segmentId, processCount, ... }) {
  React.useSyncExternalStore(subscribeSegment, getSegmentVersion); // 自身订阅状态，不依赖父组件重渲染
  const expanded = isSegmentExpanded(sessionId, segmentId);
  const toggleLabel = expanded ? "收起过程" : "展开过程";
  return (
    <div className="dsh-turnfold dsh-turnfold-process">
      <button onClick={() => setSegmentExpanded(sessionId, segmentId, !expanded)}>
        {toggleLabel}
      </button>
      <span className="dsh-turnfold-count">{processCount} 个步骤</span>
    </div>
  );
}
```

- 不再从 `turnOf(node)` 推算状态；
- 折叠/展开切换不卸载外层 seat 或折叠栏自身。

---

## 七、host / 配置

- `lib/index.js` 默认 `auxVisible` 改为：
  ```js
  auxVisible: ["context", "skill"]
  ```
- client 默认 `configState.auxVisible` 同步改为 `["context", "skill"]`。
- 若 profile 配置了 `auxVisible: []`，配置接口返回前会短暂显示 context/skill，作为已知闪烁取舍。
- `cordis.patch.yml` / `README.md` 已同步描述。

---

## 八、CSS 改造

- **删除**以下对 `[data-chat-flow-kind=...]` 外层 seat 的 `display:none`：
  ```css
  [data-chat-flow-kind="tool-call"]:has([data-dsh-hidden-toolcall]){display:none}
  [data-chat-flow-kind="assistant-step"]:has([data-dsh-hidden-turn]),
  [data-chat-flow-kind="tool-call"]:has([data-dsh-hidden-turn]),
  [data-chat-flow-kind="context"]:has([data-dsh-hidden-turn]){display:none}
  ```
- 改为与 master 一致的“非空占位 + 外层 `:has` 隐藏”：
  ```css
  [data-chat-flow-kind="assistant-step"]:has([data-dsh-hidden-process]),
  [data-chat-flow-kind="tool-call"]:has([data-dsh-hidden-process]),
  [data-chat-flow-kind="tool-call"]:has([data-dsh-hidden-aux]),
  [data-chat-flow-kind="context"]:has([data-dsh-hidden-aux]) { display:none }
  [data-dsh-hidden-process]{display:none}
  [data-dsh-hidden-aux]{display:none}
  ```
- 保留折叠栏所在行不包含隐藏占位：`shouldHideProcessContent` 为首过程折叠时只返回 `ProcessFold`，隐藏占位只放在纯隐藏行。
- **所有隐藏占位必须是非空元素**：`HiddenProcessNode()` 返回 `<div data-dsh-hidden-process></div>`，`HiddenAuxNode()` 返回 `<div data-dsh-hidden-aux></div>`；并配合外层 `:has` 隐藏整行，避免零高 flex item 占用列 gap。
- 若后续实测 `loadOlderAnchored` 依赖隐藏行锚点，再为这些行设计非布局型锚点方案；当前以修复 gap bug 优先。
- 折叠栏右侧步骤数样式：
  ```css
  .dsh-turnfold-count { color: var(--dsw-alias-label-tertiary); font-size: 0.75rem; }
  ```
- **`toolcall` / `none` 模式兼容**：
  - `all` 模式统一走 `data-dsh-hidden-process` / `data-dsh-hidden-aux` 非空占位 + 外层 `:has` 隐藏；
  - `toolcall` 模式原先用 `data-dsh-hidden-toolcall` 的隐藏规则也改为非空占位 `data-dsh-hidden-process`，并配合外层 `:has` 隐藏，以保持与 master 一致；
  - 不得再写任何针对 `[data-chat-flow-kind]` 的 `display:none`。

## 九、测试设计

### 9.1 纯函数测试（Node 直接 import `lib/segments.js`）

- 稳定 `segmentId`：两个正文之间过程不共享段状态；
- `[t1, b1, t2]` 且 `TurnLocation.start === undefined`：`t1` 前缘不折叠，`t2` 属于 `bnd:b1`；
- 加载更早后 `u1` 出现：`TurnLocation.start` 从未定义变为有值，`t1` 从 `before:b1` 迁移到 `bnd:u1`，且未展开状态不迁移、不串段；
- `[u1, t1, b1, t2]` 且 `TurnLocation.start !== undefined`：`t1` 属于 `bnd:u1`，`t2` 属于 `bnd:b1`；
- 流式场景：同一节点从纯 `reasoning` 变为混合 `[reasoning + 正文]` 时，`hasBody`、`processSegmentOf`、`boundarySegmentOf` 的最终状态正确；
- durability `user` 出现但 `TurnLocation.start` 仍为 undefined：`u1` 后立即 `bnd:u1`；
- 前缘区首个混合 `[reasoning + 正文]` body（含 `reasoning + image`）：`shouldHideReasoning` 返回 false；
- 无正文段 collapsed 的最后预览纯过程节点：必须完整渲染 blocks（含 reasoning），不得因 `shouldHideReasoning`/`shouldHideProcessContent` 隐藏自身；
- **纯 reasoning-only 节点**：不是 body 边界，不产生 `hasBody` / 不切段；
- 空 `""` text 块不计入 `hasVisibleBody`；
- 混合 `reasoning + 正文` 节点（含 `reasoning + image`）：`processSegmentOf` 指向上一段、`boundarySegmentOf` 指向下一段，且可作为首过程渲染折叠栏；
- `segmentOfNode`：context/skill 等非过程、非边界节点返回位置归属段；对 process、`user` / `steering`、纯正文/混合正文等过程/边界节点返回 `undefined`；与 `processSegmentOf`/`boundarySegmentOf` 不冲突；
- `user` / `steering` / `body` 边界归属与独立折叠；
- `shouldHideProcessContent` 各分支；
- `shouldRenderFoldBar`：只在前缘之外的段首 process 返回 true；
- `shouldHideReasoning` 仅作用于混合 `[reasoning + 正文]` 正文节点；
- `shouldHideAux`：前缘段、expanded、`includesAux` 各分支。

### 9.2 生成一致性测试

- 运行 `node scripts/sync-segments.mjs`；
- 读取 `lib/client.js` 生成块，去掉两行标记；
- 与 `lib/segments.js` 去掉 `export {...}` 尾行后的内容精确比较；
- 不做模糊正则。

### 9.3 现有测试更新

- 将“仅最终正文”断言改为“所有有可见正文的 assistant-step 都渲染”；
- 将 `closingOfTurn` / `isClosingAssistantNode` 断言改为 `useTurnData("turn-tail")` 路径；
- 增加断言 owner 使用 `node.location.turn`（TurnLocation 对象）而非 `turnOf(node)` 数字 turn；
- 增加 host 默认 `auxVisible` 返回 `["context","skill"]` 的测试。

### 9.4 静态 / 回归验证

```
node --check lib/segments.js
node --check lib/client.js
node --check lib/index.js
node scripts/sync-segments.mjs
node --test
```

- 静态断言：所有隐藏分支必须返回非空占位（`HiddenProcessNode` / `HiddenAuxNode`），且包含针对 `[data-chat-flow-kind=...]` 外层的 `:has` 隐藏规则，不出现“非空占位但未隐藏外层”的 gap 回归。
- 交互回归：点击折叠栏后 `ToolCallGroup` 的过程隐藏状态与 `ContextNodeView` 的 aux 可见性必须同步变化，证明这些组件已订阅 `segmentVersion`。
- 流式/锚点回归至少做轻量模拟：确认 `turnKeys` / `nodeValues` 变化会使 `buildSegmentIndex` 重算；若无法自动化，则列入强制手工回归清单。
- 手工回归必须覆盖：刷新、加载更早、流式过程中正文从无到有（折叠栏/最后预览不消失）、展开→收起→展开后折叠栏不消失、上一轮展开不影响下一轮、`pendingSteering` 不被插件隐藏/遮挡。

---

## 十、实施顺序

1. 新建 `lib/segments.js` + `scripts/sync-segments.mjs`，接入 `package.json` scripts。
2. 改造 `lib/client.js`：接入段状态 store、`ProcessFold`、`AssistantNodeView`、`ToolCallGroup`、`ContextNodeView`；删除 `turnExpanded` / `turnListeners` / `closingOfTurn` / `isClosingAssistantNode` / 旧的 `hasReasoning` / `isSkillToolCall` / `isProcessNode` / `visibleBlocksOf`，统一使用 `lib/segments.js` 生成块。
3. 修改 `lib/index.js` 默认 `auxVisible`。
4. 同批更新测试。
5. 静态验证 + `node --test`。
6. 用户 `dsh web` 实测：加载、刷新、加载更早、独立折叠、展开不消失、steering 边界、步骤数、pending 气泡不被隐藏。

---

## 十一、范围边界

- `useTurnData("turn-tail")` 已确认注入 shadow entry，设计按该 prop 实现；不支持“如果不可用再回退”。
- 前端 `fetch("/api/conversation-folding/config")` 的鉴权/路径与现有 host 一致，不改。
- 不实现 `pendingSteering` 的 DOM 重排；若用户实测确认 pending 气泡仍造成视觉问题，另行立项。
