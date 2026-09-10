/**
 * B 层无头 lane 的宿主胶水：URL / workspace / 会话 fixture 的约定，以及
 * 「打开 fixture 会话 → 切显示模式 → 读折叠状态」这组被所有 spec 复用的操作。
 *
 * 所有操作均为只读交互（导航、展开/收起、切模式、读 DOM/计算样式），
 * 零 LLM 计费：禁止发送消息、Ctrl+Enter、重试/重新生成、新建会话。
 */
import { expect, type Page } from '@playwright/test';

const rawUrl = process.env.DSH_E2E_URL;
if (!rawUrl) {
	throw new Error('DSH_E2E_URL is not set — run scripts/e2e-mount.sh (it boots dsh web and injects the launch URL)');
}
export const PAGE_URL: string = rawUrl;

/** fixture 工作区路径（scratch home 内，e2e-mount.sh 注入）。 */
export const WORKSPACE_PATH = process.env.DSH_E2E_WORKSPACE ?? '';

/** 会话行 / 工作区分组行的稳定选择器（0.1.2-rc.1 web 端实测类名）。 */
export const SEL = {
	sessionRow: '.YDXeBa_sessionRow',
	projectRow: '.YDXeBa_projectRow',
	bar: '.dsh-turnfold[data-seg-key]',
	barLabel: '.dsh-turnfold-label',
	barChevron: '.dsh-turnfold-chevron',
	flowItem: '[data-chat-flow-key]',
	toolCall: '[data-chat-flow-kind="tool-call"]',
	hiddenMarker: '[data-dsh-hidden-turn]',
	slotError: '[data-slot-error]',
	debugError: '[data-dsh-debug-error]',
	dynamicStyle: '#dsh-conversation-folding-dynamic',
} as const;

const NEW_SESSION_LABEL = /(New Session|新会话)/;
const LOAD_OLDER = /(Load earlier|加载更早)/;

/** 页面级折叠状态快照（与既有 browser-harness 脚本的 JS_STATE 等价）。 */
export interface FoldState {
	mode: string | null;
	bars: number;
	keys: number;
	err: number;
	dbg: number;
	stopped: number;
}

export async function readState(page: Page): Promise<FoldState> {
	return page.evaluate((sel) => ({
		mode: document.documentElement.dataset.dshFoldMode ?? null,
		bars: document.querySelectorAll(sel.bar).length,
		keys: document.querySelectorAll(sel.flowItem).length,
		err: document.querySelectorAll(sel.slotError).length,
		dbg: document.querySelectorAll(sel.debugError).length,
		stopped: document.querySelectorAll('.dsh-assistant-stopped').length,
	}), SEL);
}

/** 关闭 keyless 启动的 onboarding 遮罩（Continue / Configure later 的本地化文案）。 */
export async function dismissOnboarding(page: Page): Promise<void> {
	for (let round = 0; round < 8; round += 1) {
		let dismissed = false;
		for (const name of ['继续', 'Continue', '稍后配置', 'Configure later']) {
			const button = page.getByRole('button', { name, exact: true }).first();
			if ((await button.count()) === 0) continue;
			try {
				await button.click({ timeout: 3_000 });
				dismissed = true;
				await page.waitForTimeout(600);
			} catch {
				// 被上层遮罩挡住；下一轮先试另一个按钮
			}
		}
		if (!dismissed) break;
	}
	// 兜底：仍存在遮罩时按 Esc 逐层关闭（onboarding 弹层支持 Esc）
	for (let i = 0; i < 3; i += 1) {
		const masks = await page.locator('[class*="_mask_"]').count();
		if (masks === 0) {
			// 遮罩可能在 shell 渲染后才挂上：给迟到的一次宽限，再判定「无遮罩」
			if (i === 0) {
				await page.waitForTimeout(500);
				continue;
			}
			break;
		}
		await page.keyboard.press('Escape');
		await page.waitForTimeout(500);
	}
}

/** 点击元素；被遮罩拦截时先关遮罩再重试，最后兜底 force 点击。 */
export async function clickWithOverlayGuard(page: Page, locator: import('@playwright/test').Locator): Promise<void> {
	try {
		await locator.click({ timeout: 6_000 });
		return;
	} catch {
		await dismissOnboarding(page);
	}
	try {
		await locator.click({ timeout: 6_000 });
	} catch {
		await locator.click({ force: true });
	}
}

/** 导航到启动 URL 并等待 shell 渲染。 */
export async function gotoRoot(page: Page): Promise<void> {
	await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('#root > *')).not.toHaveCount(0, { timeout: 90_000 });
	await dismissOnboarding(page);
}

/** 打开 fixture 工作区下的 fixture 会话（工作区组若已展开则直接点会话行）。 */
export async function openFixtureSession(page: Page): Promise<void> {
	const state = await readState(page);
	if (state.keys > 0) return;

	const sessionRow = page.locator(SEL.sessionRow).filter({ hasNotText: NEW_SESSION_LABEL }).first();
	for (let attempt = 0; attempt < 5; attempt += 1) {
		if ((await sessionRow.count()) === 0) {
			// 工作区分组未展开：点一次 projectRow 展开
			const project = page.locator(SEL.projectRow).first();
			if ((await project.count()) > 0) await clickWithOverlayGuard(page, project);
			await page.waitForTimeout(1_500);
			continue;
		}
		await clickWithOverlayGuard(page, sessionRow);
		await page.waitForTimeout(3_000);
		if ((await readState(page)).keys > 0) return;
		await gotoRoot(page);
	}
	throw new Error('fixture session did not render any conversation items');
}

/** 打开指定标题片段的 fixture 会话（标题用会话首条 prompt 生成，可能随语言变化）。 */
export async function openSessionByTitle(page: Page, titleFragment: string): Promise<void> {
	const row = page.locator(SEL.sessionRow).filter({ hasNotText: NEW_SESSION_LABEL })
		.filter({ hasText: titleFragment }).first();
	await expect(row, `会话「${titleFragment}」必须出现在侧栏`).toHaveCount(1);
	await clickWithOverlayGuard(page, row);
	await page.waitForTimeout(4_000);
	const state = await readState(page);
	expect(state.keys, `会话「${titleFragment}」必须渲染出内容`).toBeGreaterThan(0);
}

/** 切显示模式：设置 → 对话显示下拉 → 选项（切换后页面自动 reload）。 */
export async function switchMode(page: Page, label: 'Normal' | 'Compact' | 'Fold'): Promise<void> {
	await clickWithOverlayGuard(page, page.getByRole('button', { name: /^(Settings|设置)$/ }).first());
	await page.waitForTimeout(1_000);
	await clickWithOverlayGuard(page, page.locator('.dsh-tv-selector').first());
	await page.waitForTimeout(600);
	const item = page.locator('[class*="_item_"]').filter({ hasText: new RegExp(`^${label}$`) }).first();
	await expect(item, `display mode option "${label}" must exist`).toHaveCount(1);
	await clickWithOverlayGuard(page, item);
	// selectMode 触发 location.reload()
	await page.waitForTimeout(2_500);
	await gotoRoot(page);
}

/** 保证处于 Fold 模式且 fixture 会话已打开；返回状态快照。 */
export async function ensureFoldSession(page: Page): Promise<FoldState> {
	await gotoRoot(page);
	let state = await readState(page);
	if (state.mode !== 'all') {
		await switchMode(page, 'Fold');
		state = await readState(page);
	}
	if (state.keys === 0 || state.bars === 0) {
		await openFixtureSession(page);
		state = await readState(page);
	}
	expect(state.mode, 'fold mode must be active').toBe('all');
	expect(state.bars, 'fixture session must render fold bars under Fold').toBeGreaterThan(0);
	expect(state.keys, 'fixture session must render conversation items').toBeGreaterThan(0);
	return state;
}

/** 全部收起 / 全部展开（返回被点击的栏数）。 */
export async function collapseAll(page: Page): Promise<number> {
	return page.evaluate((sel) => {
		const bars = [...document.querySelectorAll<HTMLElement>(`${sel.bar}[data-open]`)];
		bars.forEach((bar) => bar.click());
		return bars.length;
	}, SEL);
}

export async function expandAll(page: Page): Promise<number> {
	return page.evaluate((sel) => {
		const bars = [...document.querySelectorAll<HTMLElement>(`${sel.bar}:not([data-open])`)];
		bars.forEach((bar) => bar.click());
		return bars.length;
	}, SEL);
}

/** 点击一个折叠栏（按 segKey）。 */
export async function clickBar(page: Page, seg: string): Promise<void> {
	await page.evaluate(({ sel, seg }) => {
		const bar = document.querySelector<HTMLElement>(`${sel.bar.replace('[data-seg-key]', `[data-seg-key="${seg}"]`)}`);
		if (!bar) throw new Error(`no fold bar with segKey ${seg}`);
		bar.scrollIntoView({ block: 'center' });
		bar.click();
	}, { sel: SEL, seg });
	await page.waitForTimeout(700);
}

/** 断言全局失败判据：无 slot error / debug 探针。 */
export async function expectNoGlobalErrors(page: Page): Promise<void> {
	const errors = await page.evaluate((sel) => ({
		slot: document.querySelectorAll(sel.slotError).length,
		debug: document.querySelectorAll(sel.debugError).length,
		probes: Object.keys(window).filter((key) => key.startsWith('__DF_')).length,
	}), SEL);
	expect(errors, 'global failure criteria (slot/debug/probe) must be zero').toEqual({ slot: 0, debug: 0, probes: 0 });
}

/** 点击官方「加载更早」按钮一次；返回是否点到。 */
export async function clickLoadOlder(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		const rx = /(Load earlier|加载更早)/;
		const button = [...document.querySelectorAll('button')].find((b) => rx.test(b.textContent ?? ''));
		if (!button) return false;
		if ((button as HTMLButtonElement).disabled) return false;
		button.click();
		return true;
	});
}

/** 读所有折叠栏的 label / open / chevron 矩阵。 */
export async function readBars(page: Page): Promise<Array<{ seg: string; open: boolean; aria: string | null; label: string; chev: string }>> {
	return page.evaluate((sel) => [...document.querySelectorAll<HTMLElement>(sel.bar)].map((bar) => {
		const chevron = bar.querySelector<HTMLElement>(sel.barChevron);
		const keep = chevron?.style.transition;
		if (chevron) chevron.style.transition = 'none';
		const chev = chevron ? getComputedStyle(chevron).transform : '';
		if (chevron) chevron.style.transition = keep ?? '';
		return {
			seg: bar.getAttribute('data-seg-key') ?? '',
			open: bar.hasAttribute('data-open'),
			aria: bar.getAttribute('aria-expanded'),
			label: (bar.querySelector(sel.barLabel)?.textContent ?? '').trim(),
			chev,
		};
	}), SEL);
}

export const CHEVRON = { collapsed: 'matrix(0, -1, 1, 0, 0, 0)', expanded: 'matrix(1, 0, 0, 1, 0, 0)' } as const;
export const LABEL_UNITS = { tools: '个工具调用', msgs: '条消息', thought: '思考了一会儿' } as const;
