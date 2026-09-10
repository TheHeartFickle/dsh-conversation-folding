// M 层补充回归：生效层座位组件（真实 bundle 的 React 视图）。
// 通过「真 React + useSyncExternalStore 收窄为读快照」的门面在 Node 内
// renderToStaticMarkup，覆盖 __test 纯函数出口之外的视图分支：
//   T-B2 栏文案组合、T-C3 中止轮收起渲染、T-C1 正文座位永不隐藏、
//   T-B5/B17 隐藏标记收座位、T-F3/T-A2 非 fold 模式零介入、
//   T-F1/T-F2 设置页 18 行开关。
// react-dom/server 对 ThinkBox 的 useLayoutEffect 会输出无害警告，渲染期间
// 暂时静默 console.error；组件内部异常仍会以 data-dsh-debug-error 渲染，
// 由每条用例断言不存在（REGRESSION.md 全局失败判据的机械化部分）。
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadClient, makeNode, primitivesStub } from './helpers/load-client.mjs';

const reactFacade = { ...React, useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot() };
// 直调门面：座位组件作为普通函数调用（不进渲染器）——用于触发 bundle 内部
// 的 setSegExpanded（Node 端唯一入口是 FoldButton 的 onClick 闭包）。
// useEffect 置空（useFoldStyle 的样式写入不触发）；useSyncExternalStore 收窄
// 为读快照；useMemo 直通（渲染器外真实 hooks 非法，直调路径只求值不求缓存）。
// 门面仍展开真实 React：renderToStaticMarkup 下 useState 等其余真实 hooks
// 合法，同一实例可兼用于直调与静态渲染。
const clickFacade = {
  ...React,
  useEffect: () => { },
  useMemo: (fn) => fn(),
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
};
// Menu 桩渲染 anchor 与 items（{id,label}）：让「对话显示」下拉的三项选项
// （normal/compact/fold）成为可断言标记（T-A1/T-A2 的机械化部分）。
const primitivesWithMenu = {
  ...primitivesStub,
  Menu: function Menu(props) {
    return React.createElement('div', { className: 'menu-stub' },
      props.anchor,
      (props.items ?? []).map((item) => React.createElement('div', { key: item.id, 'data-menu-item': item.id }, item.label)));
  },
};
const realFetch = globalThis.fetch;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

// 载入 bundle 并捕获注册的座位组件。displayMode 经 GET /conversation-folding/config
// 恢复（fetch 契约同 model.test.mjs：GET options===undefined）。
// react 参数：缺省 reactFacade（渲染器内静态渲染）；传 clickFacade 可在渲染器
// 外直调座位。每个用例独立 boot——bundle 内的三个 store 与 WeakMap 缓存是
// 模块级单例，互不污染（同 state-config.test.mjs 的做法）。
async function bootSeats(config, react = reactFacade) {
  const client = await loadClient({ react, primitives: primitivesWithMenu });
  globalThis.fetch = (url, options) => {
    if (url === '/conversation-folding/config' && options === undefined) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, ...(config ?? {}) }) });
    }
    return Promise.resolve({ ok: false, json: async () => ({ ok: false }) });
  };
  const injects = [];
  client.apply({
    get: (name) => (name === 'slots' ? {
      inject: (slot, factory) => injects.push([slot, factory()]),
      register: (meta, component) => ({ meta, component }),
    } : undefined),
    effect: () => () => { },
  });
  await tick();
  globalThis.fetch = realFetch;
  const seat = (slot, key) => {
    const hit = injects.find(([s, reg]) => s === slot && reg.meta.key === key);
    assert.ok(hit, '座位已注册: ' + slot + ' ' + key);
    return hit[1].component;
  };
  return {
    client,
    assistantSeat: seat('conversation.chat.node', 'assistant-step'),
    turnProcessSeat: seat('conversation.chat.node', 'turn-process'),
    settingsSection: injects.find(([s]) => s === 'settings.section')[1].component,
    transcriptRow: injects.find(([s]) => s === 'settings.general.item')[1].component,
  };
}

const fold = await bootSeats({ displayMode: 'fold', auxVisible: ['context', 'skill', 'system-prompt'] });
// 非 fold 模式实例：配置不可用（ok:false）→ 默认 compact，官方渲染零介入。
const compact = await bootSeats(null);

function renderSeat(component, props) {
  const originalError = console.error;
  console.error = () => { };
  try {
    return renderToStaticMarkup(React.createElement(component, props));
  } finally {
    console.error = originalError;
  }
}

function user(key, turn) { return makeNode('user', key, turn, {}); }
function turnProcess(key, turn) { return makeNode('turn-process', key, turn, {}); }
function toolCall(key, turn, name = 'bash') { return makeNode('tool-call', key, turn, { root: { name } }); }
function turnTail(key, turn) { return makeNode('turn-tail', key, turn, {}); }
function step(key, turn, blocks) { return makeNode('assistant-step', key, turn, { blocks, status: 'settled' }); }

const REASONING = [{ kind: 'reasoning', text: 'thinking…' }];
const REASONING_TEXT = [{ kind: 'reasoning', text: 'thinking…' }, { kind: 'text', text: 'answer' }];
const TEXT_ONLY = [{ kind: 'text', text: 'answer' }];

function snapshot(nodes) {
  const map = new Map(nodes.map((node) => [node.key, node]));
  return { order: nodes.map((node) => node.key), nodes: { get: (key) => map.get(key) } };
}
const t = (key) => key;

function labelOf(html) {
  const match = html.match(/<span class="dsh-turnfold-label">([^<]*)<\/span>/);
  assert.ok(match, '渲染出折叠栏标签: ' + html);
  return match[1];
}

// ---------- T-B2 栏文案格式 ----------

test('T-B2 文案格式：2 个工具调用 · 1 条消息（工具段被正文封口）', () => {
  const nodes = [user('u1', 1), turnProcess('tp1', 1), toolCall('t1', 1), toolCall('t2', 1), step('b1', 1, TEXT_ONLY), turnTail('tt1', 1)];
  const snap = snapshot(nodes);
  const html = renderSeat(fold.turnProcessSeat, { node: nodes[1], t, useChat: () => snap });
  assert.equal(labelOf(html), '2 个工具调用 · 1 条消息');
  assert.match(html, /data-seg-key="b1"/, '插件栏携带 segKey（补点 S1/S2 观测依赖）');
  assert.ok(!html.includes('data-dsh-debug-error'));
});

test('T-B2 文案格式：1 条消息（无步骤、思考正文段的联动栏）', () => {
  const nodes = [user('u1', 1), step('b1', 1, REASONING_TEXT)];
  const snap = snapshot(nodes);
  const html = renderSeat(fold.assistantSeat, { node: nodes[1], t, useChat: () => snap });
  assert.equal(labelOf(html), '1 条消息', '思考正文段的栏渲染在正文座位内');
  assert.ok(html.includes('dsh-assistant-root'), '正文本身仍渲染');
});

test('T-B2 文案格式：思考了一会儿（仅推理过程段）与 1 个工具调用', () => {
  const thinkOnly = [user('u1', 1), turnProcess('tp1', 1), step('s1', 1, REASONING), turnTail('tt1', 1)];
  const html1 = renderSeat(fold.turnProcessSeat, { node: thinkOnly[1], t, useChat: () => snapshot(thinkOnly) });
  assert.equal(labelOf(html1), '思考了一会儿');
  const toolOnly = [user('u1', 1), turnProcess('tp1', 1), toolCall('t1', 1), turnTail('tt1', 1)];
  const html2 = renderSeat(fold.turnProcessSeat, { node: toolOnly[1], t, useChat: () => snapshot(toolOnly) });
  assert.equal(labelOf(html2), '1 个工具调用');
});

// ---------- T-C3 中止轮：收起渲染隐藏标记 ----------

test('T-C3 中止轮收起：思维链过程步渲染隐藏占位，无正文内容泄漏', () => {
  const nodes = [user('u1', 1), turnProcess('tp1', 1), toolCall('t1', 1), step('s1', 1, REASONING), turnTail('tt1', 1)];
  const snap = snapshot(nodes);
  const html = renderSeat(fold.assistantSeat, { node: nodes[3], t, useChat: () => snap });
  assert.ok(html.includes('data-dsh-hidden-turn'), '隐藏过程步渲染隐藏标记（:has 规则收掉座位）');
  assert.ok(!html.includes('dsh-assistant-root'), '无正文内容');
  assert.ok(!html.includes('dsh-think'), '思维链不溢出到对话流');
  const bar = renderSeat(fold.turnProcessSeat, { node: nodes[1], t, useChat: () => snap });
  assert.equal(labelOf(bar), '1 个工具调用', '该轮折叠栏存在、可展开');
});

// ---------- T-C1 正文座位永不隐藏 ----------

test('T-C1 正文座位永不隐藏：折叠段落账时正文渲染且正文内思维链联动收起', () => {
  const nodes = [user('u1', 1), toolCall('t1', 1), step('b1', 1, REASONING_TEXT), turnTail('tt1', 1)];
  const snap = snapshot(nodes);
  const html = renderSeat(fold.assistantSeat, { node: nodes[2], t, useChat: () => snap });
  assert.ok(html.includes('dsh-assistant-root'), '正文始终渲染');
  assert.ok(!html.includes('data-dsh-hidden-turn'));
  assert.ok(!html.includes('dsh-think'), '正文内思维链随其前段收起联动隐藏');
});

test('T-C1 纯问答正文：无栏、思维链不受联动', () => {
  const nodes = [user('u1', 1), step('b1', 1, TEXT_ONLY), turnTail('tt1', 1)];
  const snap = snapshot(nodes);
  const html = renderSeat(fold.assistantSeat, { node: nodes[1], t, useChat: () => snap });
  assert.ok(html.includes('dsh-assistant-root'));
  assert.ok(!html.includes('dsh-turnfold'), '纯问答无栏');
  assert.ok(!html.includes('data-dsh-hidden-turn'));
});

// ---------- T-B5/B17 隐藏标记收座位 ----------

test('T-B5/B17 隐藏过程步无栏时渲染零高标记（收掉座位盒子），有栏时只渲染栏', () => {
  // 无栏：中止轮内的非预览思维链步
  const noBar = [user('u1', 1), turnProcess('tp1', 1), step('s0', 1, REASONING), step('s1', 1, REASONING), turnTail('tt1', 1)];
  const html1 = renderSeat(fold.assistantSeat, { node: noBar[2], t, useChat: () => snapshot(noBar) });
  assert.ok(html1.includes('data-dsh-hidden-turn'), '无锚定栏的隐藏过程步 → 隐藏标记');
  assert.ok(!html1.includes('dsh-turnfold'));
  // 有栏（B2④a）：steering 后段首步是插件过程步 → 座位保持可见、只渲染栏
  const withBar = [user('u1', 1), step('b1', 1, TEXT_ONLY), step('s1', 1, REASONING), makeNode('steering', 'steer1', 1, {}), step('s2', 1, REASONING), toolCall('t2', 1), step('b2', 1, TEXT_ONLY), turnTail('tt1', 1)];
  const html2 = renderSeat(fold.assistantSeat, { node: withBar[4], t, useChat: () => snapshot(withBar) });
  assert.equal(labelOf(html2), '1 个工具调用 · 1 条消息', '隐藏过程步仍可锚定栏');
  assert.ok(html2.includes('data-seg-key="b2"'));
  assert.ok(!html2.includes('dsh-assistant-root'), '座位内只渲染栏，不渲染内容');
});

// ---------- T-F3/T-A2 非 fold 模式零介入 ----------

test('T-F3/T-A2 非 fold 模式：座位按官方语义渲染，无插件栏/隐藏标记', () => {
  const nodes = [user('u1', 1), turnProcess('tp1', 1), toolCall('t1', 1), step('s1', 1, REASONING), turnTail('tt1', 1)];
  const snap = snapshot(nodes);
  const html = renderSeat(compact.assistantSeat, { node: nodes[3], t, useChat: () => snap });
  assert.ok(html.includes('dsh-assistant-root'), '过程步按官方 markdown 渲染');
  assert.ok(html.includes('dsh-think'), '思维链官方展示');
  assert.ok(!html.includes('dsh-turnfold') && !html.includes('data-dsh-hidden-turn'));
  const tp = renderSeat(compact.turnProcessSeat, { node: nodes[1], t, useChat: () => snap, turnProcess: null });
  assert.equal(tp, '', 'turn-process 座位在非 fold 模式无插件输出');
  const tpOfficial = renderSeat(compact.turnProcessSeat, {
    node: nodes[1], t, useChat: () => snap,
    turnProcess: { foldable: true, open: false, setOpen: () => { } },
  });
  assert.ok(tpOfficial.includes('dsh-turnfold-official'), '官方 turn-process 控件复刻渲染');
});

// ---------- T-F1/T-F2 设置页 ----------

test('T-F1/T-F2 「对话折叠」设置页：18 行类型开关，默认豁免行 aria-checked=false', () => {
  const html = renderSeat(fold.settingsSection, {});
  const rows = html.match(/class="dsh-fs-row"/g) ?? [];
  assert.equal(rows.length, 18, '18 行类型开关');
  assert.ok(html.includes('aria-label="折叠 Bash / Shell 命令"'), 'bash 默认折叠');
  assert.ok(html.includes('aria-label="不折叠 上下文注入"'), 'context 默认豁免');
  assert.ok(html.includes('aria-label="不折叠 系统提示词"'));
  assert.ok(html.includes('aria-label="折叠 思维链"'));
  assert.ok(!html.includes('data-dsh-debug-error'));
});

test('T-A2 影子「对话显示」行：fold 模式下选择器显示 Fold', () => {
  const html = renderSeat(fold.transcriptRow, { t, setTranscriptView: () => { } });
  assert.ok(html.includes('dsh-tv-selector'), '选择器按钮渲染');
  assert.ok(html.includes('>Fold</button>'), '选中 fold 时按钮文案为 Fold');
  assert.ok(html.includes('对话显示'), '行标题为官方文案');
});

// ---------- M7/M12/M13 store 与 WeakMap 缓存（直调座位触发 setSegExpanded） ----------

// 从座位返回的元素树里找折叠栏按钮。子组件链 ProcessFold → FoldButton →
// 图标桩均无 hooks，可在渲染器外展开；onClick 内部调用 bundle 的
// setSegExpanded（变异 M7 的拷贝语义 / M12 的缓存版本键都从这里触发）。
// 注意：原始元素树不摊平嵌套数组（barElsOf 的返回值本身就是数组孩子）。
function foldButtons(el, out = []) {
  if (Array.isArray(el)) {
    for (const kid of el) foldButtons(kid, out);
    return out;
  }
  if (!el || typeof el !== 'object') return out;
  if (typeof el.type === 'function') return foldButtons(el.type(el.props), out);
  if (el.type === 'button' && typeof el.props.onClick === 'function' &&
    String(el.props.className || '').includes('dsh-turnfold')) {
    out.push(el);
  }
  const kids = el.props ? el.props.children : null;
  if (Array.isArray(kids)) for (const kid of kids) foldButtons(kid, out);
  else if (kids) foldButtons(kids, out);
  return out;
}

function clickBar(seat, node, snap, segKey) {
  const buttons = foldButtons(seat({ node, t, useChat: () => snap }));
  const bar = buttons.find((b) => b.props['data-seg-key'] === segKey);
  assert.ok(bar, '渲染出栏 ' + segKey + '（实际: ' + buttons.map((b) => b.props['data-seg-key']).join(',') + '）');
  bar.props.onClick({});
}

test('M7 setSegExpanded 拷贝语义：连续展开三段，前两段展开状态保持', async () => {
  const { turnProcessSeat, assistantSeat } = await bootSeats({ displayMode: 'fold', auxVisible: ['context', 'skill', 'system-prompt'] }, clickFacade);
  const nodes = [user('u1', 1), turnProcess('tp1', 1), toolCall('t1', 1), step('b1', 1, TEXT_ONLY), toolCall('t2', 1), step('b2', 1, TEXT_ONLY), toolCall('t3', 1), step('b3', 1, TEXT_ONLY), turnTail('tt1', 1)];
  const snap = snapshot(nodes);
  // 三段的栏锚点各不相同（B2③ 轮顶座位 / B2② 前一正文下方），展开动作
  // 分跨三个座位渲染面——更贴近真实点击路径。
  const barSeat = { b1: turnProcessSeat, b2: assistantSeat, b3: assistantSeat };
  const barNode = { b1: nodes[1], b2: nodes[3], b3: nodes[5] };
  const assertOpen = (seg, open, message) => {
    const html = renderSeat(barSeat[seg], { node: barNode[seg], t, useChat: () => snap });
    if (open) assert.match(html, new RegExp('data-open="true" data-seg-key="' + seg + '"'), message);
    else assert.match(html, new RegExp('data-seg-key="' + seg + '" aria-expanded="false"'), message);
  };
  for (const seg of ['b1', 'b2', 'b3']) assertOpen(seg, false, seg + ' 初始收起');
  // 每次点击都取自最新一次直调渲染的元素树（onClick 闭包捕获当时的展开状态）。
  for (const seg of ['b1', 'b2', 'b3']) clickBar(barSeat[seg], barNode[seg], snap, seg);
  for (const seg of ['b1', 'b2', 'b3']) {
    assertOpen(seg, true, seg + ' 仍展开——变异把 new Map(segStore.get()) 改成 new Map() 丢弃旧值时 b1/b2 在此失败');
  }
});

test('M12 段展开版本使 WeakMap 缓存失效：展开后收起段的过程步可见', async () => {
  const { turnProcessSeat, assistantSeat } = await bootSeats({ displayMode: 'fold', auxVisible: ['context', 'skill', 'system-prompt'] }, clickFacade);
  const nodes = [user('u1', 1), turnProcess('tp1', 1), toolCall('t1', 1), step('s1', 1, REASONING), turnTail('tt1', 1)];
  const snap = snapshot(nodes);
  // ① 同一快照对象身份先投影一次（缓存 segVersion=0 的投影；中止轮尾段
  //    segKey=t1:open，轮已闭合 → F3 无预览，思维链步隐藏）。
  assert.ok(renderSeat(assistantSeat, { node: nodes[3], t, useChat: () => snap }).includes('data-dsh-hidden-turn'),
    '收起的闭合尾段：思维链步渲染隐藏占位');
  // ② 经栏点击触发 setSegExpanded → segStore version 递增（变异把缓存键
  //    === 改 <= 时，这一步之后缓存不再失效）。
  clickBar(turnProcessSeat, nodes[1], snap, 't1:open');
  // ③ 同一快照对象身份再次投影：缓存键 segVersion 已变 → 必须基于同一
  //    timeline 重建投影，内容反映新状态。
  const html = renderSeat(assistantSeat, { node: nodes[3], t, useChat: () => snap });
  assert.ok(!html.includes('data-dsh-hidden-turn'), '展开后隐藏标记消失（命中陈旧缓存时仍隐藏）');
  assert.ok(html.includes('dsh-think'), '展开后思维链内容渲染（F5）');
});

test('M13 豁免表版本使 WeakMap 缓存失效：think 豁免后收起段内思维链可见', async () => {
  const { client, assistantSeat } = await bootSeats({ displayMode: 'fold', auxVisible: ['context', 'skill', 'system-prompt'] }, clickFacade);
  const nodes = [user('u1', 1), turnProcess('tp1', 1), step('s0', 1, REASONING), turnTail('tt1', 1)];
  const snap = snapshot(nodes);
  // ① 同一快照对象身份先投影一次（缓存 configVersion=0 的投影）。
  assert.ok(renderSeat(assistantSeat, { node: nodes[2], t, useChat: () => snap }).includes('data-dsh-hidden-turn'),
    'think 默认折叠：收起段内思维链隐藏');
  // ② 豁免表变更 → auxStore version 递增（变异把缓存键 === 改 <= 时不失效）。
  client.__test.setAuxVisible(['context', 'skill', 'system-prompt', 'think']);
  // ③ 同一快照对象身份再次投影：必须重建并反映新豁免表（F2）。
  const html = renderSeat(assistantSeat, { node: nodes[2], t, useChat: () => snap });
  assert.ok(!html.includes('data-dsh-hidden-turn'), '缓存未失效时仍渲染隐藏占位');
  assert.ok(html.includes('dsh-think'), 'think 豁免后收起段内思维链保持显示');
});
