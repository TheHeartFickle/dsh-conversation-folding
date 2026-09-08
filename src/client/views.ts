// §7 样式写入器（单写者，幂等） + §8 视图（思维链之外的全部座位组件）
import React from "react";
import { MarkdownText, JsonBlock, IconChevronDownOutline14 } from "@deepseek-ai/dsh-client-ui-primitives";
import { getSegVersion, isSegExpanded, setSegExpanded, subscribeSeg } from "./state.js";
import { useProjection, type Projection, type FoldBar, type BarPos, type UseChat } from "./projection.js";
import type { ChatNode, ChatBlock } from "./model.js";
import { ThinkBox } from "./think-box.js";

// 官方 i18n 函数（@deepseek-ai/dsh-client-locale 的 t）。
export type Translate = (key: string, params?: Record<string, unknown>) => string;

export interface RenderMessageImagesOptions {
	images: { attachment: unknown }[];
	align: string;
}

export type RenderMessageImages = (options: RenderMessageImagesOptions) => React.ReactNode;

// ---------- §7 样式写入器（单写者，幂等） ----------
// 规则文本是投影的纯函数；任何座位挂载 FoldStyleMount 都写同一文本，
// 重复写无副作用。保持动态样式位于静态样式之后，同优先级时后者胜出。
let dynamicStyle: HTMLStyleElement | null = null;

function applyFoldStyle(text: string): void {
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

export function FoldStyleMount(props: { proj: Projection | null }): null {
	const proj = props.proj;
	React.useEffect(() => {
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
function HiddenTurnNode(): React.ReactElement {
	return React.createElement("div", { "data-dsh-hidden-turn": true });
}

// 折叠栏（一段一栏）。文案为官方 turn-process 格式。pos 标记落位
// （before=锚点内容上方 / after=下方），供座位内间距样式使用。
function ProcessFold(props: FoldBar): React.ReactElement {
	React.useSyncExternalStore(subscribeSeg, getSegVersion);
	const segKey = props.segKey;
	const expanded = isSegExpanded(segKey);
	const toolCalls = props.toolCalls;
	const messages = props.messages;
	const labels: string[] = [];
	if (toolCalls > 0) labels.push(toolCalls + " 个工具调用");
	if (messages > 0) labels.push(messages + " 条消息");
	const label = labels.length > 0 ? labels.join(" · ") : "思考了一会儿";
	return React.createElement("button", {
		type: "button",
		className: "dsh-turnfold dsh-turnfold-process",
		"data-open": expanded || undefined,
		"data-seg-key": segKey,
		"data-bar-pos": props.pos === "after" ? "after" : "before",
		"aria-expanded": expanded,
		onClick: () => setSegExpanded(segKey, !expanded)
	}, React.createElement("span", { className: "dsh-turnfold-label" }, label),
		React.createElement(IconChevronDownOutline14, { className: "dsh-turnfold-chevron" })
	);
}

function barEl(bar: FoldBar): React.ReactElement {
	return React.createElement(ProcessFold, {
		key: bar.segKey,
		segKey: bar.segKey,
		toolCalls: bar.toolCalls,
		messages: bar.messages,
		pos: bar.pos
	});
}

function barElsOf(bars: FoldBar[] | undefined, pos: BarPos): React.ReactElement[] {
	const els: React.ReactElement[] = [];
	if (bars !== undefined) {
		for (const bar of bars) {
			if (bar.pos === pos) els.push(barEl(bar));
		}
	}
	return els;
}

// 官方 turn-process 控件的复刻（非 fold 显示模式下原样呈现）。
interface TurnProcessControl {
	foldable: boolean;
	open: boolean;
	setOpen(open: boolean): void;
}

function OfficialTurnProcessView(props: { node: ChatNode; t: Translate; turnProcess?: TurnProcessControl | null }): React.ReactElement | null {
	const node = props.node;
	const turnProcess = props.turnProcess;
	const t = props.t;
	if (!turnProcess || !turnProcess.foldable) return null;
	const data = node.data ?? {};
	const open = turnProcess.open;
	const labels: string[] = [];
	if ((data.toolCallCount ?? 0) > 0) labels.push(t((data.toolCallCount ?? 0) === 1 ? "message.turnProcess.toolCalls.one" : "message.turnProcess.toolCalls.other", { count: data.toolCallCount }));
	if ((data.messageCount ?? 0) > 0) labels.push(t((data.messageCount ?? 0) === 1 ? "message.turnProcess.messages.one" : "message.turnProcess.messages.other", { count: data.messageCount }));
	if ((data.subagentCount ?? 0) > 0) labels.push(t((data.subagentCount ?? 0) === 1 ? "message.turnProcess.subagents.one" : "message.turnProcess.subagents.other", { count: data.subagentCount }));
	const label = labels.length === 0 ? t("message.turnProcess.thoughtForAWhile") : labels.join(t("message.turnProcess.separator"));
	return React.createElement("button", {
		type: "button",
		className: "dsh-turnfold dsh-turnfold-official",
		"data-open": open || undefined,
		"aria-expanded": open,
		onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
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
export interface TurnProcessFoldViewProps {
	node: ChatNode;
	t: Translate;
	turnProcess?: TurnProcessControl | null;
	useChat?: UseChat;
	// host 座位会传入本插件不读取的其余 props
	[key: string]: unknown;
}

export function TurnProcessFoldView(props: TurnProcessFoldViewProps): React.ReactElement | null {
	const proj = useProjection(props);
	if (proj === null) return HiddenTurnNode();
	if (!proj.active) return OfficialTurnProcessView(props);
	const node = props.node;
	const bars = node ? proj.barsByAnchor.get(node.key) : undefined;
	if (!bars || bars.length === 0) return HiddenTurnNode();
	const parts: React.ReactElement[] = bars.map(barEl);
	parts.push(React.createElement(FoldStyleMount, { proj: proj, key: "style" }));
	return React.createElement(React.Fragment, null, parts);
}

// ---------- 助手消息渲染（reasoning 分支走 ThinkBox） ----------
interface AssistantMarkdownProps {
	blocks: (ChatBlock | undefined)[];
	streaming?: boolean | null;
	interrupted?: boolean | null;
	renderMessageImages?: RenderMessageImages;
	hideReasoning?: boolean;
	t: Translate;
}

function AssistantMarkdown(props: AssistantMarkdownProps): React.ReactElement | null {
	const blocks = props.blocks;
	const streaming = props.streaming;
	const interrupted = props.interrupted;
	const renderMessageImages = props.renderMessageImages;
	const hideReasoning = props.hideReasoning;
	const t = props.t;
	const codeLabels = React.useMemo(() => {
		return {
			code: { copyLabel: t("copy"), copiedLabel: t("copied") },
			footnotes: t("markdown.footnotes")
		};
	}, [t]);
	const last = blocks.length - 1;
	if (!(streaming || interrupted === true || blocks.some((block) => block !== undefined && block.kind !== "tool-call"))) return null;
	const rendered: React.ReactElement[] = [];
	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		if (block === undefined) continue;
		if (block.kind === "text") {
			rendered.push(React.createElement(MarkdownText, {
				key: i,
				text: block.text ?? "",
				streaming: streaming ?? false,
				labels: codeLabels
			}));
		} else if (block.kind === "reasoning") {
			if (!hideReasoning) {
				rendered.push(React.createElement(ThinkBox, {
					key: i,
					text: block.text ?? "",
					running: streaming === true && i === last
				}));
			}
		} else if (block.kind === "image") {
			const start = i;
			const group: ChatBlock[] = [block];
			while (i + 1 < blocks.length) {
				const next = blocks[i + 1];
				if (next === undefined || next.kind !== "image") break;
				group.push(next);
				i += 1;
			}
			if (renderMessageImages) {
				rendered.push(React.createElement(React.Fragment, { key: start }, renderMessageImages({
					images: group.map((b) => { return { attachment: b.attachment }; }),
					align: "start"
				})));
			}
		} else if (block.kind === "tool-call") {
			// 跳过：工具调用由官方 tool-call renderer 渲染
		} else {
			rendered.push(React.createElement(JsonBlock, {
				key: i,
				label: t("message.unknownBlock"),
				payload: block.block,
				truncatedLabel: (total: number) => t("json.truncated", { total: total })
			}));
		}
	}
	return React.createElement("div", { className: "dsh-assistant-root", "data-streaming": streaming || undefined },
		React.createElement("div", { className: "dsh-assistant-body" },
			rendered,
			interrupted === true && React.createElement("span", { className: "dsh-assistant-stopped" }, t("message.stopped"))
		)
	);
}

// assistant-step 座位：只按投影结果渲染，不做任何分段/可见性判定。
//   body      正文永远渲染；正文内思维链随其前一段的展开状态显隐。
//   process   可见/预览 → 渲染内容；隐藏且无锚定栏 → 隐藏占位收掉座位
//             盒子（B17：空渲染会留下带 margin 的零高盒子）；有栏 →
//             只渲染栏（B2 ④a），座位保持可见。
//   empty-step 无可见内容也无思维链 → 恒隐藏（同隐藏占位）。
export interface AssistantNodeViewProps {
	node: ChatNode;
	t: Translate;
	renderMessageImages?: RenderMessageImages;
	useChat?: UseChat;
	// host 座位会传入本插件不读取的其余 props
	[key: string]: unknown;
}

export function AssistantNodeView(props: AssistantNodeViewProps): React.ReactElement {
	try {
		const node = props.node;
		const t = props.t;
		const proj = useProjection(props);
		const blocks = node.data?.blocks ?? [];
		// 样式写入器在每个返回分支都要挂载（display:none 不影响 effect，
		// 动态样式覆盖面不变）。
		const style = React.createElement(FoldStyleMount, { proj: proj });
		if (proj === null || !proj.active) {
			return React.createElement(React.Fragment, null,
				style,
				React.createElement(AssistantMarkdown, {
					blocks: blocks,
					streaming: node.data?.status === "running",
					interrupted: node.data?.status === "interrupted",
					renderMessageImages: props.renderMessageImages,
					t: t
				})
			);
		}
		const view = proj.views.get(node.key);
		if (view === undefined) return HiddenTurnNode();
		const anchorBars = view.role === "empty-step" ? undefined : proj.barsByAnchor.get(node.key);
		if (view.role === "body") {
			// B2 栏锚定：本正文封口的段（无步骤）→ 栏在正文上方（联动正文内
			// 思维链）；其后段的段首落座（②）→ 栏在正文下方。
			return React.createElement(React.Fragment, null,
				style,
				barElsOf(anchorBars, "before"),
				React.createElement(AssistantMarkdown, {
					blocks: blocks,
					hideReasoning: view.segKey !== null && !isSegExpanded(view.segKey),
					streaming: node.data?.status === "running",
					interrupted: node.data?.status === "interrupted",
					renderMessageImages: props.renderMessageImages,
					t: t
				}),
				barElsOf(anchorBars, "after")
			);
		}
		if (view.role === "empty-step") {
			// B17：空渲染 ≠ 隐藏——slot 容器让座位永不为 :empty，零高盒子
			// 仍吃官方 ~ 间距 margin（flex 列不塌缩），间隔随折叠步数累积。
			// 渲染隐藏标记，由静态 :has 规则收掉座位。
			return React.createElement(React.Fragment, null,
				style,
				HiddenTurnNode()
			);
		}
		if (view.state === "hidden") {
			// 隐藏过程步仍可锚定折叠栏（B2 ④a：steering 后段首步）——
			// 有栏只渲染栏（座位保持可见）；无栏同空载步收掉座位（B17）。
			if (anchorBars === undefined || anchorBars.length === 0) {
				return React.createElement(React.Fragment, null,
					style,
					HiddenTurnNode()
				);
			}
			return React.createElement(React.Fragment, null,
				style,
				barElsOf(anchorBars, "before")
			);
		}
		return React.createElement(React.Fragment, null,
			style,
			barElsOf(anchorBars, "before"),
			React.createElement(AssistantMarkdown, {
				blocks: blocks,
				streaming: node.data?.status === "running",
				interrupted: node.data?.status === "interrupted",
				renderMessageImages: props.renderMessageImages,
				t: t
			})
		);
	} catch (e) {
		return React.createElement("pre", { "data-dsh-debug-error": true }, "AssistantNodeView: " + (e instanceof Error ? e.message : String(e)) + "\n" + JSON.stringify(props.node?.data ?? null).slice(0, 300));
	}
}
