// §7 样式写入器（单写者，幂等） + §8 视图（思维链之外的全部座位组件）
import React from "react";
import { MarkdownText, JsonBlock, IconChevronDownOutline14 } from "@deepseek-ai/dsh-client-ui-primitives";
import { isSegExpanded, setSegExpanded } from "./state.js";
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
// 规则文本是投影的纯函数；任何座位挂载 useFoldStyle 都写同一文本，
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

// 座位统一样式挂载点：座位组件在顶部各调一次（幂等，写的是同一投影文本），
// 保证纯过程轮（无 assistant-step 座位）也写入动态样式。
export function useFoldStyle(proj: Projection | null): void {
	React.useEffect(() => {
		applyFoldStyle(proj && proj.active ? proj.styleText : "");
	});
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

// 折叠按钮：官方 turn-process 控件样式的复刻，插件折叠栏与官方兜底栏
// 共用外壳（segKey 仅插件栏携带，供「加载更早」补点按 data-seg-key 读取）。
function FoldButton(props: { label: string; open: boolean; variant: string; segKey?: string; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void }): React.ReactElement {
	return React.createElement("button", {
		type: "button",
		className: "dsh-turnfold dsh-turnfold-" + props.variant,
		"data-open": props.open || undefined,
		"data-seg-key": props.segKey,
		"aria-expanded": props.open,
		onClick: props.onClick
	}, React.createElement("span", { className: "dsh-turnfold-label" }, props.label),
		React.createElement(IconChevronDownOutline14, { className: "dsh-turnfold-chevron" }));
}

// 折叠栏（一段一栏）。文案为官方 turn-process 格式。pos 标记落位
// （before=锚点内容上方 / after=下方），供座位内间距样式使用。
// 展开状态由父座位经 useProjection 订阅段展开 store，此处直接读即可。
function ProcessFold(props: FoldBar): React.ReactElement {
	const expanded = isSegExpanded(props.segKey);
	const labels: string[] = [];
	if (props.toolCalls > 0) labels.push(props.toolCalls + " 个工具调用");
	if (props.messages > 0) labels.push(props.messages + " 条消息");
	return React.createElement(FoldButton, {
		label: labels.length > 0 ? labels.join(" · ") : "思考了一会儿",
		open: expanded,
		variant: "process",
		segKey: props.segKey,
		onClick: () => setSegExpanded(props.segKey, !expanded)
	});
}

const barEl = (bar: FoldBar): React.ReactElement => React.createElement(ProcessFold, { ...bar, key: bar.segKey });

function barElsOf(bars: FoldBar[] | undefined, pos: BarPos): React.ReactElement[] {
	return (bars ?? []).filter((bar) => bar.pos === pos).map(barEl);
}

// 官方 turn-process 控件的复刻（非 fold 显示模式下原样呈现）。
interface TurnProcessControl {
	foldable: boolean;
	open: boolean;
	setOpen(open: boolean): void;
}

function OfficialTurnProcessView(props: { node: ChatNode; t: Translate; turnProcess?: TurnProcessControl | null }): React.ReactElement | null {
	const { node, t } = props;
	const turnProcess = props.turnProcess;
	if (!turnProcess || !turnProcess.foldable) return null;
	const data = node.data ?? {};
	const counts: [number | undefined, string][] = [
		[data.toolCallCount, "toolCalls"],
		[data.messageCount, "messages"],
		[data.subagentCount, "subagents"]
	];
	const labels: string[] = [];
	for (const [count, kind] of counts) {
		if ((count ?? 0) > 0) labels.push(t("message.turnProcess." + kind + "." + ((count ?? 0) === 1 ? "one" : "other"), { count }));
	}
	return React.createElement(FoldButton, {
		label: labels.length === 0 ? t("message.turnProcess.thoughtForAWhile") : labels.join(t("message.turnProcess.separator")),
		open: turnProcess.open,
		variant: "official",
		onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
			event.currentTarget.focus();
			turnProcess.setOpen(!turnProcess.open);
		}
	});
}

// turn-process 座位：只承载兜底栏（B2 ③：轮首段，锚点=本节点）。其余栏
// 都落座在段首附近的插件座位（正文或过程步的 assistant-step 座位，B15：
// 不得把一轮的栏集中堆在轮顶）。
export interface TurnProcessFoldViewProps extends SeatProps {
	turnProcess?: TurnProcessControl | null;
}

export function TurnProcessFoldView(props: TurnProcessFoldViewProps): React.ReactElement | null {
	const proj = useProjection(props);
	useFoldStyle(proj);
	if (proj === null) return HiddenTurnNode();
	if (!proj.active) return OfficialTurnProcessView(props);
	const bars = props.node ? proj.barsByAnchor.get(props.node.key) : undefined;
	if (!bars || bars.length === 0) return HiddenTurnNode();
	return React.createElement(React.Fragment, null, bars.map(barEl));
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

function AssistantMarkdown({ blocks, streaming, interrupted, renderMessageImages, hideReasoning, t }: AssistantMarkdownProps): React.ReactElement | null {
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

// 座位 props 基座（host 会传入本插件不读取的其余 props，索引签名收口）。
interface SeatProps {
	node: ChatNode;
	t: Translate;
	useChat?: UseChat;
	[key: string]: unknown;
}

// assistant-step 座位：只按投影结果渲染，不做任何分段/可见性判定。
//   body      正文永远渲染；正文内思维链随其前一段的展开状态显隐。
//   process   可见/预览 → 渲染内容；隐藏且无锚定栏 → 隐藏占位收掉座位
//             盒子（B17：空渲染会留下带 margin 的零高盒子）；有栏 →
//             只渲染栏（B2 ④a），座位保持可见。
//   empty-step 无可见内容也无思维链 → 恒隐藏（同隐藏占位）。
export interface AssistantNodeViewProps extends SeatProps {
	renderMessageImages?: RenderMessageImages;
}

export function AssistantNodeView(props: AssistantNodeViewProps): React.ReactElement {
	try {
		const { node, t, renderMessageImages } = props;
		const proj = useProjection(props);
		useFoldStyle(proj);
		const blocks = node.data?.blocks ?? [];
		// 三个分支共用的正文渲染（仅 body 分支传 hideReasoning 联动前段）。
		const markdown = (hideReasoning?: boolean) => React.createElement(AssistantMarkdown, {
			blocks: blocks,
			streaming: node.data?.status === "running",
			interrupted: node.data?.status === "interrupted",
			renderMessageImages: renderMessageImages,
			hideReasoning: hideReasoning,
			t: t
		});
		if (proj === null || !proj.active) {
			return markdown();
		}
		const view = proj.views.get(node.key);
		if (view === undefined) return HiddenTurnNode();
		const anchorBars = proj.barsByAnchor.get(node.key);
		if (view.role === "body") {
			// B2 栏锚定：本正文封口的段（无步骤）→ 栏在正文上方（联动正文内
			// 思维链）；其后段的段首落座（②）→ 栏在正文下方。
			return React.createElement(React.Fragment, null,
				barElsOf(anchorBars, "before"),
				markdown(view.segKey !== null && !isSegExpanded(view.segKey)),
				barElsOf(anchorBars, "after")
			);
		}
		if (view.role === "empty-step") {
			// B17：空渲染 ≠ 隐藏——slot 容器让座位永不为 :empty，零高盒子
			// 仍吃官方 ~ 间距 margin（flex 列不塌缩），间隔随折叠步数累积。
			// 渲染隐藏标记，由静态 :has 规则收掉座位。
			return HiddenTurnNode();
		}
		if (!view.visible) {
			// 隐藏过程步仍可锚定折叠栏（B2 ④a：steering 后段首步）——
			// 有栏只渲染栏（座位保持可见）；无栏同空载步收掉座位（B17）。
			if (anchorBars === undefined || anchorBars.length === 0) {
				return HiddenTurnNode();
			}
			return React.createElement(React.Fragment, null, barElsOf(anchorBars, "before"));
		}
		return React.createElement(React.Fragment, null,
			barElsOf(anchorBars, "before"),
			markdown()
		);
	} catch (e) {
		return React.createElement("pre", { "data-dsh-debug-error": true }, "AssistantNodeView: " + (e instanceof Error ? e.message : String(e)) + "\n" + JSON.stringify(props.node?.data ?? null).slice(0, 300));
	}
}
