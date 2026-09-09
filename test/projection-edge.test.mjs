// M 层补充回归（REGRESSION.md 条目的机械化部分）——model.test.mjs 未覆盖的
// 分支/边界：T-B3 锚定回退链、T-B4 多段独立展开、T-C1 分类边界、T-C2 计数、
// T-C3 中止轮变体、T-C4 隐藏样式覆盖不变量、T-D3 补页稳定、T-E1/E2 流式、
// T-G2 steering 计数、多轮轨迹与 R1 守卫。每条用例名以条目 ID 开头。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClient, makeNode, makeStore, resetSeq } from './helpers/load-client.mjs';

const client = await loadClient();
const { buildTimeline, projectView, classifyNode, auxKeyOfNode, auxTypes } = client.__test;

function user(key, turn) { return makeNode('user', key, turn, {}); }
function steering(key, turn) { return makeNode('steering', key, turn, {}); }
function step(key, turn, blocks) { return makeNode('assistant-step', key, turn, { blocks, status: 'settled' }); }
function toolCall(key, turn, name = 'bash') { return makeNode('tool-call', key, turn, { root: { name } }); }
function context(key, turn) { return makeNode('context', key, turn, {}); }
function turnTail(key, turn) { return makeNode('turn-tail', key, turn, {}); }
function turnProcess(key, turn) { return makeNode('turn-process', key, turn, {}); }

const REASONING = [{ kind: 'reasoning', text: 'thinking…' }];
const REASONING_TEXT = [{ kind: 'reasoning', text: 'thinking…' }, { kind: 'text', text: 'answer' }];
const TEXT_ONLY = [{ kind: 'text', text: 'answer' }];
const IMAGE_ONLY = [{ kind: 'image', attachment: {} }];

function project(nodes, ui = {}) {
  const order = nodes.map((node) => node.key);
  const timeline = buildTimeline(order, makeStore(nodes));
  return projectView(timeline, {
    active: true,
    // 默认与官方 DEFAULT_AUX_VISIBLE 对齐（context/skill/system-prompt 豁免）；
    // 需要全折叠场景的用例显式传 () => false。
    auxVisible: ui.auxVisible || ((key) => key === 'context' || key === 'skill' || key === 'system-prompt'),
    isExpanded: ui.expanded || (() => false),
  });
}

function viewOf(proj, key) { return proj.views.get(key); }
function turnModel(proj, turn = 1) { return proj.timeline.turns.find((m) => m.turn === turn); }
function proj_text_has_key(proj, key) { return proj.styleText.includes('"' + key + '"'); }

// ---------- T-B3 栏锚定回退链的未覆盖分支 ----------

test('T-B3 ④b steering 后段首步是官方渲染、段开放（无封口正文）：栏回退到 prevBody 下方', () => {
  resetSeq();
  const nodes = [user('u1', 1), step('b1', 1, TEXT_ONLY), toolCall('t1', 1), steering('steer1', 1), toolCall('t2', 1)];
  const proj = project(nodes);
  const segs = turnModel(proj).segments;
  assert.deepEqual(segs.map((s) => s.segKey), ['steer1', 't1:open']);
  // 两段的栏都落座封口正文 b1 下方：闭合段走 ②（startCtx=body），开放段走 ④ 回退链
  assert.deepEqual(proj.barsByAnchor.get('b1'), [
    { segKey: 'steer1', toolCalls: 1, messages: 0, pos: 'after' },
    { segKey: 't1:open', toolCalls: 1, messages: 0, pos: 'after' },
  ]);
});

test('T-B3 ④ 开放段、段首步官方渲染且无 prevBody：回退轮 turn-process 座位', () => {
  resetSeq();
  const nodes = [user('u1', 1), turnProcess('tp1', 1), steering('steer1', 1), toolCall('t2', 1)];
  const proj = project(nodes);
  assert.deepEqual(proj.barsByAnchor.get('tp1'), [{ segKey: 't1:open', toolCalls: 1, messages: 0, pos: 'before' }]);
});

test('T-B3 ④ 段首步是插件过程步且段开放：栏落座该步上方（④a 开放变体）', () => {
  resetSeq();
  const nodes = [user('u1', 1), step('b1', 1, TEXT_ONLY), steering('steer1', 1), step('s2', 1, REASONING), toolCall('t2', 1)];
  const proj = project(nodes);
  assert.deepEqual(proj.barsByAnchor.get('s2'), [{ segKey: 't1:open', toolCalls: 1, messages: 0, pos: 'before' }]);
});

test('T-B3 ③ 兜底耗尽：流式轮缺 turn-process 与正文 → 不落栏', () => {
  resetSeq();
  const proj = project([user('u1', 1), toolCall('t1', 1), step('s1', 1, REASONING)]);
  assert.equal(proj.barsByAnchor.size, 0, '开放段 endType=open 时 bodyAnchor 为 null，回退链走完返回 null');
});

test('T-B3 ②③ 过程段+思维链正文封口、无 turn-process：栏落座封口正文上方', () => {
  resetSeq();
  const nodes = [user('u1', 1), toolCall('t1', 1), step('b1', 1, REASONING_TEXT), turnTail('tt1', 1)];
  const proj = project(nodes);
  assert.deepEqual(proj.barsByAnchor.get('b1'), [{ segKey: 'b1', toolCalls: 1, messages: 1, pos: 'before' }]);
  assert.equal(proj.timeline.bodySeg.b1, 'b1');
});

// ---------- T-B4 每段独立展开 ----------

test('T-B4 三段轮只展开中段：其余两段保持收起（隐藏规则精确覆盖）', () => {
  resetSeq();
  const nodes = [
    user('u1', 1), turnProcess('tp1', 1),
    toolCall('t1', 1), step('b1', 1, TEXT_ONLY),
    toolCall('t2', 1), step('b2', 1, TEXT_ONLY),
    toolCall('t3', 1), turnTail('tt1', 1),
  ];
  const proj = project(nodes, { expanded: (key) => key === 'b2' });
  assert.equal(viewOf(proj, 't1').visible, false);
  assert.equal(viewOf(proj, 't2').visible, true, '仅展开段可见');
  assert.equal(viewOf(proj, 't3').visible, false);
  assert.ok(proj.styleText.includes('"t1"') && proj.styleText.includes('"t3"'), '未展开段生成隐藏规则');
  assert.ok(!proj.styleText.includes('"t2"'), '展开段不生成隐藏规则');
});

// ---------- T-C1 正文永不折叠：分类边界 ----------

test('T-C1 classifyNode 边界：image/未知块算正文，reasoning+tool-call 块是过程，空块是空载步', () => {
  resetSeq();
  assert.equal(classifyNode(step('a', 1, IMAGE_ONLY)), 'body', '图片块是可见正文');
  assert.equal(classifyNode(step('b', 1, [{ kind: 'unknown-payload' }])), 'body', '未知块类型按正文渲染（JsonBlock）');
  assert.equal(classifyNode(step('c', 1, [undefined, null, { kind: 'text' }])), 'body', 'undefined/null 块跳过后仍算正文');
  assert.equal(classifyNode(step('d', 1, [{ kind: 'reasoning' }, { kind: 'tool-call' }])), 'process', '仅 reasoning+tool-call 块不升级为正文');
  assert.equal(classifyNode(step('e', 1, [])), 'empty-step');
  assert.equal(classifyNode(makeNode('assistant-step', 'f', 1, {})), 'empty-step', '无 blocks 字段（makeNode 默认 data 不含 blocks）');
  assert.equal(classifyNode(null), 'skip');
});

test('T-C1 图片正文不进隐藏样式、封段落账', () => {
  resetSeq();
  const nodes = [user('u1', 1), toolCall('t1', 1), step('b1', 1, IMAGE_ONLY), turnTail('tt1', 1)];
  const proj = project(nodes);
  assert.ok(!proj_text_has_key(proj, 'b1'));
  assert.equal(proj.timeline.bodySeg.b1, 'b1');
});

// ---------- T-C2 计数与实际一致 ----------

test('T-C2 skill 工具调用不计入栏计数、默认豁免不生成隐藏规则', () => {
  resetSeq();
  const nodes = [user('u1', 1), turnProcess('tp1', 1), toolCall('sk1', 1, 'skill'), toolCall('t1', 1), toolCall('t2', 1), step('b1', 1, TEXT_ONLY), turnTail('tt1', 1)];
  const proj = project(nodes);
  const seg = turnModel(proj).segments[0];
  assert.deepEqual(seg.keys, ['sk1', 't1', 't2']);
  assert.equal(seg.steps, 2, 'skill 是辅助项不计步数');
  assert.equal(seg.toolCalls, 2, 'skill 不计入「N 个工具调用」');
  assert.deepEqual(proj.barsByAnchor.get('tp1'), [{ segKey: 'b1', toolCalls: 2, messages: 1, pos: 'before' }]);
  assert.ok(!proj_text_has_key(proj, 'sk1'), '默认豁免 skill → 无隐藏规则（官方渲染保持可见）');
  assert.ok(proj_text_has_key(proj, 't1'));
  assert.equal(viewOf(proj, 'sk1').role, 'process');
});

// ---------- T-C3 中止/中断轮 ----------

test('T-C3 turn-tail 之后到达的步骤仍属中止轮尾段：无预览、全部隐藏', () => {
  resetSeq();
  const nodes = [user('u1', 1), turnProcess('tp1', 1), toolCall('t1', 1), turnTail('tt1', 1), toolCall('t2', 1), step('s1', 1, REASONING)];
  const proj = project(nodes);
  const model = turnModel(proj);
  assert.equal(model.closed, true);
  assert.equal(model.segments.length, 1, 'turn-tail 不封段，其后步骤并入同一尾段');
  assert.deepEqual(model.segments[0].keys, ['t1', 't2', 's1']);
  assert.equal(viewOf(proj, 't2').visible, false, '轮已闭合 → latestKey 不作预览（F3）');
  assert.equal(viewOf(proj, 's1').visible, false);
  assert.ok(proj.styleText.includes('"t1"') && proj.styleText.includes('"t2"'));
});

// ---------- T-C4 加载历史后过程不溢出：样式覆盖不变量 ----------

test('T-C4 不变量：非豁免的官方渲染节点隐藏时必有规则、可见时必无规则（翻页前后均成立）', () => {
  resetSeq();
  const full = [
    user('u0', 0), toolCall('t0a', 0), context('c0', 0), step('b0', 0, TEXT_ONLY), turnTail('tt0', 0),
    user('u1', 1), turnProcess('tp1', 1), toolCall('t1', 1), step('s1', 1, REASONING), toolCall('t2', 1), turnTail('tt1', 1),
  ];
  const initial = full.filter((n) => n.key !== 'u0' && n.key !== 't0a');
  for (const [label, nodes] of [['initial', initial], ['full', full]]) {
    const proj = project(nodes);
    let visibleToolCalls = 0;
    for (const node of nodes) {
      if (node.kind !== 'tool-call' && node.kind !== 'context' && node.kind !== 'system-prompt') continue;
      const hidden = proj_text_has_key(proj, node.key);
      if (node.kind === 'context') {
        assert.ok(!hidden, label + ': context 默认豁免不生成规则');
        continue;
      }
      if (!hidden) visibleToolCalls += 1;
      assert.equal(viewOf(proj, node.key).visible, false, label + ': 收起态 tool-call 视图不可见');
      assert.ok(hidden, label + ': 隐藏 tool-call 必须有动态规则（不存在「无规则却可见」）');
    }
    assert.equal(visibleToolCalls, 0, label + ': 折叠态可见 tool-call 数为 0');
  }
});

// ---------- T-D3 停止条件（S2 观测面） ----------

test('T-D3 初次加载切在轮中段：segKey 与栏锚点跨补页稳定（S1/S2 观测不变）', () => {
  resetSeq();
  const storeNodes = [user('u0', 0), toolCall('t0', 0), step('b0', 0, TEXT_ONLY), turnTail('tt0', 0), user('u1', 1), turnProcess('tp1', 1), toolCall('t1', 1), step('b1', 1, TEXT_ONLY), turnTail('tt1', 1)];
  const partial = buildTimeline(['t0', 'b0', 'tt0', 'u1', 'tp1', 't1', 'b1', 'tt1'], makeStore(storeNodes));
  const full = buildTimeline(storeNodes.map((n) => n.key), makeStore(storeNodes));
  assert.equal(partial.segByKey.b0.segKey, 'b0');
  assert.equal(full.segByKey.b0.segKey, 'b0', '补页后同段 segKey 不变');
  assert.equal(partial.segByKey.b0.steps, 1);
  assert.equal(full.segByKey.b0.steps, 1);
  const ui = { active: true, auxVisible: () => false, isExpanded: () => false };
  const partialProj = projectView(partial, ui);
  const fullProj = projectView(full, ui);
  const expected = [{ segKey: 'b0', toolCalls: 1, messages: 1, pos: 'before' }];
  assert.deepEqual(partialProj.barsByAnchor.get('b0'), expected, '首页（轮中段切入）锚点=封口正文上方');
  assert.deepEqual(fullProj.barsByAnchor.get('b0'), expected, '补页后锚点不变');
});

// ---------- T-E1/E2 流式与收敛 ----------

test('T-E1 流式多隐藏步：全部 tool-call 有规则（空档不随步数增大），思维链步走 React 隐藏', () => {
  resetSeq();
  const nodes = [user('u1', 1), turnProcess('tp1', 1), step('s0', 1, REASONING), toolCall('t1', 1), toolCall('t2', 1), step('s1', 1, REASONING)];
  const proj = project(nodes);
  assert.equal(viewOf(proj, 's1').visible, true, '预览 = 最近一条过程步（F4）');
  assert.equal(viewOf(proj, 's0').visible, false);
  assert.equal(viewOf(proj, 't1').visible, false);
  assert.equal(viewOf(proj, 't2').visible, false);
  assert.ok(proj.styleText.includes('"t1"') && proj.styleText.includes('"t2"'), '两个隐藏 tool-call 都有规则');
  assert.ok(!proj.styleText.includes('"s0"') && !proj.styleText.includes('"s1"'), 'assistant-step 隐藏走 React 隐藏标记，不生成 CSS 规则');
});

test('T-E2 预览收敛：轮闭合后流式预览隐藏（多过程步同样收敛）', () => {
  resetSeq();
  const nodes = [user('u1', 1), turnProcess('tp1', 1), step('s0', 1, REASONING), toolCall('t1', 1), toolCall('t2', 1), step('s1', 1, REASONING), turnTail('tt1', 1)];
  const proj = project(nodes);
  assert.equal(viewOf(proj, 's1').visible, false, '轮结束 → 预览收敛隐藏');
  assert.equal(viewOf(proj, 's0').visible, false);
  assert.ok(proj.styleText.includes('"t1"') && proj.styleText.includes('"t2"'));
});

test('T-E2/F5 流式中展开尾段：展开优先于预览，全段可见且无隐藏规则', () => {
  resetSeq();
  const nodes = [user('u1', 1), turnProcess('tp1', 1), toolCall('t1', 1), toolCall('t2', 1), step('s1', 1, REASONING)];
  const proj = project(nodes, { expanded: (key) => key === 't1:open' });
  for (const key of ['t1', 't2', 's1']) {
    assert.equal(viewOf(proj, key).visible, true, key + ' 展开后可见');
  }
  assert.equal(proj.styleText, '', '展开段不生成任何隐藏规则');
});

// ---------- T-G2 steering 计数互不包含 ----------

test('T-G2 steering 前后两栏计数独立（2+1 工具调用）', () => {
  resetSeq();
  const nodes = [user('u1', 1), turnProcess('tp1', 1), toolCall('t1', 1), toolCall('t2', 1), steering('steer1', 1), toolCall('t3', 1), turnTail('tt1', 1)];
  const proj = project(nodes);
  const segs = turnModel(proj).segments;
  assert.deepEqual(segs.map((s) => s.segKey), ['steer1', 't1:open']);
  assert.equal(segs[0].toolCalls, 2);
  assert.equal(segs[1].toolCalls, 1);
  assert.deepEqual(proj.barsByAnchor.get('tp1'), [
    { segKey: 'steer1', toolCalls: 2, messages: 0, pos: 'before' },
    { segKey: 't1:open', toolCalls: 1, messages: 0, pos: 'before' },
  ]);
});

// ---------- 多轮轨迹（T-C4/T-G2 的结构前提） ----------

test('多轮轨迹：轮模型按首现排序，跨轮栏锚点互不串扰', () => {
  resetSeq();
  const nodes = [
    user('u1', 1), turnProcess('tp1', 1), toolCall('t1', 1), step('b1', 1, TEXT_ONLY), turnTail('tt1', 1),
    user('u2', 2), turnProcess('tp2', 2), toolCall('t2', 2), turnTail('tt2', 2),
  ];
  const proj = project(nodes);
  assert.deepEqual(proj.timeline.turns.map((m) => m.turn), [1, 2]);
  assert.equal(proj.timeline.turns[0].closed, true);
  assert.equal(proj.timeline.turns[1].closed, true);
  assert.deepEqual(proj.barsByAnchor.get('tp1'), [{ segKey: 'b1', toolCalls: 1, messages: 1, pos: 'before' }], '轮 1：过程段被正文封口，栏在轮 turn-process 座位');
  assert.equal(proj.barsByAnchor.has('b1'), false, '轮 1 无流式尾段（正文后只有 turn-tail）→ 正文无下方栏');
  assert.deepEqual(proj.barsByAnchor.get('tp2'), [{ segKey: 't2:open', toolCalls: 1, messages: 0, pos: 'before' }], '轮 2：中止轮尾段栏在轮顶座位');
});

// ---------- R1 守卫 ----------

test('R1 守卫：order 幽灵键与 session 级节点（无 turn 定位）被跳过', () => {
  resetSeq();
  const sessionNode = makeNode('command', 'cmd1', null, {});
  const nodes = [user('u1', 1), toolCall('t1', 1), turnTail('tt1', 1)];
  const order = ['u1', 'ghost', sessionNode.key, 't1', 'tt1'];
  const timeline = buildTimeline(order, makeStore([...nodes, sessionNode]));
  assert.equal(timeline.turns.length, 1);
  assert.deepEqual(timeline.segByKey['t1:open'].keys, ['t1'], '幽灵键不入段，session 级节点不参与分段');
});

// ---------- §1 匹配表完整性（T-F2 的表驱动对账） ----------

test('§1 匹配表完整性：每个 names/kinds 条目可反查、全表无重名、18 行设置页', () => {
  resetSeq();
  const seen = new Map();
  for (const rule of auxTypes) {
    for (const name of rule.names ?? []) {
      assert.ok(!seen.has(name), '工具名 ' + name + ' 重复登记（先匹配者赢，后者开关永远无效）');
      seen.set(name, rule.key);
      assert.equal(auxKeyOfNode(toolCall('x', 1, name)), rule.key, 'names 条目 ' + name + ' 应反查回 ' + rule.key);
    }
    for (const kind of rule.kinds ?? []) {
      assert.equal(auxKeyOfNode(makeNode(kind, 'y', 1, {})), rule.key, 'kinds 条目 ' + kind + ' 应反查回 ' + rule.key);
    }
  }
  const processRules = auxTypes.filter((rule) => rule.process === true);
  assert.equal(processRules.length, 1, 'process 匹配规则唯一');
  assert.equal(processRules[0].key, 'think');
  assert.equal(auxTypes.length, 18, 'T-F1：「对话折叠」设置页 18 行类型开关');
});

test('§1 工具名回退到 root.call.name 并大小写归一；无名工具始终折叠', () => {
  resetSeq();
  const { auxKeyOfNode: auxKeyOf } = client.__test;
  assert.equal(auxKeyOf(makeNode('tool-call', 'a', 1, { root: { call: { name: 'PWSH' } } })), 'bash', 'call.name 回退 + 大小写归一');
  assert.equal(auxKeyOf(makeNode('tool-call', 'b', 1, { root: {} })), undefined, '无注册名 → 无匹配表开关（始终折叠）');
  const proj = project([user('u1', 1), makeNode('tool-call', 't1', 1, { root: {} }), turnTail('tt1', 1)]);
  assert.ok(proj_text_has_key(proj, 't1'), '无名 tool-call 收起时进隐藏样式');
});
