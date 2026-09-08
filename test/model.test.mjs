// 轨迹模型 / 视图投影的边界条件回归（REGRESSION.md 条目的机械化部分）。
// 每个用例对应一条模型规则 R / 过滤规则 F / 栏规则 B，注释里标注对应条目。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClient, makeNode, makeStore, resetSeq } from './helpers/load-client.mjs';

const client = await loadClient();
const { buildTimeline, projectView } = client.__test;

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

function project(nodes, ui = {}) {
  const order = nodes.map((node) => node.key);
  const timeline = buildTimeline(order, makeStore(nodes));
  return projectView(timeline, {
    active: true,
    auxVisible: ui.auxVisible || (() => false),
    isExpanded: ui.expanded || (() => false),
  });
}

function viewOf(proj, key) { return proj.views.get(key); }

test('R2/R5 流式开放轮：尾段 open，收起仅保留最近一条预览（F4）', () => {
  resetSeq();
  const nodes = [user('u1', 1), toolCall('t1', 1), step('s1', 1, REASONING), toolCall('t2', 1)];
  const proj = project(nodes);
  const model = proj.timeline.turnByKey[1];
  assert.equal(model.closed, false);
  assert.equal(model.segments.length, 1);
  assert.equal(model.segments[0].endType, 'open');
  assert.equal(model.segments[0].segKey, 't1:open');
  assert.equal(viewOf(proj, 't1').state, 'hidden');
  assert.equal(viewOf(proj, 't2').state, 'preview');
  assert.equal(viewOf(proj, 's1').state, 'hidden');
  // 预览键不进隐藏样式
  assert.ok(!proj.styleText.includes('"t2"'));
  assert.ok(proj.styleText.includes('"t1"'));
});

test('R3 中止轮（B10 收起方向 F3）：闭合后尾段全部隐藏、无预览', () => {
  resetSeq();
  const nodes = [user('u1', 1), toolCall('t1', 1), step('s1', 1, REASONING), turnTail('tt1', 1)];
  const proj = project(nodes);
  const model = proj.timeline.turnByKey[1];
  assert.equal(model.closed, true, 'turn-tail 即闭合，不要求 closing 正文');
  const seg = model.segments[0];
  assert.equal(seg.endType, 'open');
  assert.equal(viewOf(proj, 't1').state, 'hidden');
  assert.equal(viewOf(proj, 's1').state, 'hidden');
  assert.ok(proj.styleText.includes('"t1"'), '失败 tool-call 必须进隐藏样式');
});

test('B10 展开方向 F5：中止轮展开后全部步骤可见', () => {
  resetSeq();
  const nodes = [user('u1', 1), toolCall('t1', 1), step('s1', 1, REASONING), turnTail('tt1', 1)];
  const segKey = 't1:open';
  const proj = project(nodes, { expanded: (key) => key === segKey });
  assert.equal(viewOf(proj, 't1').state, 'visible');
  assert.equal(viewOf(proj, 's1').state, 'visible');
  assert.equal(proj.styleText, '', '展开段不得生成任何隐藏规则');
});

test('I1/R2 Ctrl+Enter steering 边界开启新段（T-G1）：插入点前后分属两栏', () => {
  resetSeq();
  const nodes = [
    user('u1', 1),
    turnProcess('tp1', 1),
    toolCall('t1', 1),
    step('s1', 1, REASONING),
    steering('steer1', 1),
    toolCall('t2', 1),
    step('s2', 1, REASONING),
    turnTail('tt1', 1),
  ];
  const proj = project(nodes);
  const segs = proj.timeline.turnByKey[1].segments;
  assert.equal(segs.length, 2, 'steering 封口前段并开启新段');
  assert.equal(segs[0].segKey, 'steer1');
  assert.deepEqual(segs[0].keys, ['t1', 's1']);
  assert.equal(segs[1].endType, 'open', 'steering 后无正文 → 新的开放尾段');
  assert.deepEqual(segs[1].keys, ['t2', 's2']);
  // B2：两段之前都无正文 → 兜底锚点 = 轮 turn-process 键（轮顶），各一栏
  assert.deepEqual(proj.barsByAnchor.get('tp1'), [
    { segKey: 'steer1', toolCalls: 1, messages: 0, pos: 'before' },
    { segKey: 't1:open', toolCalls: 1, messages: 0, pos: 'before' },
  ]);
  // 收起态：两段各自隐藏，互不预览（轮已闭合）
  assert.equal(viewOf(proj, 't1').state, 'hidden');
  assert.equal(viewOf(proj, 't2').state, 'hidden');
});

test('B2/B16 栏锚定段首：展开步骤在栏下方（官方一致），收起紧贴其后正文（T-B4/T-C2）', () => {
  resetSeq();
  const nodes = [
    user('u1', 1),
    turnProcess('tp1', 1),
    toolCall('t1', 1),
    step('b1', 1, REASONING_TEXT),
    toolCall('t2', 1),
    step('b2', 1, TEXT_ONLY),
    turnTail('tt1', 1),
  ];
  const proj = project(nodes);
  const segs = proj.timeline.turnByKey[1].segments;
  assert.deepEqual(segs.map((s) => s.segKey), ['b1', 'b2']);
  assert.equal(segs[0].toolCalls, 1);
  assert.equal(segs[0].messages, 1);
  assert.equal(segs[1].toolCalls, 1);
  // 轮首段（段前是 user 边界）→ 锚点=轮 turn-process（收起时紧贴其后正文 b1）
  assert.deepEqual(proj.barsByAnchor.get('tp1'), [{ segKey: 'b1', toolCalls: 1, messages: 1, pos: 'before' }]);
  // 正文后的段 → 锚点=前一个正文下方（= 段首上方；收起时紧贴其后正文 b2）
  assert.deepEqual(proj.barsByAnchor.get('b1'), [{ segKey: 'b2', toolCalls: 1, messages: 1, pos: 'after' }]);
  assert.equal(proj.barsByAnchor.size, 2, '栏只落座在段首附近的插件座位，无轮级聚合');
  assert.equal(viewOf(proj, 'b1').role, 'body');
  assert.equal(viewOf(proj, 'b2').role, 'body');
});

test('F1 正文永不进隐藏样式，正文内思维链随前段联动（T-C1）', () => {
  resetSeq();
  const nodes = [user('u1', 1), toolCall('t1', 1), step('b1', 1, REASONING_TEXT), turnTail('tt1', 1)];
  const collapsed = project(nodes);
  assert.ok(!proj_text_has_key(collapsed, 'b1'), '正文键不得出现在隐藏规则中');
  assert.equal(collapsed.timeline.bodySeg.b1, 'b1');
  const expanded = project(nodes, { expanded: (key) => key === 'b1' });
  assert.equal(expanded.styleText, '');
});

function proj_text_has_key(proj, key) {
  return proj.styleText.includes('"' + key + '"');
}

test('B1 纯问答轮（无过程、正文无思维链）无栏；正文思维链不受栏联动', () => {
  resetSeq();
  const nodes = [user('u1', 1), step('b1', 1, TEXT_ONLY), turnTail('tt1', 1)];
  const proj = project(nodes);
  assert.equal(proj.barsByAnchor.size, 0);
  assert.equal(proj.timeline.bodySeg.b1, null);
  const withThink = project([user('u1', 1), step('b1', 1, REASONING_TEXT), turnTail('tt1', 1)]);
  assert.deepEqual(withThink.barsByAnchor.get('b1'), [{ segKey: 'b1', toolCalls: 0, messages: 1, pos: 'before' }], '仅思考正文 → 正文上方「1 条消息」栏');
});

test('F2 辅助项 auxVisible 豁免：context/skill 默认隐藏，配置后可见', () => {
  resetSeq();
  const nodes = [user('u1', 1), context('c1', 1), toolCall('sk1', 1, 'skill'), toolCall('t1', 1), turnTail('tt1', 1)];
  const hidden = project(nodes);
  assert.ok(proj_text_has_key(hidden, 'c1'));
  assert.ok(proj_text_has_key(hidden, 'sk1'));
  const shown = project(nodes, { auxVisible: (key) => key === 'context' || key === 'skill' });
  assert.ok(!proj_text_has_key(shown, 'c1'));
  assert.ok(!proj_text_has_key(shown, 'sk1'));
  assert.ok(proj_text_has_key(shown, 't1'), '普通 tool-call 不受豁免影响');
});

test('S2 补点停止条件可读模型：segKey 跨翻页稳定、步骤数可查', () => {
  resetSeq();
  // 「加载更早」载入更早历史后，同一逻辑段的 segKey（= 边界正文键）不变。
  const nodes = [user('u1', 1), toolCall('t1', 1), toolCall('t2', 1), step('b1', 1, TEXT_ONLY), turnTail('tt1', 1)];
  const timeline = buildTimeline(nodes.map((n) => n.key), makeStore(nodes));
  assert.equal(timeline.segByKey.b1.steps, 2);
  assert.equal(timeline.segByKey.b1.segKey, 'b1');
  // 只有半页时同段已可见，segKey 相同
  const partial = buildTimeline(['u1', 't2', 'b1', 'tt1'], makeStore(nodes));
  assert.equal(partial.segByKey.b1.segKey, 'b1');
  assert.equal(partial.segByKey.b1.steps, 1);
});

test('R4 空段不落账 + 空载步恒隐藏', () => {
  resetSeq();
  const emptyStep = step('s0', 1, [{ kind: 'tool-call' }]);
  const nodes = [user('u1', 1), emptyStep, step('b1', 1, TEXT_ONLY), turnTail('tt1', 1)];
  const proj = project(nodes);
  assert.deepEqual(proj.timeline.turnByKey[1].segments.map((s) => s.segKey), ['b1'], '纯空载步不生成段');
  assert.equal(viewOf(proj, 's0').state, 'hidden');
  const expanded = project(nodes, { expanded: () => true });
  assert.equal(viewOf(expanded, 's0').state, 'hidden', '空载步展开也不显示');
});

test('非 active 投影不产生视图与样式（官方模式零介入）', () => {
  resetSeq();
  const nodes = [user('u1', 1), toolCall('t1', 1), turnTail('tt1', 1)];
  const order = nodes.map((node) => node.key);
  const timeline = buildTimeline(order, makeStore(nodes));
  const proj = projectView(timeline, { active: false, auxVisible: () => false, isExpanded: () => false });
  assert.equal(proj.active, false);
  assert.equal(proj.styleText, '');
  assert.equal(proj.views.size, 0);
  assert.equal(proj.barsByAnchor.size, 0);
});

test('B2 steering 封口段：锚点=前一个正文下方（pos=after，紧贴 steering 气泡上方）', () => {
  resetSeq();
  const nodes = [
    user('u1', 1),
    turnProcess('tp1', 1),
    step('b1', 1, TEXT_ONLY),
    toolCall('t1', 1),
    steering('steer1', 1),
    toolCall('t2', 1),
    step('b2', 1, TEXT_ONLY),
    turnTail('tt1', 1),
  ];
  const proj = project(nodes);
  const segs = proj.timeline.turnByKey[1].segments;
  assert.equal(segs[0].endType, 'boundary');
  assert.equal(segs[0].prevBody, 'b1', '模型记录段前最后一个正文');
  assert.deepEqual(proj.barsByAnchor.get('b1'), [{ segKey: 'steer1', toolCalls: 1, messages: 0, pos: 'after' }]);
  assert.deepEqual(proj.barsByAnchor.get('b2'), [{ segKey: 'b2', toolCalls: 1, messages: 1, pos: 'before' }]);
});

test('B2 开放尾段在正文后：锚点=该正文下方（流式中紧贴尾段步骤上方）', () => {
  resetSeq();
  const nodes = [user('u1', 1), turnProcess('tp1', 1), toolCall('t1', 1), step('b1', 1, TEXT_ONLY), toolCall('t2', 1), step('s1', 1, REASONING)];
  const proj = project(nodes);
  // 轮首段 [t1] → tp1；正文后的开放尾段 → b1 下方
  assert.deepEqual(proj.barsByAnchor.get('tp1'), [{ segKey: 'b1', toolCalls: 1, messages: 1, pos: 'before' }]);
  assert.deepEqual(proj.barsByAnchor.get('b1'), [{ segKey: 't1:open', toolCalls: 1, messages: 0, pos: 'after' }]);
});

test('B2 中止轮尾段在正文后（B10 场景）：栏在该正文下方', () => {
  resetSeq();
  const nodes = [user('u1', 1), step('b1', 1, TEXT_ONLY), toolCall('t1', 1), step('s1', 1, REASONING), turnTail('tt1', 1)];
  const proj = project(nodes);
  assert.deepEqual(proj.barsByAnchor.get('b1').map((b) => [b.segKey, b.pos]), [['t1:open', 'after']]);
});

test('B2 兜底锚点：段前无正文时落座轮 turn-process；无 turn-process 则不落栏', () => {
  resetSeq();
  const withTp = project([user('u1', 1), turnProcess('tp1', 1), toolCall('t1', 1), turnTail('tt1', 1)]);
  assert.deepEqual(withTp.barsByAnchor.get('tp1'), [{ segKey: 't1:open', toolCalls: 1, messages: 0, pos: 'before' }]);
  const noTp = project([user('u1', 1), toolCall('t1', 1), turnTail('tt1', 1)]);
  assert.equal(noTp.barsByAnchor.size, 0, '缺锚不落栏（官方保证有过程证据的轮必有 turn-process）');
});

test('B2 ④a steering 后段首步是插件过程步：栏落座该步内（steering 气泡与步骤之间）', () => {
  resetSeq();
  const nodes = [
    user('u1', 1),
    step('b1', 1, TEXT_ONLY),
    step('s1', 1, REASONING),
    steering('steer1', 1),
    step('s2', 1, REASONING),
    toolCall('t2', 1),
    step('b2', 1, TEXT_ONLY),
    turnTail('tt1', 1),
  ];
  const proj = project(nodes);
  // seg1=[s1] 直接跟在 b1 后 → b1 下方
  assert.deepEqual(proj.barsByAnchor.get('b1'), [{ segKey: 'steer1', toolCalls: 0, messages: 0, pos: 'after' }]);
  // seg2=[s2,t2] 跟在 steering 后且段首步 s2 是插件过程步 → 锚点=s2、其内容上方
  assert.deepEqual(proj.barsByAnchor.get('s2'), [{ segKey: 'b2', toolCalls: 1, messages: 1, pos: 'before' }]);
});

test('B2 ④b steering 后段首步是官方渲染（已知妥协）：闭合段落座封口正文上方', () => {
  resetSeq();
  const nodes = [
    user('u1', 1),
    turnProcess('tp1', 1),
    step('b1', 1, TEXT_ONLY),
    toolCall('t1', 1),
    steering('steer1', 1),
    toolCall('t2', 1),
    step('b2', 1, TEXT_ONLY),
    turnTail('tt1', 1),
  ];
  const proj = project(nodes);
  // seg1=[t1] 直接跟在 b1 后 → b1 下方
  assert.deepEqual(proj.barsByAnchor.get('b1'), [{ segKey: 'steer1', toolCalls: 1, messages: 0, pos: 'after' }]);
  // seg2=[t2] 段首步 t2 是官方 tool-call → 已知妥协：落座封口正文 b2 上方
  // （收起仍紧贴其后正文；展开步骤在栏上方——官方 steering 座位不可注入）
  assert.deepEqual(proj.barsByAnchor.get('b2'), [{ segKey: 'b2', toolCalls: 1, messages: 1, pos: 'before' }]);
});

test('B2 缺 turn-process 节点的回退链：轮首段退到 prevBody 下方 / 封口正文上方', () => {
  resetSeq();
  const nodes = [user('u1', 1), toolCall('t1', 1), step('b1', 1, TEXT_ONLY), toolCall('t2', 1), step('b2', 1, TEXT_ONLY), turnTail('tt1', 1)];
  const proj = project(nodes);
  const b1Bars = proj.barsByAnchor.get('b1');
  assert.equal(b1Bars.length, 2);
  assert.deepEqual(b1Bars.map((b) => [b.segKey, b.pos]), [['b1', 'before'], ['b2', 'after']]);
});
