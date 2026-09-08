// ---------- 思维链：默认展开 + 可滚动子框（§8 视图组件之一） ----------
import React from "react";
import { DisclosureRow, IconThinkOutline14 } from "@deepseek-ai/dsh-client-ui-primitives";

function firstLine(text: string): string {
	const newline = text.indexOf("\n");
	return newline === -1 ? text : text.slice(0, newline);
}

function latestLine(text: string): string {
	const visible = text.trimEnd();
	const newline = visible.lastIndexOf("\n");
	return newline === -1 ? visible : visible.slice(newline + 1);
}

// 会话滚动容器：优先用稳定的 [data-chat-flow] 锚点向上找可滚动祖先，
// 兜底旧的散列类名（官方重排后散列会变）。
function findChatScroller(): HTMLElement | null {
	if (typeof document === "undefined") return null;
	let el = document.querySelector<HTMLElement>("[data-chat-flow]");
	while (el && el !== document.body) {
		const overflow = typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(el).overflowY : "";
		if (overflow === "auto" || overflow === "scroll") return el;
		el = el.parentElement;
	}
	return document.querySelector<HTMLElement>(".wSkVaW_scrollBody");
}

// 联动：新的 running 思维链出现时，只折叠紧邻的前一个（更早的手动展开状态不动）。
let runningThink: { id: string; collapse: () => void } | null = null;

export interface ThinkBoxProps {
	text: string;
	running?: boolean;
	open?: boolean;
}

export function ThinkBox(props: ThinkBoxProps): React.ReactElement {
	const text = props.text;
	const running = props.running;
	const [open, setOpen] = React.useState(props.running === true || props.open === true);
	const myId = React.useId();
	React.useEffect(() => {
		if (!running) return;
		setOpen(true);
		if (runningThink !== null && runningThink.id !== myId) {
			runningThink.collapse();
		}
		runningThink = { id: myId, collapse: () => setOpen(false) };
	}, [running, myId]);
	React.useEffect(() => {
		return () => {
			if (runningThink !== null && runningThink.id === myId) {
				runningThink = null;
			}
		};
	}, [myId]);
	const bodyRef = React.useRef<HTMLDivElement | null>(null);
	const atBottomRef = React.useRef(true);
	const scrollRafRef = React.useRef<number | null>(null);
	// 展开时重置"在底部"标记（React 默认 scrollTop=0 不是用户主动滚上去）
	React.useLayoutEffect(() => {
		if (open) atBottomRef.current = true;
	}, [open]);
	// 生成中自动跟随底部：只有用户仍在底部附近才往下滚。
	// 用 requestAnimationFrame 合并同一帧内的多次滚动，降低高频 token 更新时的卡顿。
	React.useLayoutEffect(() => {
		if (!(running && open && bodyRef.current !== null && atBottomRef.current)) return;
		const el = bodyRef.current;
		if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
		scrollRafRef.current = requestAnimationFrame(() => {
			scrollRafRef.current = null;
			el.scrollTop = el.scrollHeight;
		});
		return () => {
			if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
		};
	}, [text, running, open]);
	// 首次出现思维链时，若会话视口原本就在底部，保持贴底；否则会停在旧位置，
	// 需要手动滚动一次才能恢复自动跟随。
	React.useLayoutEffect(() => {
		if (!(running && open)) return;
		const scroller = findChatScroller();
		if (scroller === null) return;
		const nearBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 80;
		if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
	}, [running, open, text]);
	// 监听用户滚动，维护"是否在底部附近"
	// 阈值（64px）比内容高度跳变略大，避免 token 生成过快时一帧内底部被
	// 甩开，导致自动跟随失效。
	React.useEffect(() => {
		if (!open) return;
		const el = bodyRef.current;
		if (el === null) return;
		const onScroll = () => {
			atBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 64;
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, [open]);
	const summary = running ? latestLine(text) : firstLine(text);
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
		onToggle: () => setOpen((value) => !value),
		collapsedContent: React.createElement(React.Fragment, null,
			React.createElement("span", { className: "dsh-think-separator", "aria-hidden": true }),
			React.createElement("span", { className: "dsh-think-summary" }, summary)
		),
		children: React.createElement("div", { className: "dsh-think-body", ref: bodyRef }, text)
	}));
}
