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

		// ---------- 折叠模式配置 ----------
		// 默认全部折叠；通过 profile 的 cordis.patch.yml 传入 host，再由
		// /api/conversation-folding/config 暴露给浏览器端。
		//   all      —— 用户输入到 LLM 输出整轮折叠，默认
		//   toolcall —— 保留现状：折叠 thinking 之间的 tool call
		//   none     —— 关闭整轮折叠和 tool-call 分组，保留 thinking 增强样式
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

		function setFoldMode(mode) {
			if (mode === "all" || mode === "toolcall" || mode === "none") {
				if (mode !== getFoldMode()) {
					configState = { foldMode: mode, auxVisible: getAuxVisible() };
					configVersion += 1;
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

		// ---------- 整轮折叠状态 ----------
		// 用 turn number 作为 key；折叠状态在 user/steering 节点和后续
		// assistant/tool 节点之间共享。
		var turnExpanded = new Map();
		var turnVersion = 0;
		var turnListeners = new Set();

		function getTurnVersion() {
			return turnVersion;
		}

		function subscribeTurn(listener) {
			turnListeners.add(listener);
			return function () { turnListeners.delete(listener); };
		}

		function isTurnExpanded(turn) {
			return turn !== undefined && turnExpanded.get(turn) === true;
		}

		function setTurnExpanded(turn, expanded) {
			if (turn === undefined) return;
			turnExpanded.set(turn, expanded);
			turnVersion += 1;
			turnListeners.forEach(function (fn) { fn(); });
		}

		// ---------- 对话节点辅助 ----------
		function turnOf(node) {
			var loc = node && node.location;
			if (!loc) return undefined;
			if (loc.kind === "turn" || loc.kind === "step") {
				return loc.turn && loc.turn.turn;
			}
			return undefined;
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
			var mentions = props.mentions;
			var hideReasoning = props.hideReasoning;
			var t = props.t;
			var codeLabels = React.useMemo(function () {
				return { copyLabel: t("copy"), copiedLabel: t("copied") };
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
						codeLabels: codeLabels,
						fileMentions: mentions
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
					// 跳过：工具调用由独立 tool-call 节点渲染
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

		// ---------- 整轮折叠 ----------
		function HiddenTurnNode() {
			return React.createElement("div", { "data-dsh-hidden-turn": true });
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

		function isProcessNode(node) {
			return node && ((node.kind === "tool-call" && !isSkillToolCall(node)) || (node.kind === "assistant-step" && hasReasoning(node)));
		}

		function firstProcessIndex(order, nodes, turn) {
			for (var i = 0; i < order.length; i++) {
				var node = nodes.get(order[i]);
				if (!node || turnOf(node) !== turn) continue;
				if (isProcessNode(node)) return i;
			}
			return -1;
		}

		function isFirstProcessNode(order, nodes, node) {
			var idx = order.indexOf(node && node.key);
			var turn = turnOf(node);
			if (idx < 0 || turn === undefined) return false;
			return idx === firstProcessIndex(order, nodes, turn);
		}

		function lastProcessIndex(order, nodes, turn) {
			var found = -1;
			for (var i = 0; i < order.length; i++) {
				var node = nodes.get(order[i]);
				if (!node || turnOf(node) !== turn) continue;
				if (isProcessNode(node)) found = i;
			}
			return found;
		}

		function isLatestProcessNode(order, nodes, node) {
			var idx = order.indexOf(node && node.key);
			var turn = turnOf(node);
			if (idx < 0 || turn === undefined) return false;
			return idx === lastProcessIndex(order, nodes, turn);
		}

		// 只有 turn-tail 的 closing（本轮最后一条有正文的 assistant）才算“最终正文”；
		// 中间步骤的正文播报仍属于过程，否则多 step 会话会把所有中间播报都漏出来。
		function closingOfTurn(order, nodes, turn) {
			for (var i = 0; i < order.length; i++) {
				var node = nodes.get(order[i]);
				if (!node || node.kind !== "turn-tail" || turnOf(node) !== turn) continue;
				var closing = node.data && node.data.closing;
				return closing || null;
			}
			return null;
		}

		function isClosingAssistantNode(node, closing) {
			if (closing === null || closing === undefined || closing.finalNode === undefined) return false;
			var finalNode = node && node.data && node.data.finalNode;
			if (finalNode === undefined) return false;
			if (finalNode.seq === closing.finalNode.seq) return true;
			return finalNode.messageId !== undefined && closing.finalNode.messageId !== undefined && finalNode.messageId === closing.finalNode.messageId;
		}

		function ProcessFold(props) {
			React.useSyncExternalStore(subscribeConfig, getConfigVersion);
			React.useSyncExternalStore(subscribeTurn, getTurnVersion);

			var turn = turnOf(props.node);
			var expanded = isTurnExpanded(turn);

			var toggleLabel = expanded ? "收起过程" : "展开过程";
			var toggle = React.createElement("button", {
				type: "button",
				className: "dsh-turnfold-toggle",
				onClick: function () { setTurnExpanded(turn, !expanded); }
			}, toggleLabel);

			// 折叠栏只做“展开/收起”，不展示摘要；thinking/tool call 全部隐藏。
			return React.createElement("div", { className: "dsh-turnfold dsh-turnfold-process" }, toggle);
		}

		// ---------- assistant-step 节点渲染 ----------
		function visibleBlocksOf(blocks) {
			if (!Array.isArray(blocks)) return [];
			return blocks.filter(function (block) {
				return block && block.kind !== "reasoning" && block.kind !== "tool-call";
			});
		}

		function AssistantNodeView(props) {
			React.useSyncExternalStore(subscribeConfig, getConfigVersion);
			React.useSyncExternalStore(subscribeTurn, getTurnVersion);

			var node = props.node;
			var t = props.t;
			var useSession = props.useSession;
			var order = useSession(function (s) { return s.chat.order; });
			var nodes = useSession(function (s) { return s.chat.nodes; });
			var mode = getFoldMode();
			var turn = turnOf(node);
			var data = node.data;
			var visible = visibleBlocksOf(data.blocks);

			// 整轮折叠：
			// - 正常思考时：只显示最近一次 thinking/tool call（强化样式），更早过程隐藏；
			// - 正文输出后：所有过程都隐藏，只留折叠栏 + 正文。
			if (mode === "all") {
				var expandedTurn = isTurnExpanded(turn);
				var firstProcess = isFirstProcessNode(order, nodes, node);
				var latestProcess = isLatestProcessNode(order, nodes, node);
				var closing = closingOfTurn(order, nodes, turn);
				var hasFinal = closing !== null;
				var isFinal = isClosingAssistantNode(node, closing);
				var parts = [];
				if (firstProcess) {
					parts.push(React.createElement(ProcessFold, Object.assign({}, props, { slots: props.slots })));
				}
				if (expandedTurn) {
					parts.push(React.createElement(AssistantMarkdown, {
						blocks: data.blocks,
						streaming: data.status === "running",
						interrupted: data.status === "interrupted",
						renderMessageImages: props.renderMessageImages,
						mentions: undefined,
						t: t
					}));
				} else if (!hasFinal && latestProcess) {
					// 正文还没出来：显示最近一次 thinking（强化 ThinkBox）
					parts.push(React.createElement(AssistantMarkdown, {
						blocks: data.blocks,
						streaming: data.status === "running",
						interrupted: data.status === "interrupted",
						renderMessageImages: props.renderMessageImages,
						mentions: undefined,
						t: t
					}));
				} else if (visible.length > 0 && isFinal) {
					// 只有最终正文节点独立显示，隐藏其中的 reasoning/tool-call 过程。
					parts.push(React.createElement(AssistantMarkdown, {
						blocks: data.blocks,
						hideReasoning: true,
						streaming: data.status === "running",
						interrupted: data.status === "interrupted",
						renderMessageImages: props.renderMessageImages,
						mentions: undefined,
						t: t
					}));
				}
				if (parts.length === 0) return HiddenTurnNode();
				if (parts.length === 1) return parts[0];
				return React.createElement(React.Fragment, null, parts);
			}

			return React.createElement(AssistantMarkdown, {
				blocks: data.blocks,
				streaming: data.status === "running",
				interrupted: data.status === "interrupted",
				renderMessageImages: props.renderMessageImages,
				mentions: undefined,
				t: t
			});
		}

		// ---------- tool-call 分组折叠 ----------
		function isSettled(toolNode) {
			var root = toolNode.data && toolNode.data.root;
			return root !== undefined && "kind" in root;
		}
		function computeGroup(order, nodes, key) {
			var idx = order.indexOf(key);
			if (idx < 0) return { start: idx, end: idx, count: 1, isLast: true };
			var start = idx;
			while (start > 0) {
				var prev = nodes.get(order[start - 1]);
				if (prev === undefined || prev.kind !== "tool-call") break;
				start -= 1;
			}
			var end = idx;
			while (end < order.length - 1) {
				var next = nodes.get(order[end + 1]);
				if (next === undefined || next.kind !== "tool-call") break;
				end += 1;
			}
			return { start: start, end: end, count: end - start + 1, isLast: idx === end };
		}
		function findShippedToolCallTree(slots) {
			var entries = slots.entries("conversation.chat.node");
			for (var i = 0; i < entries.length; i++) {
				var e = entries[i];
				if (e.options.key === "tool-call" && (e.options.priority || 0) === 0) return e.component;
			}
			return undefined;
		}
		function standardPropsOf(props) {
			return {
				useSession: props.useSession,
				useSessions: props.useSessions,
				useWorkspaces: props.useWorkspaces,
				sessionId: props.sessionId,
				useProjection: props.useProjection,
				useInput: props.useInput,
				inputActions: props.inputActions
			};
		}
		function makeToolViewRenderer(slots, props) {
			var standard = standardPropsOf(props);
			return function (key, owner, opts) {
				if (key !== "tool.call.toolview") return null;
				var entries = slots.entriesOfSlot("tool.call.toolview");
				for (var i = 0; i < entries.length; i++) {
					if (entries[i].options.key === opts.entryKey) {
						return React.createElement(entries[i].component, Object.assign({}, standard, owner, { t: props.t }));
					}
				}
				return opts.fallback || null;
			};
		}
		function renderShippedToolCall(slots, node, props) {
			var ShippedToolCallTree = findShippedToolCallTree(slots);
			if (ShippedToolCallTree === undefined) return null;
			return React.createElement(ShippedToolCallTree, {
				renderSlot: makeToolViewRenderer(slots, props),
				node: node,
				selectedCallId: props.selectedCallId,
				cwd: props.cwd,
				openFile: props.openFile,
				inspectCall: props.inspectCall,
				useHostDescription: props.useHostDescription,
				t: props.t
			});
		}
		function ToolCallGroup(props) {
			React.useSyncExternalStore(subscribeConfig, getConfigVersion);
			React.useSyncExternalStore(subscribeTurn, getTurnVersion);

			var node = props.node;
			var slots = props.slots;
			var useSession = props.useSession;
			var t = props.t;
			var mode = getFoldMode();
			var order = useSession(function (s) { return s.chat.order; });
			var nodes = useSession(function (s) { return s.chat.nodes; });
			var expandedState = React.useState(false);
			var expanded = expandedState[0];
			var setExpanded = expandedState[1];

			if (mode === "none") return renderShippedToolCall(slots, node, props);
			if (mode === "all") {
				var expandedTurn = isTurnExpanded(turnOf(node));
				if (isSkillToolCall(node)) {
					// skill 加载按辅助项处理：折叠时只有在 auxVisible 里才显示，
					// 展开后始终可见。
					if (expandedTurn || includesAux("skill")) return renderShippedToolCall(slots, node, props);
					return HiddenTurnNode();
				}
				if (expandedTurn) {
					if (isFirstProcessNode(order, nodes, node)) {
						return React.createElement(React.Fragment, null,
							React.createElement(ProcessFold, Object.assign({}, props, { slots: slots })),
							renderShippedToolCall(slots, node, props)
						);
					}
					// 全部折叠展开后完整展示所有工具调用，不再二次分组
					return renderShippedToolCall(slots, node, props);
				}
				var turn = turnOf(node);
				if (isFirstProcessNode(order, nodes, node)) {
					return React.createElement(ProcessFold, Object.assign({}, props, { slots: slots }));
				}
				if (closingOfTurn(order, nodes, turn) === null && isLatestProcessNode(order, nodes, node)) {
					// 正文还没出来：显示最近一次 tool call
					return renderShippedToolCall(slots, node, props);
				}
				return HiddenTurnNode();
			}

			var group = computeGroup(order, nodes, node.key);
			if (group.count <= 1) return renderShippedToolCall(slots, node, props);

			var anyRunning = false;
			for (var i = group.start; i <= group.end; i++) {
				var n = nodes.get(order[i]);
				if (n !== undefined && !isSettled(n)) { anyRunning = true; break; }
			}
			if (anyRunning) return renderShippedToolCall(slots, node, props);
			if (!group.isLast) {
				return React.createElement("div", { "data-dsh-hidden-toolcall": true });
			}

			var groupNodes = [];
			for (var j = group.start; j <= group.end; j++) {
				var gn = nodes.get(order[j]);
				if (gn !== undefined) groupNodes.push(gn);
			}
			var visible = expanded ? groupNodes : [node];
			var items = visible.map(function (gn) {
				return renderShippedToolCall(slots, gn, props);
			});
			return React.createElement("div", { className: "dsh-toolgroup" },
				React.createElement("button", {
					type: "button",
					className: "dsh-toolgroup-toggle",
					onClick: function () { setExpanded(function (v) { return !v; }); }
				}, expanded ? "收起" : "展开 " + group.count + " 个步骤"),
				items
			);
		}

		// ---------- 上下文注入等辅助节点折叠 ----------
		function findShippedNodeTree(slots, key) {
			var entries = slots.entries("conversation.chat.node");
			for (var i = 0; i < entries.length; i++) {
				var e = entries[i];
				if (e.options.key === key && (e.options.priority || 0) === 0) return e.component;
			}
			return undefined;
		}

		function renderShippedNode(slots, key, node, props) {
			var ShippedNodeTree = findShippedNodeTree(slots, key);
			if (ShippedNodeTree === undefined) return null;
			return React.createElement(ShippedNodeTree, {
				node: node,
				t: props.t
			});
		}

		function ContextNodeView(props) {
			React.useSyncExternalStore(subscribeConfig, getConfigVersion);
			React.useSyncExternalStore(subscribeTurn, getTurnVersion);

			var mode = getFoldMode();
			var turn = turnOf(props.node);
			if (mode === "all" && !isTurnExpanded(turn) && !includesAux("context")) return HiddenTurnNode();
			return renderShippedNode(props.slots, props.node.kind, props.node, props);
		}


		// ---------- 样式（尺寸用 rem） ----------
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
			"[data-chat-flow-kind=\"tool-call\"]:has([data-dsh-hidden-toolcall]){display:none}",
			"[data-chat-flow-kind=\"assistant-step\"]:has([data-dsh-hidden-turn]),[data-chat-flow-kind=\"tool-call\"]:has([data-dsh-hidden-turn]),[data-chat-flow-kind=\"context\"]:has([data-dsh-hidden-turn]){display:none}",
			"[data-dsh-hidden-turn]{display:none}",
			".dsh-toolgroup{flex-direction:column;gap:0.25rem;display:flex}",
			".dsh-toolgroup-toggle{align-self:flex-start;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover-solid);cursor:pointer;border:none;border-radius:0.875rem;padding:0.25rem 0.75rem;font-size:0.75rem;line-height:1.125rem}",
			".dsh-toolgroup-toggle:hover{color:var(--dsw-alias-label-primary)}",
			".dsh-turnfold{flex-direction:row;align-items:center;gap:0.5rem;border:1px solid var(--dsw-alias-border);border-radius:0.5rem;padding:0.5rem 0.75rem;display:flex;background:var(--dsw-alias-interactive-bg-hover-solid)}",
			".dsh-turnfold-toggle{align-self:center;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);cursor:pointer;border:none;border-radius:0.875rem;padding:0.25rem 0.75rem;font-size:0.75rem;line-height:1.125rem}",
			".dsh-turnfold-toggle:hover{color:var(--dsw-alias-label-primary)}"
		].join("");

		// ---------- apply ----------
		function apply(ctx) {
			var slots = ctx.get("slots");
			var connection = ctx.get("connection");
			if (slots === undefined || connection === undefined) return;
			var toolInject = function () {
				return { hooks: { hostDescription: connection.hostDescription } };
			};

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

			slots.inject("conversation.chat.node", function () {
				return slots.register(
					{ name: "conversation.chat.node", key: "context", priority: -1, locale: "conversation" },
					function (props) { return React.createElement(ContextNodeView, Object.assign({}, props, { slots: slots })); }
				);
			});

			slots.inject("conversation.chat.node", function () {
				return slots.register(
					{ name: "conversation.chat.node", key: "assistant-step", priority: -1, locale: "conversation" },
					function (props) { return React.createElement(AssistantNodeView, props); }
				);
			});

			slots.inject("conversation.chat.node", function () {
				return slots.register(
					{ name: "conversation.chat.node", key: "tool-call", priority: -1, locale: "conversation", inject: toolInject },
					function (props) { return React.createElement(ToolCallGroup, Object.assign({}, props, { slots: slots })); }
				);
			});
		}

		exports.apply = apply;
		exports.inject = ["slots", "connection"];
		return module.exports;
	}
});
