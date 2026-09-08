// ---------- §9 行为：补点加载历史 ----------
// 官方「加载更早」每次只 prepend 50 条事件；折叠场景下这 50 条可能全是
// 隐藏节点，点一次看不到任何变化。捕获用户的真实点击后由这里持续补点，
// 但只补到“被监视的最旧折叠栏已完整”为止，不把全部历史都拉进来（SPEC §3）。
// 停止条件（S）：
//   S1 被监视段不再是 DOM 第一个折叠栏 —— 它前面的段/轮已加载出来；
//   S2 被监视段步骤数不再增长（读投影模型，不再解析栏内文本）。
import { getLatestProjection } from "./projection.js";

interface AutoLoadState {
	active: boolean;
	clicks: number;
	btn: HTMLButtonElement | null;
	watchSeg: string | null;
	watchCount: number;
}

const autoLoad: AutoLoadState = { active: false, clicks: 0, btn: null, watchSeg: null, watchCount: -1 };
let autoLoadTimer: ReturnType<typeof setTimeout> | null = null;
const AUTOLOAD_LIMIT = 500;
const AUTOLOAD_TICK_MS = 120;

function findLoadOlderBtn(): HTMLButtonElement | null {
	if (typeof document === "undefined") return null;
	const buttons = document.querySelectorAll<HTMLButtonElement>("button");
	for (const button of buttons) {
		const text = (button.textContent || "").trim();
		if (text === "加载更早" || text === "Load earlier") return button;
	}
	return null;
}

function findLoadingOlderBtn(): HTMLButtonElement | null {
	if (typeof document === "undefined") return null;
	const buttons = document.querySelectorAll<HTMLButtonElement>("button");
	for (const button of buttons) {
		if (!button.disabled) continue;
		const text = (button.textContent || "").trim();
		if (text === "加载中…" || text === "Loading…" || text === "Loading...") return button;
	}
	return null;
}

function scheduleAutoLoad(): void {
	if (!autoLoad.active) return;
	if (autoLoadTimer !== null) clearTimeout(autoLoadTimer);
	autoLoadTimer = setTimeout(() => {
		autoLoadTimer = null;
		autoLoadOlderTick();
	}, AUTOLOAD_TICK_MS);
}

function stopAutoLoad(): void {
	autoLoad.active = false;
	if (autoLoadTimer !== null) {
		clearTimeout(autoLoadTimer);
		autoLoadTimer = null;
	}
}

function watchedFoldCount(): number {
	if (autoLoad.watchSeg === null) return -1;
	const proj = getLatestProjection();
	if (proj === null) return -1;
	const seg = proj.timeline.segByKey[autoLoad.watchSeg];
	return seg ? seg.steps : -1;
}

function autoLoadOlderTick(): void {
	if (!autoLoad.active || typeof document === "undefined") return;
	let btn = autoLoad.btn;
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
		const current = watchedFoldCount();
		const firstBar = document.querySelector(".dsh-turnfold[data-seg-key]");
		const progressed = autoLoad.clicks > 0 || current !== autoLoad.watchCount;
		if (progressed) {
			const gainedNewBar = !firstBar || firstBar.getAttribute("data-seg-key") !== autoLoad.watchSeg;
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

// 捕获「加载更早」真实点击并激活补点开关，之后由 setTimeout 驱动
// autoLoadOlderTick 持续补点，直到 S1/S2 停止条件满足。
export function autoLoadEffect(): (() => void) | undefined {
	if (typeof document === "undefined") return;
	function onClick(event: MouseEvent): void {
		const target = event.target;
		if (!target || typeof (target as HTMLElement).closest !== "function") return;
		const btn = (target as HTMLElement).closest("button");
		if (!btn || btn.disabled) return;
		const text = (btn.textContent || "").trim();
		if (text !== "加载更早" && text !== "Load earlier") return;
		if (autoLoad.active) return;
		autoLoad.active = true;
		autoLoad.clicks = 0;
		autoLoad.btn = btn;
		// 记录点击时最旧的折叠栏（segKey 稳定，跨翻页不漂移），用它判断
		// “步骤是否已全部加载”。
		const firstBar = document.querySelector(".dsh-turnfold[data-seg-key]");
		autoLoad.watchSeg = firstBar ? firstBar.getAttribute("data-seg-key") : null;
		const proj = getLatestProjection();
		autoLoad.watchCount = proj !== null && autoLoad.watchSeg !== null
			? watchedFoldCount()
			: -1;
		if (autoLoad.watchCount < 0) autoLoad.watchCount = 0;
		scheduleAutoLoad();
	}
	document.addEventListener("click", onClick, true);
	return () => {
		document.removeEventListener("click", onClick, true);
		stopAutoLoad();
	};
}
