/**
 * B 层无头回归 lane —— 对应 docs/REGRESSION.md 的 B 条目。
 *
 * 由 scripts/e2e-mount.sh 启动真实 `dsh web` 并注入 DSH_E2E_URL /
 * DSH_E2E_WORKSPACE；fixture 会话由 scripts/plant-fixtures.mjs 播种进
 * scratch home（tests/fixtures/sessions）。全部交互只读，零 LLM 计费。
 */
import { test, expect } from '@playwright/test';
import {
	CHEVRON,
	LABEL_UNITS,
	SEL,
	clickBar,
	collapseAll,
	ensureFoldSession,
	expandAll,
	expectNoGlobalErrors,
	openFixtureSession,
	readBars,
	readState,
	switchMode,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test('T-A2 三种显示模式各自生效并经 reload 持久化', async ({ page }) => {
	await ensureFoldSession(page);

	const results: Record<string, Awaited<ReturnType<typeof readState>>> = {};
	for (const label of ['Normal', 'Compact', 'Fold'] as const) {
		await switchMode(page, label);
		await openFixtureSession(page);
		results[label.toLowerCase()] = await readState(page);
	}

	const normal = results.normal;
	const compact = results.compact;
	const fold = results.fold;

	expect(normal.mode, 'Normal 下 data-dsh-fold-mode 必须为 none').toBe('none');
	expect(normal.bars, 'Normal 下不得有折叠栏').toBe(0);
	expect(compact.mode, 'Compact 下 data-dsh-fold-mode 必须为 none').toBe('none');
	expect(compact.bars, 'Compact 下不得有折叠栏').toBe(0);
	expect(fold.mode, 'Fold 下 data-dsh-fold-mode 必须为 all').toBe('all');
	expect(fold.bars, 'Fold 下必须出现折叠栏').toBeGreaterThan(0);
	// 模式切换经 location.reload() 后仍成立 —— 即 host 配置持久化生效
	expect(normal.keys > 0 && compact.keys > 0 && fold.keys > 0, '三种模式下会话内容都必须保持渲染').toBe(true);
	await expectNoGlobalErrors(page);
});

test('T-B1 折叠栏样式与官方 turn-process 一致', async ({ page }) => {
	await ensureFoldSession(page);

	const probe = async () => page.evaluate((sel) => {
		const bar = document.querySelector<HTMLElement>(sel.bar);
		if (!bar) throw new Error('no fold bar');
		bar.scrollIntoView({ block: 'center' });
		const style = getComputedStyle(bar);
		const chevron = bar.querySelector<HTMLElement>(sel.barChevron);
		// 折叠栏位于 content-visibility 优化的虚拟化子树内，CSS transition 在
		// 离屏元素上不会推进，读 computed transform 前先禁用 transition。
		const keep = chevron?.style.transition;
		if (chevron) chevron.style.transition = 'none';
		const chev = chevron ? getComputedStyle(chevron).transform : '';
		if (chevron) chevron.style.transition = keep ?? '';
		return {
			height: style.height,
			borderBottomWidth: style.borderBottomWidth,
			borderBottomStyle: style.borderBottomStyle,
			background: style.backgroundColor,
			borderRadius: style.borderRadius,
			open: bar.hasAttribute('data-open'),
			chev,
		};
	}, SEL);

	const collapsed = await probe();
	expect(collapsed.height, '折叠栏高度必须 33px').toBe('33px');
	expect(['0.5px', '1px'], '折叠栏需细底边').toContain(collapsed.borderBottomWidth);
	expect(collapsed.borderBottomStyle, '折叠栏底边不得为 none').not.toBe('none');
	expect(['rgba(0, 0, 0, 0)', 'transparent'], '折叠栏背景必须透明').toContain(collapsed.background);
	expect(collapsed.chev, '收起时 chevron 必须 rotate(-90deg)').toBe(CHEVRON.collapsed);

	await clickBar(page, (await readBars(page))[0].seg);
	const expanded = await probe();
	expect(expanded.open, '点击后折叠栏应展开').toBe(true);
	expect(expanded.chev, '展开时 chevron 必须 rotate(0)').toBe(CHEVRON.expanded);

	await clickBar(page, (await readBars(page))[0].seg);
	const restored = await probe();
	expect(restored.open, '再次点击应恢复收起').toBe(false);
	expect(restored.chev, '恢复后 chevron 必须回到 rotate(-90deg)').toBe(CHEVRON.collapsed);
	await expectNoGlobalErrors(page);
});

test('T-B2 栏文案四种官方格式 + 计数与段内真实 tool-call 节点一致', async ({ page }) => {
	await ensureFoldSession(page);

	const bars = await readBars(page);
	expect(bars.length, 'fixture 会话在 Fold 下必须有折叠栏').toBeGreaterThan(0);

	const { tools, msgs, thought } = LABEL_UNITS;
	const rxMixed = new RegExp(`^\\d+ ${tools} · \\d+ ${msgs}$`);
	const rxTools = new RegExp(`^\\d+ ${tools}$`);
	const rxMsgs = new RegExp(`^\\d+ ${msgs}$`);
	const kinds = { mixed: 0, tools: 0, msgs: 0, thought: 0, other: [] as string[] };
	for (const bar of bars) {
		if (rxMixed.test(bar.label)) kinds.mixed += 1;
		else if (rxTools.test(bar.label)) kinds.tools += 1;
		else if (rxMsgs.test(bar.label)) kinds.msgs += 1;
		else if (bar.label === thought) kinds.thought += 1;
		else kinds.other.push(bar.label);
	}
	expect(kinds.other, '不得出现四种官方格式之外的栏文案').toEqual([]);
	expect(kinds.mixed + kinds.tools + kinds.msgs + kinds.thought).toBe(bars.length);
	expect(kinds.tools, 'fixture 需含「仅工具调用」格式').toBeGreaterThan(0);
	expect(kinds.msgs, 'fixture 需含「仅消息」格式').toBeGreaterThan(0);

	// M20 交叉断言（折叠态下执行，早于任何 toggle）：每栏文案的工具数 ==
	// 该栏段区内 display:none 的真实 tool-call 节点数。段区 = DOM 顺序上从本栏
	// 到下一插件栏；同 parentElement 的多栏锚（steering 对）区域有歧义，两侧跳过。
	const cross = await page.evaluate((sel) => {
		const allBars = [...document.querySelectorAll<HTMLElement>(sel.bar)];
		const toolsNodes = [...document.querySelectorAll<HTMLElement>(sel.toolCall)];
		const pids = new Map<Element, number>();
		const pid = (el: Element | null): number => {
			if (!el) return -1;
			if (!pids.has(el)) pids.set(el, pids.size);
			return pids.get(el) as number;
		};
		let bi = 0;
		const regions: Array<{ total: number; hidden: number }> = [];
		for (const node of toolsNodes) {
			while (bi < allBars.length && (allBars[bi].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) bi += 1;
			const idx = bi - 1;
			if (idx < 0) continue;
			while (regions.length <= idx) regions.push({ total: 0, hidden: 0 });
			regions[idx].total += 1;
			if (getComputedStyle(node).display === 'none') regions[idx].hidden += 1;
		}
		return {
			bars: allBars.map((bar) => ({
				seg: bar.getAttribute('data-seg-key'),
				pid: pid(bar.parentElement),
				label: (bar.querySelector(sel.barLabel)?.textContent ?? '').trim(),
			})),
			regions,
		};
	}, SEL);

	const skip = new Set<number>();
	for (let i = 0; i < cross.bars.length - 1; i += 1) {
		if (cross.bars[i].pid === cross.bars[i + 1].pid) {
			skip.add(i);
			skip.add(i + 1);
		}
	}
	const rxToolCount = new RegExp(`^(\\d+) ${tools}`);
	const mismatches: unknown[] = [];
	let validated = 0;
	cross.bars.forEach((bar, i) => {
		if (skip.has(i)) return;
		const region = cross.regions[i] ?? { total: 0, hidden: 0 };
		const match = rxToolCount.exec(bar.label);
		const advertised = match ? Number(match[1]) : 0;
		if (region.hidden === advertised) validated += 1;
		else mismatches.push({ i, seg: bar.seg, label: bar.label, region });
	});
	expect(mismatches, '栏文案工具数必须等于段区内 display:none 的 tool-call 节点数（防 M20 计数 +1）').toEqual([]);
	expect(validated, '交叉断言覆盖的栏数过少（fixture 漂移？）').toBeGreaterThanOrEqual(3);

	// 展开/收起只旋转 chevron，不改文案
	const target = bars[0];
	const before = (await readBars(page)).find((bar) => bar.seg === target.seg);
	if (!before) throw new Error(`bar ${target.seg} disappeared`);
	await clickBar(page, target.seg);
	const after = (await readBars(page)).find((bar) => bar.seg === target.seg);
	if (!after) throw new Error(`bar ${target.seg} disappeared after toggle`);
	expect(after.label, '展开不得改变栏文案').toBe(before.label);
	expect(after.open, '点击后展开状态必须翻转').toBe(!before.open);
	expect(after.aria, 'aria-expanded 必须与展开状态一致').toBe(after.open ? 'true' : 'false');
	expect(after.chev, 'chevron 必须与展开状态一致').toBe(after.open ? CHEVRON.expanded : CHEVRON.collapsed);

	await clickBar(page, target.seg);
	const restored = (await readBars(page)).find((bar) => bar.seg === target.seg);
	if (!restored) throw new Error(`bar ${target.seg} disappeared after restore`);
	expect(restored.label, '再次收起不得改变栏文案').toBe(before.label);
	expect(restored.open, '第二次点击必须恢复原状态').toBe(before.open);
	await expectNoGlobalErrors(page);
});

test('T-B3 栏锚定段首：收起紧贴其后内容、展开步骤在栏下方', async ({ page }) => {
	await ensureFoldSession(page);
	await collapseAll(page);

	const below = await page.evaluate((sel) => {
		const bars = [...document.querySelectorAll<HTMLElement>(`${sel.bar}:not([data-open])`)];
		const items = [...document.querySelectorAll<HTMLElement>(sel.flowItem)]
			.filter((el) => el.getClientRects().length > 0);
		const out: Array<{ seg: string; belowKind: string | null; gap: number | null }> = [];
		for (const bar of bars) {
			const seat = (bar.closest(sel.flowItem) as HTMLElement | null) ?? bar;
			const rect = bar.getBoundingClientRect();
			const idx = items.indexOf(seat);
			if (idx < 0) continue;
			let next: HTMLElement | null = null;
			for (let i = idx + 1; i < items.length; i += 1) {
				if (items[i].getBoundingClientRect().top >= rect.bottom - 2) { next = items[i]; break; }
			}
			out.push({
				seg: bar.getAttribute('data-seg-key') ?? '',
				belowKind: next?.getAttribute('data-chat-flow-kind') ?? null,
				gap: next ? Math.round(next.getBoundingClientRect().top - rect.bottom) : null,
			});
		}
		return out;
	}, SEL);

	expect(below.length, 'fixture 至少要有两个收起的折叠栏').toBeGreaterThanOrEqual(2);
	expect(below.some((entry) => entry.belowKind === null), '收起栏不得悬空（下方必须有可见内容）').toBe(false);

	// 展开第 2 个收起栏：其步骤必须出现在栏下方
	const target = await page.evaluate((sel) => {
		const bars = [...document.querySelectorAll<HTMLElement>(`${sel.bar}:not([data-open])`)];
		const bar = bars[1];
		if (!bar) return null;
		bar.scrollIntoView({ block: 'center' });
		return bar.getAttribute('data-seg-key');
	}, SEL);
	if (!target) throw new Error('need a second collapsed bar for the expand probe');
	await clickBar(page, target);

	const after = await page.evaluate(({ sel, seg }) => {
		const bar = document.querySelector<HTMLElement>(`${sel.bar.replace('[data-seg-key]', `[data-seg-key="${seg}"]`)}`);
		if (!bar) return null;
		const items = [...document.querySelectorAll<HTMLElement>(sel.flowItem)]
			.filter((el) => el.getClientRects().length > 0);
		const seat = (bar.closest(sel.flowItem) as HTMLElement | null) ?? bar;
		const idx = items.indexOf(seat);
		const kinds: string[] = [];
		for (let i = idx; i < Math.min(items.length, idx + 6); i += 1) {
			kinds.push(items[i].getAttribute('data-chat-flow-kind') ?? '');
		}
		return { open: bar.hasAttribute('data-open'), kinds };
	}, { sel: SEL, seg: target });

	expect(after?.open, '点击后栏必须展开').toBe(true);
	expect(after?.kinds.includes('assistant-step'), '展开段的步骤必须出现在栏下方（含 assistant-step）').toBe(true);
	await expectNoGlobalErrors(page);
});

test('T-B4 每段独立展开收起且同页重渲染后保持', async ({ page }) => {
	await ensureFoldSession(page);
	await collapseAll(page);

	const states = async (): Promise<Record<string, boolean>> => Object.fromEntries(
		(await readBars(page)).map((bar) => [bar.seg, bar.open]),
	);

	const base = await states();
	expect(Object.values(base).some(Boolean), '基线必须全部收起').toBe(false);
	const segs = Object.keys(base);
	expect(segs.length, 'fixture 至少要有三个折叠栏').toBeGreaterThanOrEqual(3);

	const [a, b] = [segs[1], segs[2]];
	await clickBar(page, a);
	const s1 = await states();
	expect(s1[a], '栏 A 必须展开').toBe(true);
	expect(Object.entries(s1).filter(([seg, open]) => open && seg !== a), '展开 A 不得影响其他栏').toEqual([]);

	await clickBar(page, b);
	const s2 = await states();
	expect(s2[a], '展开 B 后 A 必须保持展开').toBe(true);
	expect(s2[b], '栏 B 必须展开').toBe(true);

	await clickBar(page, a);
	const s3 = await states();
	expect(s3[a], '再次点击 A 必须收起').toBe(false);
	expect(s3[b], '收起 A 后 B 必须保持展开').toBe(true);

	await clickBar(page, segs[0]);
	const s4 = await states();
	expect(s4[b], '同页重渲染后 B 必须保持展开').toBe(true);
	expect(s4[segs[0]], '栏 0 必须展开').toBe(true);

	await collapseAll(page);
	expect(Object.values(await states()).some(Boolean), '全部收起失败').toBe(false);
	await expectNoGlobalErrors(page);
});

test('T-B5 影子座位零残留：可见条目间距不随折叠步数增长', async ({ page }) => {
	await ensureFoldSession(page);
	await collapseAll(page);

	const data = await page.evaluate((sel) => {
		const items = [...document.querySelectorAll<HTMLElement>(sel.flowItem)]
			.filter((el) => el.getClientRects().length > 0 && el.offsetHeight > 0);
		const gaps: number[] = [];
		for (let i = 1; i < items.length; i += 1) {
			const prev = items[i - 1].getBoundingClientRect();
			const cur = items[i].getBoundingClientRect();
			if (cur.top >= prev.bottom - 1) gaps.push(Math.round(cur.top - prev.bottom));
		}
		const renderedHiddenSeats = [...document.querySelectorAll<HTMLElement>(sel.hiddenMarker)]
			.filter((el) => el.getClientRects().length > 0).length;
		return { visible: items.length, gaps, maxGap: Math.max(...gaps, 0), renderedHiddenSeats };
	}, SEL);

	expect(data.visible, '会话应渲染较多可见条目').toBeGreaterThan(10);
	expect(data.renderedHiddenSeats, '隐藏标记必须 display:none（零残留）').toBe(0);
	expect(data.maxGap, `间距不得超过官方 16px + 栏 margin（B17 幻影间隔特征）：max=${data.maxGap} gaps=${JSON.stringify(data.gaps)}`).toBeLessThanOrEqual(30);
	await expectNoGlobalErrors(page);
});
