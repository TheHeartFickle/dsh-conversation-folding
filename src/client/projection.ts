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

export interface NodeView {
	role: "process" | "body" | "empty-step";
	segKey: string | null;
	visible: boolean;
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
//   views      Map 节点key → { role, segKey, visible }
//              visible=false 为隐藏；流式开放段的预览键（F4）同为 visible。
//   barsByAnchor Map 锚点节点key → [{ segKey, toolCalls, messages, pos }]
//              pos="before" 栏在锚点内容上方；pos="after" 在下方。
//   styleText  动态隐藏 CSS（tool-call / context 由官方渲染，只能用 CSS 过滤；
//              assistant-step 座位由本插件渲染，走 React 分支）
// 过滤规则（F，全部显式列出）：
//   F1 正文永不隐藏（正文键不进入 views 的隐藏态）。
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
function bodyAnchor(seg: Timeline["segByKey"][string]): BarAnchor | null {
	// 思考正文段（无步骤）的兜底锚点：正文、正文上方（联动正文内思维链）。
	// endType=body 时 segKey 即封口正文键（见 model.ts Segment 注释）。
	return seg.endType === "body" ? { key: seg.segKey, pos: "before" } : null;
}

export function barAnchorOf(seg: Timeline["segByKey"][string], model: Timeline["turns"][number], nodes: ChatSnapshotNodes): BarAnchor | null {
	// ① 无步骤的思考正文段：锚点=该正文、正文上方（联动正文内思维链）。
	if (seg.keys.length === 0) return bodyAnchor(seg);
	// ② 段直接跟在正文后：锚点=该正文、正文下方（= 段首上方）。
	if (seg.startCtx === "body" && seg.prevBody) {
		return { key: seg.prevBody, pos: "after" };
	}
	// ③ 轮首段（段前是 user 边界）：锚点=轮 turn-process（缺节点按回退链）。
	if (seg.startCtx !== "steering") {
		if (model.processKey !== undefined) return { key: model.processKey, pos: "before" };
		if (seg.prevBody) return { key: seg.prevBody, pos: "after" };
		return bodyAnchor(seg);
	}
	// ④ 段跟在 steering 后（已知妥协：官方 steering 座位不可注入）：
	//    段首步是插件渲染的过程步 → 落座该步内、其内容上方；
	//    段首步是官方渲染（tool-call/context）→ 闭合段落座封口正文上方
	//    （收起仍紧贴其后正文），开放段落座 prevBody 下方。
	const first = nodes.get(seg.keys[0]);
	if (first && first.kind === "assistant-step") {
		return { key: seg.keys[0], pos: "before" };
	}
	const anchor = bodyAnchor(seg);
	if (anchor !== null) return anchor;
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
				const expanded = ui.isExpanded(seg.segKey);
				// B1：正文段且正文带思维链也必有栏（展开可看正文内思维链）。
				const bodyReasoning = seg.endType === "body" && hasReasoning(timeline.nodes.get(seg.segKey));
				if (seg.toolCalls > 0 || seg.hasReasoning || bodyReasoning) {
					// B2 栏锚定：落座段首上方（见上方规则说明与 barAnchorOf）。
					const anchor = barAnchorOf(seg, model, timeline.nodes);
					if (anchor !== null) {
						const anchorBars = barsByAnchor.get(anchor.key) ?? [];
						anchorBars.push({ segKey: seg.segKey, toolCalls: seg.toolCalls, messages: seg.endType === "body" ? 1 : 0, pos: anchor.pos });
						barsByAnchor.set(anchor.key, anchorBars);
					}
				}
				for (const key of seg.keys) {
					// F3/F4/F5：展开 → 全可见；收起的流式开放段仅最近一条过程
					// 保留预览；其余（闭合段 / 中止轮尾段）全隐藏。
					let visible = expanded || (seg.endType === "open" && !model.closed && key === seg.latestKey);
					const node = timeline.nodes.get(key);
					if (node && classifyNode(node) === "empty-step") {
						// 空载步（无可见内容也无思维链）恒隐藏。
						views.set(key, { role: "empty-step", segKey: seg.segKey, visible: false });
						continue;
					}
					// think 不折叠：仅推理过程步在收起段内保持显示（React 侧，
					// assistant-step 座位由插件渲染）。
					const auxKey = auxKeyOfNode(node);
					if (!visible && auxKey === "think" && ui.auxVisible("think")) {
						visible = true;
					}
					views.set(key, { role: "process", segKey: seg.segKey, visible });
					if (!visible && node && (node.kind === "tool-call" || node.kind === "context" || node.kind === "system-prompt")) {
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
	for (const model of timeline.turns) {
		for (const bodyKey of model.bodies) {
			views.set(bodyKey, { role: "body", segKey: timeline.bodySeg[bodyKey] ?? null, visible: true });
		}
	}
	return {
		active: ui.active,
		timeline: timeline,
		views: views,
		barsByAnchor: barsByAnchor,
		styleText: rules.join("")
	};
}

// ---------- §6 缓存与订阅（单一事实） ----------
// 快照 → { timeline, 投影及其生效时的三个 store 版本 }，单表两级失效：
// timeline 只随快照对象身份变化（同一次发布的快照只推导一次，所有座位
// 在同一次 commit 中读到同一个 Timeline / Projection，I2）；projection 在
// 段展开 / 豁免表 / 显示模式任一版本变化时基于同一 timeline 重建。
interface CacheEntry {
	timeline: Timeline;
	segVersion: number;
	configVersion: number;
	transcript: string;
	projection: Projection;
}

const cache = new WeakMap<object, CacheEntry>();

// 补点行为在 React 之外读取模型（S2 停止条件，见 autoload.ts），这里保持
// 最新投影引用。
let latestProjection: Projection | null = null;

export function getLatestProjection(): Projection | null {
	return latestProjection;
}

export function getProjection(chat: unknown): Projection | null {
	if (!isChatSnapshot(chat)) return null;
	const active = isFoldActive();
	const segVersion = getSegVersion();
	const configVersion = getAuxVersion();
	const transcript = getTranscriptMode();
	const cached = cache.get(chat);
	if (cached !== undefined && cached.segVersion === segVersion &&
		cached.configVersion === configVersion && cached.transcript === transcript) {
		return cached.projection;
	}
	const timeline = cached !== undefined ? cached.timeline : buildTimeline(chat.order, chat.nodes);
	const projection = projectView(timeline, { active, auxVisible: includesAux, isExpanded: isSegExpanded });
	cache.set(chat, { timeline, segVersion, configVersion, transcript, projection });
	latestProjection = projection;
	return projection;
}

// DSH 0.1.2 起 SessionSnapshot 不再携带 chat：对话数据在 useChat 的
// ChatSnapshot 里（order + nodes store，nodes.get(key) 兼容旧 Map 读法）。
export type UseChat = (selector: (state: unknown) => unknown) => unknown;

export function useProjection(props: { useChat?: UseChat }): Projection | null {
	React.useSyncExternalStore(subscribeAux, getAuxVersion);
	React.useSyncExternalStore(subscribeSeg, getSegVersion);
	React.useSyncExternalStore(subscribeTranscript, getTranscriptVersion);
	const useChat = props.useChat;
	return getProjection(typeof useChat === "function" ? useChat((state) => state) : undefined);
}
