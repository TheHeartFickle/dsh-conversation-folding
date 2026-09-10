/**
 * B 层无头回归 lane —— docs/REGRESSION.md 的 F 条目（配置兼容与设置页）。
 * 全部交互只读 + 设置开关往返（结束后还原），零 LLM 计费。
 */
import { test, expect } from '@playwright/test';
import { SEL, clickWithOverlayGuard, collapseAll, ensureFoldSession, expectNoGlobalErrors, readBars, switchMode } from './helpers';

test.describe.configure({ mode: 'serial' });

const TAB_LABEL = '对话折叠';
const BASH_LABEL = 'Bash / Shell 命令';

/** 关闭设置面板（Esc），回到会话视图。 */
async function closeSettings(page: import('@playwright/test').Page): Promise<void> {
	await page.keyboard.press('Escape');
	await page.waitForTimeout(800);
	await page.keyboard.press('Escape');
	await page.waitForTimeout(800);
}

async function openSettingsTab(page: import('@playwright/test').Page): Promise<void> {
	await clickWithOverlayGuard(page, page.getByRole('button', { name: /^(Settings|设置)$/ }).first());
	await page.waitForTimeout(1_000);
	const tab = page.getByText(TAB_LABEL, { exact: true }).first();
	await expect(tab, `插件设置页签「${TAB_LABEL}」必须出现在设置导航中`).toHaveCount(1);
	await clickWithOverlayGuard(page, tab);
	await page.waitForTimeout(800);
}

test('T-F1 独立设置页：18 行类型开关 + 自有配置路由 + localStorage 不落配置', async ({ page }) => {
	await ensureFoldSession(page);
	await openSettingsTab(page);

	const rows = await page.evaluate(() => ({
		rows: document.querySelectorAll('.dsh-fs-row').length,
		switches: document.querySelectorAll('.dsh-fs-switch').length,
	}));
	expect(rows, '「对话折叠」页必须有 18 行类型开关').toEqual({ rows: 18, switches: 18 });

	const todoSwitch = page.locator('.dsh-fs-switch[aria-label*="任务清单"]').first();
	await expect(todoSwitch, '任务清单开关必须存在').toHaveCount(1);
	const before = await todoSwitch.getAttribute('aria-checked');
	await clickWithOverlayGuard(page, todoSwitch);
	await page.waitForTimeout(700);
	const after = await todoSwitch.getAttribute('aria-checked');
	expect(after, '开关必须即时生效（aria-checked 翻转）').not.toBe(before);
	await clickWithOverlayGuard(page, todoSwitch);
	await page.waitForTimeout(700);
	expect(await todoSwitch.getAttribute('aria-checked'), '开关必须还原').toBe(before);

	const config = await page.evaluate(async () => {
		const response = await fetch('/conversation-folding/config');
		return { status: response.status, body: await response.json() as Record<string, unknown> };
	});
	expect(config.status, '插件自有配置路由必须可用').toBe(200);
	expect(config.body.ok, '配置路由必须返回 ok:true').toBe(true);
	expect(config.body).toHaveProperty('displayMode');
	expect(config.body).toHaveProperty('auxVisible');

	const leaked = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes('conversation-folding') && key.includes('auxVisible')));
	expect(leaked, '插件配置不得泄漏到 localStorage').toEqual([]);

	test.info().annotations.push({
		type: 'NOT-COVERED',
		description: '「重启 dsh web 后保持」是环境步骤（重启会轮换 token），由 scratch home 每次重建 + settings.yaml 播种间接覆盖',
	});
	await expectNoGlobalErrors(page);
});

test('T-F2 按类型折叠开关：关 = 始终可见，开 = 折叠', async ({ page }) => {
	await ensureFoldSession(page);
	await collapseAll(page);

	const visibleTools = () => page.evaluate((sel) => [...document.querySelectorAll<HTMLElement>(sel.toolCall)]
		.filter((el) => el.getClientRects().length > 0 && el.offsetHeight > 0).length, SEL);

	const baseline = await visibleTools();

	await openSettingsTab(page);
	const bashSwitch = page.locator(`.dsh-fs-switch[aria-label*="${BASH_LABEL}"]`).first();
	await expect(bashSwitch, 'Bash 开关必须存在').toHaveCount(1);
	const before = await bashSwitch.getAttribute('aria-checked');
	await clickWithOverlayGuard(page, bashSwitch);
	await page.waitForTimeout(700);
	expect(await bashSwitch.getAttribute('aria-checked'), 'Bash 开关必须翻转').not.toBe(before);

	// 回会话：开关即时生效（无需 reload）
	await closeSettings(page);
	await collapseAll(page);
	const unfolded = await visibleTools();
	expect(unfolded, `Bash 关闭折叠后其 tool-call 必须始终可见（基线 ${baseline}，实得 ${unfolded}）`).toBeGreaterThan(baseline);

	// 还原
	await openSettingsTab(page);
	await clickWithOverlayGuard(page, bashSwitch);
	await page.waitForTimeout(700);
	await closeSettings(page);
	await collapseAll(page);
	const restored = await visibleTools();
	expect(restored, `Bash 恢复折叠后可见 tool-call 必须回到基线（基线 ${baseline}，实得 ${restored}）`).toBe(baseline);
	await expectNoGlobalErrors(page);
});

test('T-F3 非 fold 模式与插件隔离：无栏、动态样式空、官方渲染', async ({ page }) => {
	await ensureFoldSession(page);

	for (const label of ['Normal', 'Compact'] as const) {
		await switchMode(page, label);
		const state = await page.evaluate((sel) => ({
			mode: document.documentElement.dataset.dshFoldMode ?? null,
			bars: document.querySelectorAll(sel.bar).length,
			dynRules: (document.getElementById('dsh-conversation-folding-dynamic')?.textContent ?? '').length,
			turnProcess: document.querySelectorAll('[data-chat-flow-kind="turn-process"]').length,
		}), SEL);
		expect(state.mode, `${label} 下 data-dsh-fold-mode 不得为 all`).not.toBe('all');
		expect(state.bars, `${label} 下不得出现插件折叠栏`).toBe(0);
		expect(state.dynRules, `${label} 下动态折叠规则必须为空`).toBe(0);
		expect(state.turnProcess, `${label} 下官方 turn-process 必须按官方语义渲染`).toBeGreaterThan(0);
		await expectNoGlobalErrors(page);
	}

	// 还原 Fold 供后续 spec 使用
	await switchMode(page, 'Fold');
	const bars = await readBars(page);
	expect(bars.length, '还原 Fold 后折叠栏必须回来').toBeGreaterThan(0);
});
