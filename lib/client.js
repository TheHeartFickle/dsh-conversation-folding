window.__ModuleLoader__.load({
	id: "@the-heart-fickle/dsh-conversation-folding",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");
		var primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		var MarkdownText = primitives.MarkdownText;
		var JsonBlock = primitives.JsonBlock;
		var DisclosureRow = primitives.DisclosureRow;
		var IconThinkOutline14 = primitives.IconThinkOutline14;
		var IconChevronDownOutline14 = primitives.IconChevronDownOutline14;
		var Menu = primitives.Menu;

		// =====================================================================
		// §0 架构范式：对话视口 = 轨迹的可视化 + 信息过滤（SPEC.md §0）
		//
		//   轨迹    chat.order 自上而下即时间顺序，是唯一事实；模型绝不重排节点、
		//           绝不把信息移过边界（user / steering / 正文）。因此 Ctrl+Enter
		//           插入（steering 边界，逻辑上开启新一轮对话）必然开启新折叠栏：
		//           若把其后步骤合入之前的栏，视口顺序就会与轨迹顺序错位。
		//   可视化  正文节点永远在轨迹原位完整可见。
		//   过滤    折叠 = 把「段」的过程信息从视口滤除，并在轨迹原位保留折叠栏入口。
		//
		// 分层（本文件自上而下）：
		//   §4 轨迹模型  纯函数 order+nodes → 轮/段结构；一切边界条件（中止轮、
		//               steering、流式尾段）都是模型里的分类规则，不是视图补丁。
		//   §5 视图投影  纯函数 模型+UI状态 → 每个节点键的唯一可见状态 + 折叠栏
		//               列表 + 动态样式文本；同输入必同输出。
		//   §6-§10 生效层 React 薄壳：所有座位共享同一份缓存的投影（单一事实），
		//               单一样式写入器；杜绝「栏与内容各自判定」。
		// =====================================================================

		// ---------- §1 折叠模式配置 ----------
		// 默认全部折叠；通过 profile 的 cordis.patch.yml 传入 host（官方通道）或
		// @dsh-std/adapter-dsh 命令通道，再由 config 命令暴露给浏览器端。
		//   all      —— 折叠过程（reasoning / 非 skill tool-call），正文永不折叠，默认
		//   toolcall —— 官方渲染 tool call，插件只保留 thinking 增强样式
		//   none     —— 关闭折叠，保留 thinking 增强样式
		var configState = { foldMode: "all", auxVisible: [] };
		var configVersion = 0;
		var configListeners = new Set();

		function getFoldMode() {
			return configState.foldMode || "all";
		}

		function getAuxVisible() {
			var list = configState.auxVisible;
			return Array.isArray(list) ? list : [];
		}

		function includesAux(key) {
			var list = getAuxVisible();
			for (var i = 0; i < list.length; i++) {
				if (list[i] === key) return true;
			}
			return false;
		}

		function getConfigVersion() {
			return configVersion;
		}

		function subscribeConfig(listener) {
			configListeners.add(listener);
			return function () { configListeners.delete(listener); };
		}

		function syncFoldModeAttr(mode) {
			if (typeof document !== "undefined") document.documentElement.dataset.dshFoldMode = mode;
		}

		function setFoldMode(mode) {
			if (mode === "all" || mode === "toolcall" || mode === "none") {
				if (mode !== getFoldMode()) {
					configState = { foldMode: mode, auxVisible: getAuxVisible() };
					configVersion += 1;
					syncFoldModeAttr(isFoldActive() ? mode : "none");
					configListeners.forEach(function (fn) { fn(); });
				}
			}
		}

		function setAuxVisible(list) {
			var next = Array.isArray(list) ? list.filter(function (x) { return typeof x === "string"; }) : [];
			var prev = getAuxVisible();
			if (prev.length !== next.length || prev.some(function (v, i) { return v !== next[i]; })) {
				configState = { foldMode: getFoldMode(), auxVisible: next };
				configVersion += 1;
				configListeners.forEach(function (fn) { fn(); });
			}
		}

		function loadConfig() {
			fetch("/api/conversation-folding/config")
				.then(function (res) { return res.json(); })
				.then(function (data) {
					if (data && data.ok) {
						if (data.foldMode) setFoldMode(data.foldMode);
						if (data.auxVisible !== undefined) setAuxVisible(data.auxVisible);
					}
				})
				.catch(function () { });
		}

		// ---------- §2 对话显示模式（新增 fold 模式） ----------
		// DSH 官方只有 normal / compact；本插件新增下拉项 fold（名称“折叠”），
		// 只有选中 fold 时插件才接管过程折叠，官方两种模式完全不受影响。
		// fold 只写 localStorage，不写入 ui-chat.transcriptView（官方 schema 不含 fold）。
		var transcriptMode = "compact";
		var transcriptVersion = 0;
		var transcriptListeners = new Set();
		if (typeof localStorage !== "undefined") {
			var savedTranscriptMode = localStorage.getItem("dsh-conversation-folding.displayMode");
			if (savedTranscriptMode === "normal" || savedTranscriptMode === "compact" || savedTranscriptMode === "fold") {
				transcriptMode = savedTranscriptMode;
			}
		}

		function getTranscriptVersion() {
			return transcriptVersion;
		}

		function subscribeTranscript(listener) {
			transcriptListeners.add(listener);
			return function () { transcriptListeners.delete(listener); };
		}

		function getTranscriptMode() {
			return transcriptMode;
		}

		function setTranscriptMode(mode) {
			if (mode !== "normal" && mode !== "compact" && mode !== "fold") return;
			if (mode !== transcriptMode) {
				transcriptMode = mode;
				transcriptVersion += 1;
				syncFoldModeAttr(isFoldActive() ? getFoldMode() : "none");
				transcriptListeners.forEach(function (fn) { fn(); });
			}
		}

		function isFoldActive() {
			return getTranscriptMode() === "fold";
		}

		// ---------- §3 段展开状态 ----------
		// 折叠单位是「段」（见 §4）；展开状态按段 segKey 共享。
		var segExpanded = new Map();
		var segVersion = 0;
		var segListeners = new Set();

		function getSegVersion() {
			return segVersion;
		}

		function subscribeSeg(listener) {
			segListeners.add(listener);
			return function () { segListeners.delete(listener); };
		}

		function isSegExpanded(key) {
			return key !== undefined && segExpanded.get(key) === true;
		}

		function setSegExpanded(key, expanded) {
			if (key === undefined) return;
			segExpanded.set(key, expanded);
			segVersion += 1;
			segListeners.forEach(function (fn) { fn(); });
		}

		// ---------- §4 轨迹模型（纯函数，无 DOM / 无 React，可单测） ----------
		//
		// 节点分类表 —— 全插件唯一检查节点 kind 的地方；宿主新增节点类型只需在
		// 此登记一个角色，视图与样式零改动（泛化边界条件的扩展点）：
		//   user / steering        人机边界：封口当前段、开启新段。steering 是
		//                          Ctrl+Enter 插入，逻辑上开启新一轮对话（范式 I1）。
		//   assistant-step         有可见 block → 正文（封口当前段，永不折叠）；
		//                          仅推理 → 过程；两者皆无 → 空载步（恒隐藏）。
		//   tool-call 非 skill     过程
		//   tool-call = skill      辅助项（auxVisible 豁免）
		//   context                辅助项（auxVisible 豁免）
		//   其余（turn-tail / turn-process / command / compaction / retry ...）
		//                          结构节点：turn-tail 兼作「轮已闭合」信号，不参与折叠。
		function visibleBlocksOf(blocks) {
			if (!Array.isArray(blocks)) return [];
			return blocks.filter(function (block) {
				return block && block.kind !== "reasoning" && block.kind !== "tool-call";
			});
		}

		function hasReasoning(node) {
			var blocks = node && node.data && node.data.blocks;
			if (!Array.isArray(blocks)) return false;
			for (var i = 0; i < blocks.length; i++) {
				if (blocks[i] && blocks[i].kind === "reasoning") return true;
			}
			return false;
		}

		function toolCallName(node) {
			var root = node && node.data && node.data.root;
			if (!root) return undefined;
			if (root.name) return root.name;
			if (root.call && root.call.name) return root.call.name;
			return undefined;
		}

		function isSkillToolCall(node) {
			return node && node.kind === "tool-call" && toolCallName(node) === "skill";
		}

		function classifyNode(node) {
			if (!node) return "skip";
			if (node.kind === "user") return "boundary";
			if (node.kind === "steering") return "boundary";
			if (node.kind === "assistant-step") {
				if (visibleBlocksOf(node.data && node.data.blocks).length > 0) return "body";
				return hasReasoning(node) ? "process" : "empty-step";
			}
			if (node.kind === "tool-call") return isSkillToolCall(node) ? "aux" : "process";
			if (node.kind === "context") return "aux";
			return "skip";
		}

		function turnOf(node) {
			var loc = node && node.location;
			if (!loc) return undefined;
			if (loc.kind === "turn" || loc.kind === "step") {
				return loc.turn && loc.turn.turn;
			}
			return undefined;
		}

		// buildTimeline(order, nodes) → Timeline
		//   turns       按轨迹首现顺序的 TurnModel：{ turn, closed, segments, nodes }
		//   segment     { segKey, keys, steps, toolCalls, hasReasoning, latestKey,
		//                 endType: "body"|"boundary"|"open", boundaryKey, messages }
		//   segKey 稳定格式：闭合段 = 段后边界节点的 key（正文或 steering 节点 key，
		//                   全局唯一，跨「加载更早」/重渲染稳定）；开放段（流式尾段）
		//                   = "t<turn>:open"，出现边界后自然换键为边界 key。
		//   owner       Map 过程/辅助/空载节点 key → segKey
		//   bodySeg     Map 正文节点 key → 其前一段 segKey（正文内思维链联动展开）
		//   segByKey    Map segKey → segment
		// 规则（R，边界条件的全部清单）：
		//   R1 轨迹顺序：严格按 order 迭代，不重排。
		//   R2 边界封口：user/steering/正文 封口当前段并开启新段。
		//   R3 轮闭合：turn 内出现 turn-tail 即闭合（不要求带最终正文 closing）——
		//      中止/中断轮同样闭合，否则尾段被误判为“流式中”（B10 根因之一）。
		//   R4 空段不落账：封口时 keys 为空的段不生成（正文有思维链时例外，
		//      仍落账以便给出「1 条消息」栏联动正文内思维链）。
		//   R5 尾段开放：轮末未封口的段 endType=open（流式尾段；轮闭合时它就是
		//      中止轮尾段，见投影 F3）。
		//   R6 栏锚定信息：记录每轮首个 turn-process 节点键（processKey，官方保证
		//      有过程证据的轮必有此节点）、每段封口前同轮最后一个正文键（prevBody）
		//      与段首前边界类型（startCtx：user=轮首段 / body / steering），供投影
		//      把折叠栏落位到段首上方（B2）——栏不集中堆在轮顶，展开步骤在栏下方。
		function buildTimeline(order, nodes) {
			var turns = [];
			var turnByKey = {};
			var owner = {};
			var bodySeg = {};
			var segByKey = {};
			var model = null;
			var cur = null;
			var lastBody = null;
			var pendingCtx = "user";
			function openSeg() {
				cur = { keys: [], steps: 0, toolCalls: 0, hasReasoning: false, latestKey: null, startCtx: pendingCtx };
			}
			function closeSeg(endType, boundaryKey, bodyHasReasoning) {
				var seg = cur;
				var keep = (seg !== null && seg.keys.length > 0) || (endType === "body" && bodyHasReasoning === true);
				if (keep) {
					if (seg === null) {
						seg = { keys: [], steps: 0, toolCalls: 0, hasReasoning: false, latestKey: null, startCtx: pendingCtx };
					}
					seg.endType = endType;
					seg.boundaryKey = boundaryKey === undefined ? null : boundaryKey;
					seg.prevBody = lastBody;
					seg.messages = endType === "body" ? 1 : 0;
					seg.segKey = endType === "open" ? "t" + model.turn + ":open" : String(boundaryKey);
					for (var i = 0; i < seg.keys.length; i++) owner[seg.keys[i]] = seg.segKey;
					segByKey[seg.segKey] = seg;
					model.segments.push(seg);
				}
				cur = null;
				if (endType === "body") {
					// 正文的前段 = 封住它的段（其 segKey 即该正文键）；段未落账
					// （纯问答、无过程且正文无思维链）时为 null，正文内思维链
					// 不受任何栏联动。
					bodySeg[boundaryKey] = keep ? String(boundaryKey) : null;
				}
			}
			for (var i = 0; i < order.length; i++) {
				var key = order[i];
				var node = nodes.get(key);
				if (!node) continue;
				var turn = turnOf(node);
				if (turn === undefined) continue;
				if (model === null || model.turn !== turn) {
					// 换轮前先封上一轮的尾段（正常轨迹由 user 边界封口，此处兜底）。
					if (cur !== null) closeSeg("open", undefined, false);
					model = turnByKey[turn];
					if (model === undefined) {
						model = turnByKey[turn] = { turn: turn, closed: false, segments: [], bodies: [], processKey: undefined };
						turns.push(model);
					}
					lastBody = null;
					pendingCtx = "user";
				}
				if (node.kind === "turn-tail") model.closed = true;
				if (node.kind === "turn-process" && model.processKey === undefined) model.processKey = key;
				var role = classifyNode(node);
				if (role === "body") {
					model.bodies.push(key);
					closeSeg("body", key, hasReasoning(node));
					lastBody = key;
					pendingCtx = "body";
					continue;
				}
				if (role === "boundary") {
					closeSeg("boundary", key, false);
					pendingCtx = node.kind === "steering" ? "steering" : "user";
					continue;
				}
				if (role === "boundary") {
					closeSeg("boundary", key, false);
					continue;
				}
				if (role === "skip") continue;
				if (cur === null) openSeg();
				cur.keys.push(key);
				if (role === "process") {
					cur.steps += 1;
					if (node.kind === "tool-call") cur.toolCalls += 1;
					else cur.hasReasoning = true;
					cur.latestKey = key;
				}
			}
			if (model !== null) closeSeg("open", undefined, false);
			return { turns: turns, turnByKey: turnByKey, owner: owner, bodySeg: bodySeg, segByKey: segByKey, nodes: nodes };
		}

		// ---------- §5 视图投影（纯函数，可单测） ----------
		//
		// projectView(timeline, ui) → Projection
		//   ui = { active, auxVisible(key)=>bool, isExpanded(segKey)=>bool }
		// 输出：
		//   views      Map 节点key → { role, segKey, state }
		//              state ∈ "visible" | "preview" | "hidden"
		//   barsByAnchor Map 锚点节点key → [{ segKey, toolCalls, messages, pos }]
		//              pos="before" 栏在锚点内容上方；pos="after" 在下方。
		//   styleText  动态隐藏 CSS（tool-call / context 由官方渲染，只能用 CSS 过滤；
		//              assistant-step 座位由本插件渲染，走 React 分支）
		// 过滤规则（F，全部显式列出）：
		//   F1 正文永不隐藏（正文键不进入 views 的 hidden 态）。
		//   F2 收起的闭合段：段内过程/辅助节点全部隐藏，辅助项受 auxVisible 豁免。
		//   F3 收起的开放段且轮已闭合（中止/中断轮）：全部隐藏、无预览 —— 失败
		//      tool-call 不得漏出（B10 收起方向）。
		//   F4 收起的开放段且轮未闭合（流式中）：仅最近一条过程保留为预览。
		//   F5 展开的段：段内全部可见（B10 展开方向：中止轮展开必须见全部步骤）。
		//   F6 每个键只属于一个段（模型 R1/R2 保证），过滤决策不跨段、不重排。
		// 栏落账规则（B）：
		//   B1 有工具调用或过程推理的段必有栏；正文段且正文带思维链也必有栏
		//      （展开可看正文内思维链）；纯问答段无栏。
		//   B2 栏锚定（官方 turn-process 语义：控件在上、内容在下。不集中堆在
		//      轮顶——B15；展开方向修正——B16）：栏渲染在其所折叠段的段首上方。
		//      收起时段内步骤隐藏，栏视觉上紧贴其后边界内容（每轮正文上方各自
		//      一栏）；展开 = [栏][步骤][正文]。落座规则见 barAnchorOf。
		function barAnchorOf(seg, model, nodes) {
			// ① 无步骤的思考正文段：锚点=该正文、正文上方（联动正文内思维链）。
			if (seg.keys.length === 0) {
				return seg.endType === "body" && seg.boundaryKey
					? { key: String(seg.boundaryKey), pos: "before" }
					: null;
			}
			// ② 段直接跟在正文后：锚点=该正文、正文下方（= 段首上方）。
			if (seg.startCtx === "body" && seg.prevBody) {
				return { key: seg.prevBody, pos: "after" };
			}
			// ③ 轮首段（段前是 user 边界）：锚点=轮 turn-process（缺节点按回退链）。
			if (seg.startCtx !== "steering") {
				if (model.processKey !== undefined) return { key: model.processKey, pos: "before" };
				if (seg.prevBody) return { key: seg.prevBody, pos: "after" };
				return seg.endType === "body" && seg.boundaryKey
					? { key: String(seg.boundaryKey), pos: "before" }
					: null;
			}
			// ④ 段跟在 steering 后（已知妥协：官方 steering 座位不可注入）：
			//    段首步是插件渲染的过程步 → 落座该步内、其内容上方；
			//    段首步是官方渲染（tool-call/context）→ 闭合段落座封口正文上方
			//    （收起仍紧贴其后正文），开放段落座 prevBody 下方。
			var first = nodes ? nodes.get(seg.keys[0]) : undefined;
			if (first && first.kind === "assistant-step") {
				return { key: seg.keys[0], pos: "before" };
			}
			if (seg.endType === "body" && seg.boundaryKey) {
				return { key: String(seg.boundaryKey), pos: "before" };
			}
			if (seg.prevBody) return { key: seg.prevBody, pos: "after" };
			if (model.processKey !== undefined) return { key: model.processKey, pos: "before" };
			return null;
		}
		function projectView(timeline, ui) {
			var views = new Map();
			var barsByAnchor = new Map();
			var rules = [];
			if (ui.active) {
				for (var t = 0; t < timeline.turns.length; t++) {
					var model = timeline.turns[t];
					for (var s = 0; s < model.segments.length; s++) {
						var seg = model.segments[s];
						var expanded = ui.isExpanded(seg.segKey) === true;
						var state;
						if (expanded) state = "visible";
						else if (seg.endType === "open") state = model.closed ? "hidden" : "preview";
						else state = "hidden";
						var bodyReasoning = false;
						if (seg.endType === "body") {
							var bodyNode = timeline.nodes
								? timeline.nodes.get(seg.boundaryKey)
								: undefined;
							bodyReasoning = hasReasoning(bodyNode);
						}
						if (seg.toolCalls > 0 || seg.hasReasoning || bodyReasoning) {
							// B2 栏锚定：落座段首上方（见上方规则说明与 barAnchorOf）。
							var anchor = barAnchorOf(seg, model, timeline.nodes);
							if (anchor !== null) {
								var anchorBars = barsByAnchor.get(anchor.key);
								if (anchorBars === undefined) {
									anchorBars = [];
									barsByAnchor.set(anchor.key, anchorBars);
								}
								anchorBars.push({ segKey: seg.segKey, toolCalls: seg.toolCalls, messages: seg.messages, pos: anchor.pos });
							}
						}
						for (var k = 0; k < seg.keys.length; k++) {
							var key = seg.keys[k];
							var keyState = state;
							if (keyState === "preview" && key !== seg.latestKey) keyState = "hidden";
							var node = timeline.nodes ? timeline.nodes.get(key) : undefined;
							if (node && classifyNode(node) === "empty-step") {
								// 空载步（无可见内容也无思维链）恒隐藏。
								views.set(key, { role: "empty-step", segKey: seg.segKey, state: "hidden" });
								continue;
							}
							views.set(key, { role: "process", segKey: seg.segKey, state: keyState });
							if (keyState === "hidden" && node && (node.kind === "tool-call" || node.kind === "context")) {
								// assistant-step 座位由插件渲染，走 React 隐藏；CSS 只管官方渲染的 kind。
								if (node.kind === "tool-call" && isSkillToolCall(node) && ui.auxVisible("skill")) continue;
								if (node.kind === "context" && ui.auxVisible("context")) continue;
								// 选择器优先级必须不低于静态 unhide 规则，靠动态样式后插入取胜。
								rules.push(':root[data-dsh-fold-mode=all] [data-chat-flow-key][data-chat-anchor-key="' + key + '"][data-chat-flow-kind]{display:none!important}');
							}
						}
					}
				}
			}
			// 正文视图：正文键恒可见（F1），带上其前一段 segKey 供正文内思维链联动
			//（前段不存在时为 null，思维链不受任何栏联动）。
			for (var turnKey in timeline.turnByKey) {
				var turnBodies = timeline.turnByKey[turnKey].bodies;
				for (var b = 0; b < turnBodies.length; b++) {
					var bodyKey = turnBodies[b];
					views.set(bodyKey, {
						role: "body",
						segKey: timeline.bodySeg[bodyKey] !== undefined ? timeline.bodySeg[bodyKey] : null,
						state: "visible"
					});
				}
			}
			return {
				active: ui.active === true,
				timeline: timeline,
				views: views,
				barsByAnchor: barsByAnchor,
				styleText: rules.join("")
			};
		}

		// ---------- §6 缓存与订阅（单一事实） ----------
		// Timeline 按 chat 快照对象身份缓存：同一次发布的快照只推导一次，所有座位
		// 在同一次 commit 中读到同一个 Timeline / Projection（I2）。
		var timelineCache = new WeakMap();

		function getTimeline(chat) {
			if (!chat || !chat.order || !chat.nodes) return undefined;
			var cached = timelineCache.get(chat);
			if (cached === undefined) {
				cached = buildTimeline(chat.order, chat.nodes);
				timelineCache.set(chat, cached);
			}
			return cached;
		}

		var projectionCache = new WeakMap();

		function getProjection(chat) {
			var timeline = getTimeline(chat);
			if (timeline === undefined) return null;
			var active = isFoldActive() && getFoldMode() === "all";
			var cached = projectionCache.get(chat);
			if (cached !== undefined && cached.segVersion === segVersion &&
				cached.configVersion === configVersion && cached.transcript === transcriptMode &&
				cached.active === active) {
				return cached.projection;
			}
			var projection = projectView(timeline, {
				active: active,
				auxVisible: includesAux,
				isExpanded: isSegExpanded
			});
			projectionCache.set(chat, {
				segVersion: segVersion,
				configVersion: configVersion,
				transcript: transcriptMode,
				active: active,
				projection: projection
			});
			// 补点行为在 React 之外读取模型（S2 停止条件），这里保持最新引用。
			latestProjection = projection;
			return projection;
		}

		// DSH 0.1.2 起 SessionSnapshot 不再携带 chat：对话数据在 useChat 的
		// ChatSnapshot 里（order + nodes store，nodes.get(key) 兼容旧 Map 读法）。
		function chatOf(props) {
			var useChat = props.useChat;
			if (typeof useChat !== "function") return undefined;
			return useChat(function (s) { return s; });
		}

		function useProjection(props) {
			React.useSyncExternalStore(subscribeConfig, getConfigVersion);
			React.useSyncExternalStore(subscribeSeg, getSegVersion);
			React.useSyncExternalStore(subscribeTranscript, getTranscriptVersion);
			return getProjection(chatOf(props));
		}

		// ---------- §7 样式写入器（单写者，幂等） ----------
		// 规则文本是投影的纯函数；任何座位挂载 FoldStyleMount 都写同一文本，
		// 重复写无副作用。保持动态样式位于静态样式之后，同优先级时后者胜出。
		var dynamicStyle = null;

		function applyFoldStyle(text) {
			if (typeof document === "undefined") return;
			if (dynamicStyle === null || !dynamicStyle.isConnected) {
				dynamicStyle = document.createElement("style");
				dynamicStyle.dataset.plugin = "dsh-conversation-folding";
				dynamicStyle.dataset.pluginCss = "dsh-conversation-folding/dynamic";
				dynamicStyle.id = "dsh-conversation-folding-dynamic";
			}
			if (dynamicStyle.textContent !== text) dynamicStyle.textContent = text;
			document.head.appendChild(dynamicStyle);
		}

		function FoldStyleMount(props) {
			var proj = props.proj;
			React.useEffect(function () {
				applyFoldStyle(proj && proj.active ? proj.styleText : "");
			});
			return null;
		}

		// ---------- §8 视图 ----------
		// 隐藏占位：非空标记元素。影子座位的 slot 容器永远存在，官方
		// .flowItem:empty 对影子座位永不生效（B17 根因）；座位内出现本标记时，
		// 由静态 CSS :has 规则 display:none 收掉整个座位盒子——连盒子带的
		// 官方 ~ 间距 margin 一起消失（flex 列布局 margin 不塌缩，空盒子会
		// 在可见条目间留下随折叠步数累积的幻影间隔）。
		function HiddenTurnNode() {
			return React.createElement("div", { "data-dsh-hidden-turn": true });
		}

		// 折叠栏（一段一栏）。文案为官方 turn-process 格式。pos 标记落位
		// （before=锚点内容上方 / after=下方），供座位内间距样式使用。
		function ProcessFold(props) {
			React.useSyncExternalStore(subscribeSeg, getSegVersion);
			var segKey = props.segKey;
			var expanded = isSegExpanded(segKey);
			var toolCalls = props.toolCalls || 0;
			var messages = props.messages || 0;
			var labels = [];
			if (toolCalls > 0) labels.push(toolCalls + " 个工具调用");
			if (messages > 0) labels.push(messages + " 条消息");
			var label = labels.length > 0 ? labels.join(" · ") : "思考了一会儿";
			return React.createElement("button", {
				type: "button",
				className: "dsh-turnfold dsh-turnfold-process",
				"data-open": expanded || undefined,
				"data-seg-key": segKey,
				"data-bar-pos": props.pos === "after" ? "after" : "before",
				"aria-expanded": expanded,
				onClick: function () { setSegExpanded(segKey, !expanded); }
			}, React.createElement("span", { className: "dsh-turnfold-label" }, label),
				React.createElement(IconChevronDownOutline14, { className: "dsh-turnfold-chevron" })
			);
		}

		// 官方 turn-process 控件的复刻（非 fold 显示模式下原样呈现）。
		function OfficialTurnProcessView(props) {
			var node = props.node;
			var turnProcess = props.turnProcess;
			var t = props.t;
			if (!turnProcess || !turnProcess.foldable) return null;
			var open = turnProcess.open;
			var labels = [];
			if (node.data.toolCallCount > 0) labels.push(t(node.data.toolCallCount === 1 ? "message.turnProcess.toolCalls.one" : "message.turnProcess.toolCalls.other", { count: node.data.toolCallCount }));
			if (node.data.messageCount > 0) labels.push(t(node.data.messageCount === 1 ? "message.turnProcess.messages.one" : "message.turnProcess.messages.other", { count: node.data.messageCount }));
			if (node.data.subagentCount > 0) labels.push(t(node.data.subagentCount === 1 ? "message.turnProcess.subagents.one" : "message.turnProcess.subagents.other", { count: node.data.subagentCount }));
			var label = labels.length === 0 ? t("message.turnProcess.thoughtForAWhile") : labels.join(t("message.turnProcess.separator"));
			return React.createElement("button", {
				type: "button",
				className: "dsh-turnfold dsh-turnfold-official",
				"data-open": open || undefined,
				"aria-expanded": open,
				onClick: function (event) {
					event.currentTarget.focus();
					turnProcess.setOpen(!open);
				}
			}, React.createElement("span", { className: "dsh-turnfold-label" }, label),
				React.createElement(IconChevronDownOutline14, { className: "dsh-turnfold-chevron" }));
		}

		// turn-process 座位：只承载兜底栏（B2 ③：轮首段，锚点=本节点）。其余栏
		// 都落座在段首附近的插件座位（正文或过程步的 assistant-step 座位，B15：
		// 不得把一轮的栏集中堆在轮顶）。样式写入器仍在此挂载，保证纯过程轮
		// （无 assistant-step 座位）也写入动态样式。
		function TurnProcessFoldView(props) {
			var proj = useProjection(props);
			if (proj === null) return HiddenTurnNode();
			if (!proj.active) return OfficialTurnProcessView(props);
			var node = props.node;
			var bars = node && node.key !== undefined ? proj.barsByAnchor.get(node.key) : undefined;
			if (!bars || bars.length === 0) return HiddenTurnNode();
			var parts = [];
			for (var i = 0; i < bars.length; i++) {
				parts.push(React.createElement(ProcessFold, {
					key: bars[i].segKey,
					segKey: bars[i].segKey,
					toolCalls: bars[i].toolCalls,
					messages: bars[i].messages,
					pos: bars[i].pos
				}));
			}
			parts.push(React.createElement(FoldStyleMount, { proj: proj, key: "style" }));
			return React.createElement(React.Fragment, null, parts);
		}

		// ---------- 思维链文本辅助 ----------
		function firstLine(text) {
			var newline = text.indexOf("\n");
			return newline === -1 ? text : text.slice(0, newline);
		}
		function latestLine(text) {
			var visible = text.trimEnd();
			var newline = visible.lastIndexOf("\n");
			return newline === -1 ? visible : visible.slice(newline + 1);
		}

		// 会话滚动容器：优先用稳定的 [data-chat-flow] 锚点向上找可滚动祖先，
		// 兜底旧的散列类名（官方重排后散列会变）。
		function findChatScroller() {
			if (typeof document === "undefined") return null;
			var el = document.querySelector("[data-chat-flow]");
			while (el && el !== document.body) {
				var overflow = typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(el).overflowY : "";
				if (overflow === "auto" || overflow === "scroll") return el;
				el = el.parentElement;
			}
			return document.querySelector(".wSkVaW_scrollBody");
		}

		// ---------- 思维链：默认展开 + 可滚动子框 ----------
		// 联动：新的 running 思维链出现时，只折叠紧邻的前一个（更早的手动展开状态不动）。
		var thinkSeq = 0;
		var runningThink = null;

		function ThinkBox(props) {
			var text = props.text;
			var running = props.running;
			var t = props.t;
			var openState = React.useState(props.running || props.open);
			var open = openState[0];
			var setOpen = openState[1];
			var idRef = React.useRef(null);
			if (idRef.current === null) {
				thinkSeq += 1;
				idRef.current = thinkSeq;
			}
			var myId = idRef.current;
			var collapseRef = React.useRef(null);
			collapseRef.current = function () { setOpen(false); };
			React.useEffect(function () {
				if (running) {
					setOpen(true);
					if (runningThink !== null && runningThink.id !== myId) {
						runningThink.collapse();
					}
					runningThink = { id: myId, collapse: collapseRef.current };
				}
			}, [running, myId]);
			React.useEffect(function () {
				return function () {
					if (runningThink !== null && runningThink.id === myId) {
						runningThink = null;
					}
				};
			}, [myId]);
			var bodyRef = React.useRef(null);
			var atBottomRef = React.useRef(true);
			var scrollRafRef = React.useRef(null);
			// 展开时重置"在底部"标记（React 默认 scrollTop=0 不是用户主动滚上去）
			React.useLayoutEffect(function () {
				if (open) atBottomRef.current = true;
			}, [open]);
			// 生成中自动跟随底部：只有用户仍在底部附近才往下滚。
			// 用 requestAnimationFrame 合并同一帧内的多次滚动，降低高频 token 更新时的卡顿。
			React.useLayoutEffect(function () {
				if (!(running && open && bodyRef.current !== null && atBottomRef.current)) return;
				var el = bodyRef.current;
				if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
				scrollRafRef.current = requestAnimationFrame(function () {
					scrollRafRef.current = null;
					el.scrollTop = el.scrollHeight;
				});
				return function () {
					if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
				};
			}, [text, running, open]);
			// 首次出现思维链时，若会话视口原本就在底部，保持贴底；否则会停在旧位置，
			// 需要手动滚动一次才能恢复自动跟随。
			React.useLayoutEffect(function () {
				if (!(running && open)) return;
				var scroller = findChatScroller();
				if (scroller === null) return;
				var nearBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 80;
				if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
			}, [running, open, text]);
			// 监听用户滚动，维护"是否在底部附近"
			// 阈值（64px）比内容高度跳变略大，避免 token 生成过快时一帧内底部被
			// 甩开，导致自动跟随失效。
			React.useEffect(function () {
				if (!open) return;
				var el = bodyRef.current;
				if (el === null) return;
				var onScroll = function () {
					atBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 64;
				};
				el.addEventListener("scroll", onScroll, { passive: true });
				return function () { el.removeEventListener("scroll", onScroll); };
			}, [open]);
			var summary = running ? latestLine(text) : firstLine(text);
			return React.createElement("div", {
				className: "dsh-think",
				"data-variant": "think",
				"data-state": running ? "running" : "ok"
			}, React.createElement(DisclosureRow, {
				rowClassName: "dsh-think-row",
				leadingClassName: "dsh-think-leading",
				titleClassName: "dsh-think-title",
				chevronClassName: "dsh-think-chevron",
				icon: React.createElement(IconThinkOutline14, { size: 14 }),
				title: "Think",
				open: open,
				expandable: true,
				expandOnRowClick: true,
				onToggle: function () { setOpen(function (v) { return !v; }); },
				collapsedContent: React.createElement(React.Fragment, null,
					React.createElement("span", { className: "dsh-think-separator", "aria-hidden": true }),
					React.createElement("span", { className: "dsh-think-summary" }, summary)
				),
				children: React.createElement("div", { className: "dsh-think-body", ref: bodyRef }, text)
			}));
		}

		// ---------- 助手消息渲染（reasoning 分支走 ThinkBox） ----------
		function AssistantMarkdown(props) {
			var blocks = props.blocks;
			var streaming = props.streaming;
			var interrupted = props.interrupted;
			var renderMessageImages = props.renderMessageImages;
			var hideReasoning = props.hideReasoning;
			var t = props.t;
			var codeLabels = React.useMemo(function () {
				return {
					code: { copyLabel: t("copy"), copiedLabel: t("copied") },
					footnotes: t("markdown.footnotes")
				};
			}, [t]);
			var last = blocks.length - 1;
			if (!(streaming || interrupted === true || blocks.some(function (b) { return b.kind !== "tool-call"; }))) return null;
			var rendered = [];
			for (var i = 0; i < blocks.length; i++) {
				var block = blocks[i];
				if (block === undefined) continue;
				if (block.kind === "text") {
					rendered.push(React.createElement(MarkdownText, {
						key: i,
						text: block.text,
						streaming: streaming,
						labels: codeLabels
					}));
				} else if (block.kind === "reasoning") {
					if (!hideReasoning) {
						rendered.push(React.createElement(ThinkBox, {
							key: i,
							text: block.text,
							running: streaming && i === last,
							t: t
						}));
					}
				} else if (block.kind === "image") {
					var start = i;
					var group = [block];
					while (i + 1 < blocks.length) {
						var next = blocks[i + 1];
						if (next === undefined || next.kind !== "image") break;
						group.push(next);
						i += 1;
					}
					rendered.push(React.createElement(React.Fragment, { key: start }, renderMessageImages({
						images: group.map(function (b) { return { attachment: b.attachment }; }),
						align: "start"
					})));
				} else if (block.kind === "tool-call") {
					// 跳过：工具调用由官方 tool-call renderer 渲染
				} else {
					rendered.push(React.createElement(JsonBlock, {
						key: i,
						label: t("message.unknownBlock"),
						payload: block.block,
						truncatedLabel: function (total) { return t("json.truncated", { total: total }); }
					}));
				}
			}
			return React.createElement("div", { className: "dsh-assistant-root", "data-streaming": streaming || undefined },
				React.createElement("div", { className: "dsh-assistant-body" },
					rendered,
					interrupted && React.createElement("span", { className: "dsh-assistant-stopped" }, t("message.stopped"))
				)
			);
		}

		// assistant-step 座位：只按投影结果渲染，不做任何分段/可见性判定。
		//   body      正文永远渲染；正文内思维链随其前一段的展开状态显隐。
		//   process   可见/预览 → 渲染内容；隐藏且无锚定栏 → 隐藏占位收掉座位
		//             盒子（B17：空渲染会留下带 margin 的零高盒子）；有栏 →
		//             只渲染栏（B2 ④a），座位保持可见。
		//   empty-step 无可见内容也无思维链 → 恒隐藏（同隐藏占位）。
		function barElsOf(bars, pos) {
			var els = [];
			if (bars !== undefined) {
				for (var i = 0; i < bars.length; i++) {
					if (bars[i].pos === pos) {
						els.push(React.createElement(ProcessFold, {
							key: bars[i].segKey,
							segKey: bars[i].segKey,
							toolCalls: bars[i].toolCalls,
							messages: bars[i].messages,
							pos: bars[i].pos
						}));
					}
				}
			}
			return els;
		}

		function AssistantNodeView(props) {
			try {
				var node = props.node;
				var t = props.t;
				var chat = chatOf(props);
				var proj = useProjection(props);
				var data = node.data;
				if (proj === null || !proj.active) {
					return React.createElement(React.Fragment, null,
						React.createElement(FoldStyleMount, { proj: proj }),
						React.createElement(AssistantMarkdown, {
							blocks: data.blocks,
							streaming: data.status === "running",
							interrupted: data.status === "interrupted",
							renderMessageImages: props.renderMessageImages,
							t: t
						})
					);
				}
				var view = proj.views.get(node.key);
				if (view === undefined) return HiddenTurnNode();
				var anchorBars = view.role === "empty-step" ? undefined : proj.barsByAnchor.get(node.key);
				if (view.role === "body") {
					// B2 栏锚定：本正文封口的段（无步骤）→ 栏在正文上方（联动正文内
					// 思维链）；其后段的段首落座（②）→ 栏在正文下方。
					return React.createElement(React.Fragment, null,
						React.createElement(FoldStyleMount, { proj: proj }),
						barElsOf(anchorBars, "before"),
						React.createElement(AssistantMarkdown, {
							blocks: data.blocks,
							hideReasoning: view.segKey !== null && !isSegExpanded(view.segKey),
							streaming: data.status === "running",
							interrupted: data.status === "interrupted",
							renderMessageImages: props.renderMessageImages,
							t: t
						}),
						barElsOf(anchorBars, "after")
					);
				}
				if (view.role === "empty-step") {
					// B17：空渲染 ≠ 隐藏——slot 容器让座位永不为 :empty，零高盒子
					// 仍吃官方 ~ 间距 margin（flex 列不塌缩），间隔随折叠步数累积。
					// 渲染隐藏标记，由静态 :has 规则收掉座位；FoldStyleMount 保留
					// （display:none 不影响 effect，样式写入覆盖面不变）。
					return React.createElement(React.Fragment, null,
						React.createElement(FoldStyleMount, { proj: proj }),
						HiddenTurnNode()
					);
				}
				if (view.state === "hidden") {
					// 隐藏过程步仍可锚定折叠栏（B2 ④a：steering 后段首步）——
					// 有栏只渲染栏（座位保持可见）；无栏同空载步收掉座位（B17）。
					if (anchorBars === undefined || anchorBars.length === 0) {
						return React.createElement(React.Fragment, null,
							React.createElement(FoldStyleMount, { proj: proj }),
							HiddenTurnNode()
						);
					}
					return React.createElement(React.Fragment, null,
						React.createElement(FoldStyleMount, { proj: proj }),
						barElsOf(anchorBars, "before")
					);
				}
				return React.createElement(React.Fragment, null,
					React.createElement(FoldStyleMount, { proj: proj }),
					barElsOf(anchorBars, "before"),
					React.createElement(AssistantMarkdown, {
						blocks: data.blocks,
						streaming: data.status === "running",
						interrupted: data.status === "interrupted",
						renderMessageImages: props.renderMessageImages,
						t: t
					})
				);
			} catch (e) {
				return React.createElement("pre", { "data-dsh-debug-error": true }, "AssistantNodeView: " + (e && e.message) + "\n" + JSON.stringify(props.node && props.node.data).slice(0, 300));
			}
		}

		// ---------- §9 行为：补点加载历史 ----------
		// 官方「加载更早」每次只 prepend 50 条事件；折叠场景下这 50 条可能全是
		// 隐藏节点，点一次看不到任何变化。捕获用户的真实点击后由这里持续补点，
		// 但只补到“被监视的最旧折叠栏已完整”为止，不把全部历史都拉进来（SPEC §3）。
		// 停止条件（S）：
		//   S1 被监视段不再是 DOM 第一个折叠栏 —— 它前面的段/轮已加载出来；
		//   S2 被监视段步骤数不再增长（读投影模型，不再解析栏内文本）。
		var autoLoad = { active: false, clicks: 0, btn: null, watchSeg: null, watchCount: -1 };
		var autoLoadTimer = null;
		var AUTOLOAD_LIMIT = 500;
		var AUTOLOAD_TICK_MS = 120;
		var latestProjection = null;

		function findLoadOlderBtn() {
			if (typeof document === "undefined") return null;
			var buttons = document.querySelectorAll("button");
			for (var i = 0; i < buttons.length; i++) {
				var text = (buttons[i].textContent || "").trim();
				if (text === "加载更早" || text === "Load earlier") return buttons[i];
			}
			return null;
		}

		function findLoadingOlderBtn() {
			if (typeof document === "undefined") return null;
			var buttons = document.querySelectorAll("button");
			for (var i = 0; i < buttons.length; i++) {
				if (!buttons[i].disabled) continue;
				var text = (buttons[i].textContent || "").trim();
				if (text === "加载中…" || text === "Loading…" || text === "Loading...") return buttons[i];
			}
			return null;
		}

		function scheduleAutoLoad() {
			if (!autoLoad.active) return;
			if (autoLoadTimer !== null) clearTimeout(autoLoadTimer);
			autoLoadTimer = setTimeout(function () {
				autoLoadTimer = null;
				autoLoadOlderTick();
			}, AUTOLOAD_TICK_MS);
		}

		function stopAutoLoad() {
			autoLoad.active = false;
			if (autoLoadTimer !== null) {
				clearTimeout(autoLoadTimer);
				autoLoadTimer = null;
			}
		}

		function watchedFoldCount() {
			if (autoLoad.watchSeg === null || latestProjection === null) return -1;
			var seg = latestProjection.timeline.segByKey[autoLoad.watchSeg];
			return seg ? seg.steps : -1;
		}

		function autoLoadOlderTick() {
			if (!autoLoad.active || typeof document === "undefined") return;
			var btn = autoLoad.btn;
			// React 翻页后会重挂“加载更早”按钮；旧节点断连时按当前文本重新找，
			// 否则只点一次就停止（用户看到的“点一次仍加载不完”）。
			if (!btn || !btn.isConnected) {
				btn = findLoadOlderBtn();
				autoLoad.btn = btn;
			}
			if (!btn) {
				// 可能正处于“加载中…”状态：找到加载中的按钮就继续等，别过早停。
				if (findLoadingOlderBtn() !== null) {
					scheduleAutoLoad();
					return;
				}
				stopAutoLoad();
				return;
			}
			if (autoLoad.clicks >= AUTOLOAD_LIMIT) {
				stopAutoLoad();
				return;
			}
			if (btn.disabled) {
				// 本页仍在加载，稍后再续点
				scheduleAutoLoad();
				return;
			}
			// 停止条件 S1/S2：出现过一次“有进展”后即可判定。
			if (autoLoad.watchSeg !== null) {
				var current = watchedFoldCount();
				var firstBar = document.querySelector(".dsh-turnfold[data-seg-key]");
				var progressed = autoLoad.clicks > 0 || current !== autoLoad.watchCount;
				if (progressed) {
					var gainedNewBar = !firstBar || firstBar.getAttribute("data-seg-key") !== autoLoad.watchSeg;
					if (gainedNewBar || current < 0 || current <= autoLoad.watchCount) {
						stopAutoLoad();
						return;
					}
					autoLoad.watchCount = current;
				}
			}
			autoLoad.clicks += 1;
			btn.click();
			scheduleAutoLoad();
		}

		// ---------- §10 样式与装配 ----------
		var CSS = [
			".dsh-think{flex-direction:column;display:flex}",
			".dsh-think-row{position:relative;overflow:hidden}",
			".dsh-think-leading{flex-shrink:0}",
			".dsh-think-chevron{color:var(--dsw-alias-label-secondary)}",
			".dsh-think-title{font-weight:400}",
			".dsh-think-separator{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 0.5rem}",
			".dsh-think-summary{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;font-size:0.875rem;line-height:1.5rem;overflow:hidden}",
			".dsh-think-body{box-sizing:border-box;background:var(--dsw-alias-markdown-code-block);width:calc(100% - 1.375rem);max-height:12rem;color:var(--dsw-alias-label-tertiary);white-space:pre-wrap;word-break:break-word;border:none;border-radius:0.5rem;margin:0.25rem 0 0 1.375rem;padding:0.625rem 1rem 0.75rem 0.75rem;overflow-y:auto;overscroll-behavior:contain;font-size:0.875rem;line-height:1.5rem}",
			".dsh-assistant-root{color:var(--dsw-alias-label-primary);flex-direction:column;font-size:1rem;line-height:1.75rem;display:flex}",
			".dsh-assistant-body{flex-direction:column;gap:1rem;display:flex}",
			".dsh-assistant-stopped{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);border-radius:0.375rem;align-self:flex-start;padding:0 0.375rem;font-size:0.6875rem;line-height:1.125rem}",
			"[data-dsh-hidden-turn]{display:none}",
			'[data-chat-flow-kind="assistant-step"]:has([data-dsh-hidden-turn]){display:none}',
			".dsh-tv-row{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}",
			".dsh-tv-rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}",
			".dsh-tv-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}",
			".dsh-tv-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}",
			".dsh-tv-selector{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:18px;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}",
			".dsh-tv-selector:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dsh-tv-chevron{flex:none}",
			".dsh-tv-select{background:var(--dsw-alias-bg-module-platform);height:36px;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:18px;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}",
			".dsh-turnfold{box-sizing:border-box;border:none;border-bottom:.5px solid var(--dsw-alias-border-l2);width:100%;min-width:0;height:33px;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left;background:0 0;align-items:center;padding:0 0 8px;display:flex}",
			".dsh-turnfold[data-open]{padding:8px 0 8px}",
			".dsh-turnfold-label{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:14px;line-height:24px;overflow:hidden}",
			".dsh-turnfold-chevron{width:16px;height:16px;color:var(--dsw-alias-label-tertiary);flex:none;margin-left:6px;transition:transform .1s;transform:rotate(-90deg)}",
			".dsh-turnfold[data-open] .dsh-turnfold-chevron{transform:rotate(0)}",
			// B2 栏锚定进座位后的间距：before 栏补上原先流程条目间距的下空隙，
			// after 栏与上方正文拉开距离（兜底栏仍在独立条目内，不受影响）。
			'[data-chat-flow-kind="assistant-step"] .dsh-turnfold[data-bar-pos="before"]{margin:0 0 8px}',
			'[data-chat-flow-kind="assistant-step"] .dsh-turnfold[data-bar-pos="after"]{margin:12px 0 0}',
			// all 模式：折叠由插件接管。抵消官方 compact 视图对过程座位的隐藏
			//（hidden="until-found" 走 content-visibility:hidden，需一并还原；
			// 带插件隐藏标记的 assistant-step / turn-process 座位仍由上方 :has 规则隐藏）。
			':root[data-dsh-fold-mode=all] [data-chat-flow-key][hidden]:not(:has([data-dsh-hidden-turn])){display:block!important;content-visibility:visible!important}'
		].join("");

		// 官方设置行的“折叠”模式下拉（影子自带 transcript-view）。
		function TranscriptViewRowFold(props) {
			React.useSyncExternalStore(subscribeTranscript, getTranscriptVersion);
			var setTranscriptView = props.setTranscriptView;
			var t = props.t;
			var mode = getTranscriptMode();
			var openState = React.useState(false);
			var open = openState[0];
			var setOpen = openState[1];
			function labelOf(key, fallback) {
				var value = t ? t(key) : null;
				return value && value !== key ? value : fallback;
			}
			var options = [
				{ id: "normal", label: labelOf("settings.transcript.normal", "正常") },
				{ id: "compact", label: labelOf("settings.transcript.compact", "紧凑") },
				{ id: "fold", label: "折叠" }
			];
			var selected = options[0];
			for (var oi = 0; oi < options.length; oi++) {
				if (options[oi].id === mode) { selected = options[oi]; break; }
			}
			function closeMenu() { setOpen(false); }
			function selectMode(id) {
				// normal/compact 保持官方原样：同步给官方；fold 只启用本插件，不改官方对话显示。
				if (id !== "fold" && setTranscriptView) setTranscriptView(id);
				var changed = id !== getTranscriptMode();
				setTranscriptMode(id);
				try {
					if (typeof localStorage !== "undefined") localStorage.setItem("dsh-conversation-folding.displayMode", id);
				} catch (e) { }
				// 聊天视图对模式切换的响应式订阅在部分组件上没有即时重渲染，
				// 选择模式后重载一次以保证生效（设置值已持久化）。
				if (changed) setTimeout(function () { if (typeof location !== "undefined") location.reload(); }, 50);
			}
			var selector = React.createElement("button", {
				type: "button",
				className: "dsh-tv-selector",
				"aria-haspopup": "menu",
				"aria-expanded": open,
				onClick: function () { setOpen(function (v) { return !v; }); }
			}, selected.label, React.createElement(IconChevronDownOutline14, { className: "dsh-tv-chevron" }));
			return React.createElement("div", { className: "dsh-tv-row" },
				React.createElement("div", { className: "dsh-tv-rowText" },
					React.createElement("div", { className: "dsh-tv-title" }, labelOf("settings.transcript.title", "对话显示")),
					React.createElement("div", { className: "dsh-tv-desc" }, labelOf("settings.transcript.description", "完成后对话的展示方式；「折叠」由 dsh-conversation-folding 接管"))
				),
				React.createElement(Menu, {
					open: open,
					onClose: closeMenu,
					items: options.map(function (option) {
						return { id: option.id, label: option.label };
					}),
					selectedId: mode,
					onSelect: function (id) { closeMenu(); selectMode(id); },
					align: "end",
					portal: true,
					anchor: selector
				})
			);
		}

		function apply(ctx) {
			var slots = ctx.get("slots");
			if (slots === undefined) return;

			loadConfig();

			ctx.effect(function () {
				if (typeof document === "undefined") return;
				var tagId = "dsh-conversation-folding/styles";
				var existing = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]");
				if (existing !== null) return;
				var tag = document.createElement("style");
				tag.dataset.plugin = "dsh-conversation-folding";
				tag.dataset.pluginCss = tagId;
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return function () { tag.remove(); };
			});

			// 影子官方“对话显示”设置行，新增第三项「折叠」；官方 normal/compact 保持原样。
			slots.inject("settings.general.item", function () {
				return slots.register(
					{ name: "settings.general.item", id: "transcript-view", order: 12, priority: -1, locale: "chat" },
					function (props) {
						return React.createElement(TranscriptViewRowFold, props);
					}
				);
			});

			// 影子 assistant-step 与 turn-process（0.1.2 slots 选举制：同 key 必须显式
			// 更低 priority，低者渲染，见 BUGS.md B3）。tool-call / context 交给官方
			// 渲染，显隐由投影生成的动态 CSS 控制（§5 F2/F3/F4）。
			slots.inject("conversation.chat.node", function () {
				return slots.register(
					{ name: "conversation.chat.node", key: "assistant-step", locale: "conversation", priority: -1 },
					function (props) { return React.createElement(AssistantNodeView, props); }
				);
			});
			slots.inject("conversation.chat.node", function () {
				return slots.register(
					{ name: "conversation.chat.node", key: "turn-process", locale: "conversation", priority: -1 },
					function (props) { return React.createElement(TurnProcessFoldView, props); }
				);
			});

			// 「加载更早」一次点击补点：捕获用户真实点击并激活补点开关，之后由
			// setTimeout 驱动 autoLoadOlderTick 持续补点，直到 S1/S2 停止条件满足。
			ctx.effect(function () {
				if (typeof document === "undefined") return;
				function onClick(event) {
					var target = event.target;
					if (!target || typeof target.closest !== "function") return;
					var btn = target.closest("button");
					if (!btn || btn.disabled) return;
					var text = (btn.textContent || "").trim();
					if (text !== "加载更早" && text !== "Load earlier") return;
					if (autoLoad.active) return;
					autoLoad.active = true;
					autoLoad.clicks = 0;
					autoLoad.btn = btn;
					// 记录点击时最旧的折叠栏（segKey 稳定，跨翻页不漂移），用它判断
					// “步骤是否已全部加载”。
					var firstBar = document.querySelector(".dsh-turnfold[data-seg-key]");
					autoLoad.watchSeg = firstBar ? firstBar.getAttribute("data-seg-key") : null;
					autoLoad.watchCount = latestProjection !== null && autoLoad.watchSeg !== null
						? watchedFoldCount()
						: -1;
					if (autoLoad.watchCount < 0) autoLoad.watchCount = 0;
					scheduleAutoLoad();
				}
				document.addEventListener("click", onClick, true);
				return function () {
					document.removeEventListener("click", onClick, true);
					stopAutoLoad();
				};
			});

			syncFoldModeAttr(isFoldActive() ? getFoldMode() : "none");
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		// 测试缝（供 Node 单测加载真实 bundle 后驱动纯模型/投影；生产零依赖）。
		exports.__test = { classifyNode: classifyNode, buildTimeline: buildTimeline, projectView: projectView };
		return module.exports;
	}
});
