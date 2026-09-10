/**
 * B 层无头回归 lane —— docs/REGRESSION.md 的 C/D/E 条目。
 *
 * 全部交互只读，零 LLM 计费；流式（T-E1/E2/E3 的实时部分）与 Ctrl+Enter
 * 插入（T-G1/G2）属计费交互，按 REGRESSION.md 的 LIMITATION 处理：
 * 静态部分在浏览器断言，动态部分由 M 层机械化用例覆盖。
 */
import { test, expect } from '@playwright/test';
import {
	SEL,
	clickBar,
	clickLoadOlder,
	collapseAll,
	ensureFoldSession,
	expandAll,
	expectNoGlobalErrors,
	readBars,
	readState,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test('T-C1 正文永不折叠：收起/展开两态正文逐 key 一致', async ({ page }) => {
	await ensureFoldSession(page);
	await collapseAll(page);

	const readBodies = () => page.evaluate((sel) => {
		// 正文文本比较排除 .dsh-think 子树：正文内思维链随段收起联动是设计行为
		const textNoThink = (root: HTMLElement): string => {
			let out = '';
			const iter = document.createNodeIterator(root, NodeFilter.SHOW_TEXT);
			let node: Node | null;
			while ((node = iter.nextNode())) {
				let parent: HTMLElement | null = node.parentElement;
				let skip = false;
				while (parent && parent !== root) {
					if (parent.classList?.contains('dsh-think')) { skip = true; break; }
					parent = parent.parentElement;
				}
				if (!skip) out += node.textContent ?? '';
			}
			return out;
		};
		const seats = [...document.querySelectorAll<HTMLElement>('[data-chat-flow-kind="assistant-step"]')]
			.filter((el) => el.getClientRects().length > 0 && el.querySelector('.dsh-assistant-root'));
		const withMarker = seats.filter((el) => el.querySelector(sel.hiddenMarker)).length;
		const map: Record<string, string> = {};
		for (const seat of seats) {
			const key = seat.getAttribute('data-chat-flow-key') ?? '';
			const root = seat.querySelector<HTMLElement>('.dsh-assistant-root');
			if (root) map[key] = textNoThink(root).trim();
		}
		return { count: seats.length, withMarker, empty: Object.values(map).filter((text) => !text).length, map };
	}, SEL);

	const collapsed = await readBodies();
	expect(collapsed.count, '收起态必须有可见正文座位').toBeGreaterThan(0);
	expect(collapsed.withMarker, '正文座位内不得出现隐藏标记').toBe(0);
	expect(collapsed.empty, '可见正文座位不得为空文本').toBe(0);

	await expandAll(page);
	await page.waitForTimeout(1_000);
	const expanded = await readBodies();
	expect(expanded.count, '展开后正文座位不得减少').toBeGreaterThanOrEqual(collapsed.count);
	const changed = Object.keys(collapsed.map).filter((key) => expanded.map[key] !== collapsed.map[key]);
	expect(changed, '正文内容不得随折叠状态改变').toEqual([]);
	for (const key of Object.keys(collapsed.map)) {
		expect(expanded.map[key], `正文座位 ${key} 展开后必须仍存在`).toBeDefined();
	}
	await expectNoGlobalErrors(page);
});

test('T-C2 栏计数与展开后可见步骤一致，思维链不丢失', async ({ page }) => {
	await ensureFoldSession(page);
	const bars = await readBars(page);
	const sumTools = bars.reduce((sum, bar) => {
		const match = /^(\d+) 个工具调用/.exec(bar.label);
		return sum + (match ? Number(match[1]) : 0);
	}, 0);
	expect(sumTools, 'fixture 的栏文案必须含工具调用计数').toBeGreaterThan(0);

	const counts = () => page.evaluate((sel) => ({
		visibleTools: [...document.querySelectorAll<HTMLElement>(sel.toolCall)]
			.filter((el) => el.getClientRects().length > 0 && el.offsetHeight > 0).length,
		thinks: [...document.querySelectorAll<HTMLElement>('.dsh-think')]
			.filter((el) => el.getClientRects().length > 0).length,
	}), SEL);

	await collapseAll(page);
	await page.waitForTimeout(800);
	const base = await counts();
	expect(base.visibleTools, '收起态只允许默认豁免类型可见（基线）').toBeLessThanOrEqual(2);

	await expandAll(page);
	await page.waitForTimeout(1_000);
	const expanded = await counts();
	expect(expanded.visibleTools, `展开后可见 tool-call 数必须等于栏文案求和 + 基线（${expanded.visibleTools} != ${sumTools} + ${base.visibleTools}）`)
		.toBe(sumTools + base.visibleTools);
	expect(expanded.thinks, '展开后思维链必须可见（不得丢失）').toBeGreaterThan(0);
	await expectNoGlobalErrors(page);
});

test('T-C3 中止轮：收起隐藏、展开可见、再收起恢复（无 :open 段时跳过）', async ({ page }) => {
	await ensureFoldSession(page);
	await collapseAll(page);

	const probe = () => page.evaluate((sel) => {
		const bar = [...document.querySelectorAll<HTMLElement>(sel.bar)]
			.find((candidate) => /:open$/.test(candidate.getAttribute('data-seg-key') ?? ''));
		if (!bar) return null;
		const seat = bar.closest(sel.flowItem) as HTMLElement | null;
		const items = [...document.querySelectorAll<HTMLElement>(sel.flowItem)];
		const start = items.indexOf(seat ?? bar);
		let end = items.length;
		for (let i = start + 1; i < items.length; i += 1) {
			const kind = items[i].getAttribute('data-chat-flow-kind');
			if (kind === 'user' || kind === 'turn-process') { end = i; break; }
		}
		const region = items.slice(start, end);
		return {
			seg: bar.getAttribute('data-seg-key') ?? '',
			open: bar.hasAttribute('data-open'),
			visTools: region.filter((el) => el.getAttribute('data-chat-flow-kind') === 'tool-call'
				&& el.getClientRects().length > 0 && el.offsetHeight > 0).length,
			thinks: region.filter((el) => el.querySelector('.dsh-think') && el.getClientRects().length > 0).length,
			regionSize: region.length,
		};
	}, SEL);

	const collapsed = await probe();
	if (collapsed === null) {
		test.info().annotations.push({
			type: 'FIXTURE-MISSING',
			description: '播种的 fixture 无 ":open" 段（中止轮 + 无最终正文）；中止轮隐藏/可见的规则由 M 层 view-seat/projection-edge 用例覆盖',
		});
		await expectNoGlobalErrors(page);
		return;
	}

	expect(collapsed.open, '中止轮栏初始必须收起').toBe(false);
	expect(collapsed.visTools, '收起的中止轮不得泄漏可见 tool-call').toBe(0);
	await clickBar(page, collapsed.seg);
	const expanded = await probe();
	expect(expanded?.open, '点击后中止轮栏必须展开').toBe(true);
	expect(expanded?.visTools, '展开的中止轮必须显示其 tool-call').toBeGreaterThan(0);
	expect(expanded?.thinks, '展开的中止轮必须显示其思维链').toBeGreaterThan(0);
	await clickBar(page, collapsed.seg);
	const recollapsed = await probe();
	expect(recollapsed?.open, '再次点击必须恢复收起').toBe(false);
	expect(recollapsed?.visTools, '再次收起后不得再泄漏 tool-call').toBe(0);
	await expectNoGlobalErrors(page);
});

test('T-C4 加载更早之后过程不溢出：可见 tool-call 保持 0、动态规则存在', async ({ page }) => {
	await ensureFoldSession(page);
	await collapseAll(page);

	const counts = () => page.evaluate((sel) => ({
		visibleTools: [...document.querySelectorAll<HTMLElement>(sel.toolCall)]
			.filter((el) => el.getClientRects().length > 0 && el.offsetHeight > 0).length,
		keys: document.querySelectorAll(sel.flowItem).length,
		dynRules: (document.getElementById('dsh-conversation-folding-dynamic')?.textContent ?? '').length,
		err: document.querySelectorAll(sel.slotError).length,
		dbg: document.querySelectorAll(sel.debugError).length,
	}), SEL);

	const before = await counts();
	expect(before.visibleTools, '收起态可见 tool-call 必须为 0').toBe(0);
	expect(before.dynRules, '动态隐藏规则必须存在').toBeGreaterThan(0);

	const clicked = await clickLoadOlder(page);
	if (!clicked) {
		test.info().annotations.push({ type: 'FIXTURE-MISSING', description: 'fixture 无「加载更早」按钮（无更多历史页）' });
		return;
	}
	// 等自动补点稳定
	await page.waitForTimeout(6_000);
	const after = await counts();
	expect(after.visibleTools, '加载历史后不得有 tool-call 溢出').toBe(0);
	expect(after.keys, '加载历史后条目数必须增长').toBeGreaterThan(before.keys);
	await expectNoGlobalErrors(page);
});

test('T-C5 正文代码块正常渲染，无 debug 探针', async ({ page }) => {
	await ensureFoldSession(page);
	await collapseAll(page);

	const data = await page.evaluate(() => ({
		bodies: [...document.querySelectorAll<HTMLElement>('[data-chat-flow-kind="assistant-step"]')]
			.filter((el) => el.getClientRects().length > 0).length,
		code: document.querySelectorAll('[data-chat-flow-kind="assistant-step"] pre, [data-chat-flow-kind="assistant-step"] code').length,
		dbg: document.querySelectorAll('[data-dsh-debug-error]').length,
	}));
	expect(data.bodies, '必须有可见正文').toBeGreaterThan(0);
	expect(data.code, 'fixture 正文含围栏代码块，必须渲染出 code/pre 元素').toBeGreaterThan(0);
	expect(data.dbg, '不得出现 debug 探针').toBe(0);
	await expectNoGlobalErrors(page);
});

test('T-D1/T-D2 一次点击自动补点：不拉到顶、点击次数受限、内容增长', async ({ page }) => {
	await ensureFoldSession(page);

	// 埋点：统计对「加载更早/加载中」按钮的点击与官方按钮重挂
	await page.evaluate(() => {
		const store = window as unknown as { __dfClicks?: number; __dfRemounts?: number; __dfLastBtn?: HTMLButtonElement | null };
		store.__dfClicks = 0;
		store.__dfRemounts = 0;
		store.__dfLastBtn = null;
		const original = HTMLButtonElement.prototype.click;
		HTMLButtonElement.prototype.click = function patched(this: HTMLButtonElement) {
			const text = this.textContent ?? '';
			if (/(Load earlier|加载更早|Loading|加载中)/.test(text)) {
				if (store.__dfLastBtn && store.__dfLastBtn !== this && !store.__dfLastBtn.isConnected) {
					store.__dfRemounts = (store.__dfRemounts ?? 0) + 1;
				}
				store.__dfLastBtn = this;
				store.__dfClicks = (store.__dfClicks ?? 0) + 1;
			}
			return original.apply(this, arguments as unknown as []);
		};
	});

	const watch = () => page.evaluate((sel) => {
		const store = window as unknown as { __dfClicks?: number; __dfRemounts?: number };
		return {
			clicks: store.__dfClicks ?? 0,
			remounts: store.__dfRemounts ?? 0,
			firstBar: document.querySelector<HTMLElement>(sel.bar)?.getAttribute('data-seg-key') ?? null,
			keys: document.querySelectorAll(sel.flowItem).length,
			loadBtn: [...document.querySelectorAll('button')].some((b) => /(Load earlier|加载更早)/.test(b.textContent ?? '')),
			loadingBtn: [...document.querySelectorAll('button')].some((b) => /(Loading|加载中)/.test(b.textContent ?? '')),
			visibleTools: [...document.querySelectorAll<HTMLElement>(sel.toolCall)]
				.filter((el) => el.getClientRects().length > 0 && el.offsetHeight > 0).length,
		};
	}, SEL);

	const first = await watch();
	expect(first.loadBtn, 'fixture 必须暴露可用的「加载更早」按钮（需要多页历史）').toBe(true);
	const clicked = await clickLoadOlder(page);
	expect(clicked, '「加载更早」按钮必须可点击').toBe(true);

	// 轮询到点击计数稳定且无 loading 在途
	let stable = 0;
	let last = -1;
	for (let i = 0; i < 90; i += 1) {
		await page.waitForTimeout(500);
		const now = await watch();
		if (now.clicks === last && !now.loadingBtn) stable += 1;
		else stable = 0;
		last = now.clicks;
		if (stable >= 4) break;
	}
	const end = await watch();
	// S2 语义：被监视栏的步骤数不再增长即停 —— fixture 一页即可补完被监视栏，
	// 因此恰好 1 次点击。点击 >1 说明停止条件失效（M1/M2/M5 变异会继续补点）。
	expect(end.clicks, `一次「加载更早」必须只补一页（clicks=${end.clicks}；>1 = 停止条件失效）`).toBe(1);
	expect(end.loadBtn, '补点停止后「加载更早」按钮必须仍在（历史不得被拉到顶，防 M1/M2 变异）').toBe(true);
	expect(end.keys, '补点必须真的前插了历史').toBeGreaterThan(first.keys);
	expect(end.firstBar, '补点后最旧折叠栏必须前移（S1 观测面）').not.toBe(first.firstBar);
	expect(end.visibleTools, '补点过程中不得泄漏可见 tool-call').toBe(0);
	await expectNoGlobalErrors(page);
});

test('T-E1/E3 静态部分：fold 模式 unhide 规则存在、滚动容器可解析', async ({ page }) => {
	await ensureFoldSession(page);

	const staticPart = await page.evaluate(() => {
		const style = [...document.querySelectorAll('style')]
			.find((node) => (node.textContent ?? '').includes('data-dsh-fold-mode=all'));
		return {
			unhideRule: Boolean(style && (style.textContent ?? '').includes('[hidden]:not(:has([data-dsh-hidden-turn]))')),
			dynStyle: Boolean(document.getElementById('dsh-conversation-folding-dynamic')),
		};
	});
	expect(staticPart.unhideRule, 'fold 模式 unhide 规则必须存在于静态样式中').toBe(true);
	expect(staticPart.dynStyle, '插件动态样式节点必须存在').toBe(true);

	const scroller = await page.evaluate(() => {
		const anchor = document.querySelector('[data-chat-flow]');
		if (!anchor) return null;
		let el: HTMLElement | null = anchor as HTMLElement;
		while (el && el !== document.body) {
			const overflowY = getComputedStyle(el).overflowY;
			if (overflowY === 'auto' || overflowY === 'scroll') return { found: true, overflowY };
			el = el.parentElement;
		}
		return { found: false };
	});
	expect(scroller, '必须存在 [data-chat-flow] 锚点').not.toBeNull();
	expect(scroller?.found, '从 [data-chat-flow] 向上必须能解析到滚动容器').toBe(true);

	test.info().annotations.push({
		type: 'LIMITATION',
		description: 'T-E1/E2/E3 的流式阶段断言需要实时流式（计费交互，禁止）；流式规则由 M 层 model/projection-edge 用例覆盖',
	});
	await expectNoGlobalErrors(page);
});
