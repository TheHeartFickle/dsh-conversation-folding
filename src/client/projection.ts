// §5 视图投影（纯函数，可单测） + §6 缓存与订阅（单一事实）
import React from "react";
import { auxKeyOfNode, getAuxVersion, getSegVersion, getTranscriptMode, getTranscriptVersion, includesAux, isFoldActive, isSegExpanded, subscribeAux, subscribeSeg, subscribeTranscript } from "./state.js";
import { buildTimeline, classifyNode, hasReasoning, isChatSnapshot, type ChatNode, type Timeline } from "./model.js";

type ChatSnapshotNodes = Timeline["nodes"];

export type BarPos = "before" | "after";

export interface BarAnchor {
	key: string;
	pos: BarPos;
}

export interface FoldBar {
	segKey: string;
	toolCalls: number;
	messages: number;
	pos: BarPos;
}

export interface ProjectUI {
	active: boolean;
	auxVisible(key: string): boolean;
	isExpanded(segKey: string): boolean;
}

export type NodeViewState = "visible" | "preview" | "hidden";

export interface NodeView {
	role: "process" | "body" | "empty-step";
	segKey: string | null;
	state: NodeViewState;
}

export interface Projection {
	active: boolean;
	timeline: Timeline;
	views: Map<string, NodeView>;
	barsByAnchor: Map<string, FoldBar[]>;
	styleText: string;
}

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
//   F2 收起的闭合段：段内过程/辅助节点全部隐藏，类型是否豁免由
//      auxVisible 决定（「对话折叠」设置页按固定类型清单开关；§1）。
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
export function barAnchorOf(seg: Timeline["segByKey"][string], model: Timeline["turns"][number], nodes: ChatSnapshotNodes): BarAnchor | null {
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
	const first = nodes.get(seg.keys[0]);
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

export function projectView(timeline: Timeline, ui: ProjectUI): Projection {
	const views = new Map<string, NodeView>();
	const barsByAnchor = new Map<string, FoldBar[]>();
	const rules: string[] = [];
	if (ui.active) {
		for (const model of timeline.turns) {
			for (const seg of model.segments) {
				const expanded = ui.isExpanded(seg.segKey) === true;
				let state: NodeViewState;
				if (expanded) state = "visible";
				else if (seg.endType === "open") state = model.closed ? "hidden" : "preview";
				else state = "hidden";
				let bodyReasoning = false;
				if (seg.endType === "body") {
					bodyReasoning = seg.boundaryKey !== null && hasReasoning(timeline.nodes.get(seg.boundaryKey));
				}
				if (seg.toolCalls > 0 || seg.hasReasoning || bodyReasoning) {
					// B2 栏锚定：落座段首上方（见上方规则说明与 barAnchorOf）。
					const anchor = barAnchorOf(seg, model, timeline.nodes);
					if (anchor !== null) {
						let anchorBars = barsByAnchor.get(anchor.key);
						if (anchorBars === undefined) {
							anchorBars = [];
							barsByAnchor.set(anchor.key, anchorBars);
						}
						anchorBars.push({ segKey: seg.segKey, toolCalls: seg.toolCalls, messages: seg.messages, pos: anchor.pos });
					}
				}
				for (const key of seg.keys) {
					let keyState = state;
					if (keyState === "preview" && key !== seg.latestKey) keyState = "hidden";
					const node = timeline.nodes.get(key);
					if (node && classifyNode(node) === "empty-step") {
						// 空载步（无可见内容也无思维链）恒隐藏。
						views.set(key, { role: "empty-step", segKey: seg.segKey, state: "hidden" });
						continue;
					}
					// think 不折叠：仅推理过程步在收起段内保持显示（React 侧，
					// assistant-step 座位由插件渲染）。
					const auxKey = node ? auxKeyOfNode(node) : undefined;
					if (keyState === "hidden" && auxKey === "think" && ui.auxVisible("think")) {
						keyState = "visible";
					}
					views.set(key, { role: "process", segKey: seg.segKey, state: keyState });
					if (keyState === "hidden" && node && (node.kind === "tool-call" || node.kind === "context" || node.kind === "system-prompt")) {
						// assistant-step 座位由插件渲染，走 React 隐藏；CSS 只管官方渲染的 kind。
						// 豁免键由匹配表（§1 AUX_TYPES）查出，设置页按类型开关。
						if (auxKey !== undefined && ui.auxVisible(auxKey)) continue;
						// 选择器优先级必须不低于静态 unhide 规则，靠动态样式后插入取胜。
						rules.push(':root[data-dsh-fold-mode=all] [data-chat-flow-key][data-chat-anchor-key="' + key + '"][data-chat-flow-kind]{display:none!important}');
					}
				}
			}
		}
	}
	// 正文视图：正文键恒可见（F1），带上其前一段 segKey 供正文内思维链联动
	//（前段不存在时为 null，思维链不受任何栏联动）。
	for (const turnKey in timeline.turnByKey) {
		for (const bodyKey of timeline.turnByKey[turnKey].bodies) {
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
const timelineCache = new WeakMap<object, Timeline>();

export function getTimeline(chat: unknown): Timeline | undefined {
	if (!isChatSnapshot(chat)) return undefined;
	let cached = timelineCache.get(chat);
	if (cached === undefined) {
		cached = buildTimeline(chat.order, chat.nodes);
		timelineCache.set(chat, cached);
	}
	return cached;
}

const projectionCache = new WeakMap<object, CachedProjection>();

interface CachedProjection {
	segVersion: number;
	configVersion: number;
	transcript: string;
	active: boolean;
	projection: Projection;
}

// 补点行为在 React 之外读取模型（S2 停止条件，见 autoload.ts），这里保持
// 最新投影引用。
let latestProjection: Projection | null = null;

export function getLatestProjection(): Projection | null {
	return latestProjection;
}

export function getProjection(chat: unknown): Projection | null {
	const timeline = getTimeline(chat);
	if (timeline === undefined) return null;
	const active = isFoldActive();
	const cached = isChatSnapshot(chat) ? projectionCache.get(chat) : undefined;
	if (cached !== undefined && cached.segVersion === getSegVersion() &&
		cached.configVersion === getAuxVersion() && cached.transcript === getTranscriptMode() &&
		cached.active === active) {
		return cached.projection;
	}
	const projection = projectView(timeline, {
		active: active,
		auxVisible: includesAux,
		isExpanded: isSegExpanded
	});
	if (isChatSnapshot(chat)) {
		projectionCache.set(chat, {
			segVersion: getSegVersion(),
			configVersion: getAuxVersion(),
			transcript: getTranscriptMode(),
			active: active,
			projection: projection
		});
	}
	latestProjection = projection;
	return projection;
}

// DSH 0.1.2 起 SessionSnapshot 不再携带 chat：对话数据在 useChat 的
// ChatSnapshot 里（order + nodes store，nodes.get(key) 兼容旧 Map 读法）。
export type UseChat = (selector: (state: unknown) => unknown) => unknown;

export function chatOf(props: { useChat?: UseChat }): unknown {
	const useChat = props.useChat;
	if (typeof useChat !== "function") return undefined;
	return useChat((state) => state);
}

export function useProjection(props: { useChat?: UseChat }): Projection | null {
	React.useSyncExternalStore(subscribeAux, getAuxVersion);
	React.useSyncExternalStore(subscribeSeg, getSegVersion);
	React.useSyncExternalStore(subscribeTranscript, getTranscriptVersion);
	return getProjection(chatOf(props));
}
