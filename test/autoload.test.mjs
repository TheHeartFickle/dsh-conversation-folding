// M 层补点行为回归（REGRESSION.md T-D1/T-D2 的 Node 侧防线）。
//
// autoload.ts 是唯一直接操作 DOM 的客户端模块：捕获官方「加载更早」按钮的
// 真实点击后，用 setTimeout 持续补点，直到停止条件成立——
//   S1 被监视段不再是 DOM 第一个折叠栏（前面已加载出新栏）
//   S2 被监视段步骤数不再增长
// 本文件用确定性 DOM 桩 + 假定时器驱动真实 bundle 的补点循环，覆盖 M1-M6
// 六个变异点。浏览器 lane 不能代劳：其 fixture 的被监视段一页即补完，只能
// 观测 0/1 次点击（见 tests/e2e/README.md「已知覆盖边界」）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClient, makeNode, makeStore, resetSeq } from './helpers/load-client.mjs';

const REAL_SET_TIMEOUT = globalThis.setTimeout;
const REAL_CLEAR_TIMEOUT = globalThis.clearTimeout;

/** 翻页按钮桩：isConnected/closest/disabled 与 autoload.ts 读取面一致。 */
class FakeButton {
	constructor(text, { disabled = false } = {}) {
		this.textContent = text;
		this.disabled = disabled;
		this.isConnected = true;
		this.clicks = 0;
		this.onClick = null;
	}
	closest(selector) { return selector === 'button' ? this : null; }
	click() {
		this.clicks += 1;
		// 真实按钮被 React 重挂后成断连节点，click() 不应再触达宿主处理器。
		if (this.isConnected) this.onClick?.(this);
	}
	disconnect() { this.isConnected = false; }
}

function makeDom(buttons, barKeys) {
	const dom = {
		buttons,
		bars: barKeys.map((key) => ({ getAttribute: (name) => (name === 'data-seg-key' ? key : null) })),
		listeners: [],
		addEventListener(type, handler) { dom.listeners.push({ type, handler }); },
		removeEventListener(type, handler) {
			const at = dom.listeners.findIndex((entry) => entry.type === type && entry.handler === handler);
			if (at >= 0) dom.listeners.splice(at, 1);
		},
		querySelectorAll(selector) {
			assert.equal(selector, 'button', `autoload 只应查询 button，实为 ${selector}`);
			return dom.buttons.slice();
		},
		querySelector(selector) {
			assert.equal(selector, '.dsh-turnfold[data-seg-key]', `autoload 只应查询首个折叠栏，实为 ${selector}`);
			return dom.bars[0] ?? null;
		},
		// 派发真实用户点击（不经 .click()，故不计入按钮的自动补点次数）。
		dispatchClick(button) {
			for (const entry of dom.listeners.slice()) if (entry.type === 'click') entry.handler({ target: button });
		},
	};
	return dom;
}

function makeTimers() {
	let nextId = 1;
	const pending = new Map();
	return {
		setTimeout(fn) { const id = nextId += 1; pending.set(id, fn); return id; },
		clearTimeout(id) { pending.delete(id); },
		/** 排空定时器队列（补点每 tick 自挂一个定时器，直到停止条件命中）。 */
		drain() {
			let ticks = 0;
			while (pending.size > 0) {
				assert.ok(ticks < 1000, '补点循环未收敛（停止条件全部失效？）');
				const [id, fn] = pending.entries().next().value;
				pending.delete(id);
				fn();
				ticks += 1;
			}
			return ticks;
		},
	};
}

/** 装好 DOM 桩与假定时器，注册真实 autoLoadEffect；返回卸载函数。 */
function mount(client, dom, timers) {
	globalThis.document = dom;
	globalThis.setTimeout = timers.setTimeout;
	globalThis.clearTimeout = timers.clearTimeout;
	const teardown = client.__test.autoLoadEffect();
	return () => {
		teardown?.();
		globalThis.document = undefined;
		globalThis.setTimeout = REAL_SET_TIMEOUT;
		globalThis.clearTimeout = REAL_CLEAR_TIMEOUT;
	};
}

// 构造「被监视段」的投影：一个开放段，steps = 段内过程节点数（S2 读数）。
// steps=0 时不落任何段（segByKey 无键），用于「投影缺段」分支。
const WATCH_SEG = 't1:open';
function projectOfSteps(client, steps) {
	resetSeq();
	const nodes = [makeNode('user', 'u1', 1, {})];
	for (let i = 0; i < steps; i += 1) nodes.push(makeNode('tool-call', `t${i + 1}`, 1, { root: { name: 'bash' } }));
	// getProjection 以快照对象为 WeakMap 缓存键：每步换新对象才能重算投影。
	client.__test.getProjection({ order: nodes.map((node) => node.key), nodes: makeStore(nodes) });
}

test('T-D1/S1 出现更新的折叠栏后立即停止：不得把历史一路拉到底', async () => {
	const client = await loadClient();
	const btn = new FakeButton('Load earlier');
	const dom = makeDom([btn], [WATCH_SEG]);
	const timers = makeTimers();
	const teardown = mount(client, dom, timers);
	try {
		projectOfSteps(client, 1);
		let steps = 1;
		btn.onClick = () => {
			steps += 1;
			projectOfSteps(client, steps);
			// 补出的这一页把更新的栏插到了前面：S1 必须立刻成立。
			if (btn.clicks >= 1) dom.bars = [{ getAttribute: () => 't0:open' }, ...dom.bars];
		};
		dom.dispatchClick(btn);
		const ticks = timers.drain();
		assert.equal(btn.clicks, 1, `出现新栏后必须停止补点（S1）；实际补点 ${btn.clicks} 次，${ticks} tick`);
	} finally {
		teardown();
	}
});

test('T-D1/S2 被监视段步骤数增长期间持续补点，直到不再增长才停', async () => {
	const client = await loadClient();
	const btn = new FakeButton('Load earlier');
	const dom = makeDom([btn], [WATCH_SEG]);
	const timers = makeTimers();
	const teardown = mount(client, dom, timers);
	try {
		let steps = 1;
		projectOfSteps(client, steps);
		const page = () => { steps = Math.min(3, steps + 1); projectOfSteps(client, steps); };
		btn.onClick = page;
		dom.dispatchClick(btn);
		page(); // 用户那次点击自身也翻一页（真实宿主行为）
		const ticks = timers.drain();
		// steps 1→2→3 各补一 tick；第 3 步之后步骤数不再增长 → S2 停止。
		assert.equal(btn.clicks, 2, `步骤数增长期必须持续补点、停止条件须精确（实际 ${btn.clicks} 次 / ${ticks} tick）`);
	} finally {
		teardown();
	}
});

test('T-D1 被监视段不在投影中（无数据）时停止，不得空转到补点上限', async () => {
	const client = await loadClient();
	const btn = new FakeButton('Load earlier');
	const dom = makeDom([btn], [WATCH_SEG]);
	const timers = makeTimers();
	const teardown = mount(client, dom, timers);
	try {
		projectOfSteps(client, 0); // segByKey 里没有 WATCH_SEG：无数据哨兵 -1
		dom.dispatchClick(btn);
		const ticks = timers.drain();
		assert.equal(btn.clicks, 0, `投影缺段时不得补点（无数据 ≠ 空段；实际 ${btn.clicks} 次 / ${ticks} tick）`);
	} finally {
		teardown();
	}
});

test('T-D2 「加载更早」按钮被重挂后必须改点新按钮', async () => {
	const client = await loadClient();
	const first = new FakeButton('Load earlier');
	const dom = makeDom([first], []);
	const timers = makeTimers();
	const teardown = mount(client, dom, timers);
	try {
		let second = null;
		first.onClick = () => {
			first.disconnect();
			second = new FakeButton('Load earlier');
			second.onClick = () => { second.disconnect(); dom.buttons = []; }; // 历史拉到顶，宿主撤掉按钮
			dom.buttons = [second];
		};
		dom.dispatchClick(first);
		timers.drain();
		assert.equal(first.clicks, 1, `重挂前只应点旧按钮 1 次（实际 ${first.clicks}）`);
		assert.equal(second?.clicks, 1, `重挂后必须重新找到并点击新按钮（实际 ${second?.clicks}）`);
		assert.deepEqual(dom.buttons, [], '历史到顶后宿主撤掉按钮，补点必须停止');
	} finally {
		teardown();
	}
});

test('T-D1 补点只允许点击「加载更早」按钮，绝不误点其他按钮（M6）', async () => {
	const client = await loadClient();
	const other = new FakeButton('Settings');
	const first = new FakeButton('Load earlier');
	const dom = makeDom([other, first], [WATCH_SEG]);
	const timers = makeTimers();
	const teardown = mount(client, dom, timers);
	try {
		let steps = 1;
		projectOfSteps(client, steps);
		let current = first;
		const remount = () => {
			current.disconnect();
			current = new FakeButton('Load earlier');
			current.onClick = page;
			dom.buttons = [other, current];
		};
		const page = () => { steps = Math.min(3, steps + 1); projectOfSteps(client, steps); remount(); };
		first.onClick = page;
		dom.dispatchClick(first);
		timers.drain();
		assert.equal(other.clicks, 0, `补点误点了「加载更早」以外的按钮 ${other.clicks} 次（M6：误点任意可点按钮）`);
		assert.equal(steps, 3, '补点必须真的把被监视段补到步骤数不再增长');
	} finally {
		teardown();
	}
});
