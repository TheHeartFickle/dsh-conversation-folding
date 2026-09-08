// 设置界面：官方「对话显示」行的影子（新增 fold 项） + 独立「对话折叠」
// 设置标签页（settings.section）。
import React from "react";
import { Menu, IconChevronDownOutline14 } from "@deepseek-ai/dsh-client-ui-primitives";
import { AUX_TYPES, getAuxVersion, getTranscriptMode, getTranscriptVersion, includesAux, persistConfig, setTranscriptMode, subscribeAux, subscribeTranscript, toggleAux } from "./state.js";
import type { Translate } from "./views.js";

// 官方设置行的“折叠”模式下拉（影子自带 transcript-view）。
// 各步骤类型「是否折叠」的配置在独立标签页「对话折叠」（settings.section）。
export interface TranscriptViewRowFoldProps {
	setTranscriptView?: (mode: string) => void;
	t?: Translate;
}

export function TranscriptViewRowFold(props: TranscriptViewRowFoldProps): React.ReactElement {
	React.useSyncExternalStore(subscribeTranscript, getTranscriptVersion);
	const setTranscriptView = props.setTranscriptView;
	const t = props.t;
	const mode = getTranscriptMode();
	const openState = React.useState(false);
	const open = openState[0];
	const setOpen = openState[1];
	function labelOf(key: string, fallback: string): string {
		const value = t ? t(key) : null;
		return value && value !== key ? value : fallback;
	}
	const options = [
		{ id: "normal", label: labelOf("settings.transcript.normal", "正常") },
		{ id: "compact", label: labelOf("settings.transcript.compact", "紧凑") },
		{ id: "fold", label: "Fold" }
	];
	let selected = options[0];
	for (const option of options) {
		if (option.id === mode) { selected = option; break; }
	}
	function closeMenu(): void { setOpen(false); }
	function selectMode(id: string): void {
		// normal/compact 保持官方原样：同步给官方；fold 只启用本插件，不改官方对话显示。
		if (id !== "fold" && setTranscriptView) setTranscriptView(id);
		const changed = id !== getTranscriptMode();
		setTranscriptMode(id);
		if (changed) persistConfig({ displayMode: id });
		// 聊天视图对模式切换的响应式订阅在部分组件上没有即时重渲染，
		// 选择模式后重载一次以保证生效（设置值已持久化）。
		if (changed) setTimeout(() => { if (typeof location !== "undefined") location.reload(); }, 50);
	}
	const selector = React.createElement("button", {
		type: "button",
		className: "dsh-tv-selector",
		"aria-haspopup": "menu",
		"aria-expanded": open,
		onClick: () => setOpen((value) => !value)
	}, selected.label, React.createElement(IconChevronDownOutline14, { className: "dsh-tv-chevron" }));
	return React.createElement("div", { className: "dsh-tv-row" },
		React.createElement("div", { className: "dsh-tv-rowText" },
			React.createElement("div", { className: "dsh-tv-title" }, labelOf("settings.transcript.title", "对话显示")),
			React.createElement("div", { className: "dsh-tv-desc" }, labelOf("settings.transcript.description", "完成后对话的展示方式；「Fold」由 dsh-conversation-folding 接管"))
		),
		React.createElement(Menu, {
			open: open,
			onClose: closeMenu,
			items: options.map((option) => {
				return { id: option.id, label: option.label };
			}),
			selectedId: mode,
			onSelect: (id: string) => { closeMenu(); selectMode(id); },
			align: "end",
			portal: true,
			anchor: selector
		})
	);
}

// 「对话折叠」设置页（settings.section：与 通用设置 / 模型 / 插件 同级的
// 独立标签页）。每行一个固定步骤类型（AUX_TYPES 匹配表）的「是否折叠」开关：
// 开 = 折叠进折叠栏（收起时隐藏），关 = 始终显示。文案全部自备——settings
// 契约里 section 的所有文本都由注册方提供（owner 只传 close）。
export function FoldingSettingsSection(): React.ReactElement {
	React.useSyncExternalStore(subscribeAux, getAuxVersion);
	const rows = AUX_TYPES.map((type) => {
		const folded = !includesAux(type.key);
		return React.createElement("div", { className: "dsh-fs-row", key: type.key },
			React.createElement("div", { className: "dsh-fs-rowText" },
				React.createElement("div", { className: "dsh-fs-title" }, type.label),
				React.createElement("div", { className: "dsh-fs-desc" }, folded ? "已折叠：收起时隐藏，展开折叠栏可见" : "不折叠：始终显示")
			),
			React.createElement("button", {
				type: "button",
				className: "dsh-fs-switch",
				role: "switch",
				"aria-checked": folded,
				"aria-label": (folded ? "折叠 " : "不折叠 ") + type.label,
				"data-on": folded || undefined,
				onClick: () => toggleAux(type.key)
			}, React.createElement("span", { className: "dsh-fs-knob" }))
		);
	});
	return React.createElement("div", { className: "dsh-fs-page" },
		React.createElement("div", { className: "dsh-fs-head" },
			React.createElement("div", { className: "dsh-fs-title" }, "折叠的步骤类型"),
			React.createElement("div", { className: "dsh-fs-desc" }, "开启 = 该类型折叠进折叠栏；关闭 = 始终显示。未列出的工具类型始终折叠。仅在「对话显示 = 折叠」模式下生效。")
		),
		rows
	);
}
