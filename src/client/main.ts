// dsh-conversation-folding — client bundle 入口（dsh.plugin.json client.main）。
//
// §0 架构范式：对话视口 = 轨迹的可视化 + 信息过滤（SPEC.md §0）
//
//   轨迹    chat.order 自上而下即时间顺序，是唯一事实；模型绝不重排节点、
//           绝不把信息移过边界（user / steering / 正文）。因此 Ctrl+Enter
//           插入（steering 边界，逻辑上开启新一轮对话）必然开启新折叠栏：
//           若把其后步骤合入之前的栏，视口顺序就会与轨迹顺序错位。
//   可视化  正文节点永远在轨迹原位完整可见。
//   过滤    折叠 = 把「段」的过程信息从视口滤除，并在轨迹原位保留折叠栏入口。
//
// 分层（src/client/ 各文件）：
//   model.ts       轨迹模型  纯函数 order+nodes → 轮/段结构；一切边界条件
//                  （中止轮、steering、流式尾段）都是模型里的分类规则，
//                  不是视图补丁。
//   projection.ts  视图投影  纯函数 模型+UI状态 → 每个节点键的唯一可见状态
//                  + 折叠栏列表 + 动态样式文本；同输入必同输出。
//   state.ts       配置与三个响应式 store（豁免表 / 显示模式 / 段展开）。
//   views.ts / think-box.ts / settings-ui.ts  生效层 React 薄壳：所有座位
//                  共享同一份缓存的投影（单一事实），单一样式写入器；
//                  杜绝「栏与内容各自判定」。
//   autoload.ts    「加载更早」补点行为。
import React from "react";
import { CSS } from "./styles.js";
import { isFoldActive, loadConfig, syncFoldModeAttr } from "./state.js";
import { AssistantNodeView, TurnProcessFoldView } from "./views.js";
import { FoldingSettingsSection, TranscriptViewRowFold } from "./settings-ui.js";
import { autoLoadEffect } from "./autoload.js";
import { AUX_TYPES, DEFAULT_AUX_VISIBLE, auxKeyOfNode, getAuxVisible, getTranscriptMode, setAuxVisible, toggleAux } from "./state.js";
import { buildTimeline, classifyNode } from "./model.js";
import { getProjection, projectView } from "./projection.js";

// 宿主 slots 服务（client 端注入契约的最小读取面）。
interface SlotRegistry {
	inject(slot: string, factory: () => unknown): void;
	// props 形状由各座位 props 接口约定；宿主侧不做类型检查，此处 any 收口。
	register(meta: Record<string, unknown>, component: (props: any) => unknown): unknown;
}

interface ClientContext {
	get(name: string): unknown;
	effect(fn: () => void | (() => void)): void;
}

export const inject = ["slots"];

export function apply(ctx: ClientContext): void {
	const slots = ctx.get("slots") as SlotRegistry | undefined;
	if (slots === undefined) return;

	loadConfig();

	// 座位注册收口：inject + register 同构；组件必须经 createElement 包装
	//（hooks 语义要求，register 的 component 会被宿主当普通函数调用）。
	const registry = slots;
	function registerSeat(slot: string, meta: Record<string, unknown>, view: (props: any) => React.ReactNode): void {
		registry.inject(slot, () => registry.register({ name: slot, ...meta }, (props: any) => React.createElement(view, props)));
	}

	ctx.effect(() => {
		if (typeof document === "undefined") return;
		const tagId = "dsh-conversation-folding/styles";
		const existing = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]");
		if (existing !== null) return;
		const tag = document.createElement("style");
		tag.dataset.plugin = "dsh-conversation-folding";
		tag.dataset.pluginCss = tagId;
		tag.textContent = CSS;
		document.head.appendChild(tag);
		return () => { tag.remove(); };
	});

	// 影子官方“对话显示”设置行，新增第三项「Fold」；官方 normal/compact 保持原样。
	registerSeat("settings.general.item", { id: "transcript-view", order: 12, priority: -1, locale: "chat" }, TranscriptViewRowFold);

	// 独立设置标签页「对话折叠」（settings.section：与 通用设置 / 模型 /
	// 插件 同级，每项注册 = 导航栏一页）。order 100 追加在原生页之后。
	registerSeat("settings.section", { id: "conversation-folding", order: 100, label: () => "对话折叠" }, FoldingSettingsSection);

	// 影子 assistant-step 与 turn-process（0.1.2 slots 选举制：同 key 必须显式
	// 更低 priority，低者渲染，见 BUGS.md B3）。tool-call / context 交给官方
	// 渲染，显隐由投影生成的动态 CSS 控制（projection.ts F2/F3/F4）。
	registerSeat("conversation.chat.node", { key: "assistant-step", locale: "conversation", priority: -1 }, AssistantNodeView);
	registerSeat("conversation.chat.node", { key: "turn-process", locale: "conversation", priority: -1 }, TurnProcessFoldView);

	// 「加载更早」一次点击补点（autoload.ts）。
	ctx.effect(autoLoadEffect);

	syncFoldModeAttr(isFoldActive());
}

// 测试缝（供 Node 单测加载真实 bundle 后驱动纯模型/投影；生产零依赖）。
// getProjection/autoLoadEffect 是补点行为的观测面：Node 侧用 DOM 桩驱动
// autoload.ts 的补点循环（浏览器 lane 的 fixture 一页即补完被监视段，
// 只能观测 0/1 次点击，覆盖不到循环内部 —— 见 test/autoload.test.mjs）。
export const __test = {
	classifyNode: classifyNode,
	buildTimeline: buildTimeline,
	projectView: projectView,
	getProjection: getProjection,
	autoLoadEffect: autoLoadEffect,
	auxKeyOfNode: auxKeyOfNode,
	auxTypes: AUX_TYPES,
	defaultAuxVisible: DEFAULT_AUX_VISIBLE,
	getAuxVisible: getAuxVisible,
	setAuxVisible: setAuxVisible,
	toggleAux: toggleAux,
	getTranscriptMode: getTranscriptMode
};
