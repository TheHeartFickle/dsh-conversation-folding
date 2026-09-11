// M 层补充回归：静态样式契约（lib/client.js 内联的 CSS 字符串）。
// T-B1（折叠栏样式）、T-B5/B17（隐藏标记收座位盒子）、T-E1（动态规则选择器
// 形状：后插入胜出官方渲染）、T-A2/T-F3（fold 模式属性选择器）的机械化锚点。
// 仅断言 ASCII 规则文本（bundle 以 \uXXXX 转义存储非 ASCII，文案断言在
// view-seat.test.mjs 用真实渲染覆盖）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadClient, makeNode, makeStore, resetSeq } from './helpers/load-client.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = await loadClient();
const { buildTimeline, projectView } = client.__test;

test('T-B1 折叠栏静态样式：33px 高、细底边、chevron 收起 -90deg/展开 0', async () => {
  const bundle = await readFile(join(root, 'lib/client.js'), 'utf8');
  assert.match(bundle, /\.dsh-turnfold\{[^}]*height:33px/, '折叠栏高度 33px');
  assert.match(bundle, /\.dsh-turnfold\{[^}]*border-bottom:\.5px solid/, '细底边');
  assert.match(bundle, /\.dsh-turnfold\{[^}]*background:0 0/, '背景透明');
  assert.match(bundle, /\.dsh-turnfold-chevron\{[^}]*transform:rotate\(-90deg\)/, '收起时 chevron 旋转 -90deg');
  assert.match(bundle, /\.dsh-turnfold\[data-open\] \.dsh-turnfold-chevron\{[^}]*transform:rotate\(0\)/, '展开时 chevron 归零');
});

test('T-B5/B17 影子座位零残留：隐藏标记 display:none + :has 收座位盒子 + 折叠栏落位间距', async () => {
  const bundle = await readFile(join(root, 'lib/client.js'), 'utf8');
  assert.ok(bundle.includes('[data-dsh-hidden-turn]{display:none}'), '隐藏标记自身 display:none');
  assert.ok(
    bundle.includes('[data-chat-flow-kind="assistant-step"]:has([data-dsh-hidden-turn]){display:none}'),
    '含隐藏标记的 assistant-step 座位整个收掉（B17 幻影间隔根因）',
  );
  // 落位间距（B18）：栏偏向其所折叠段的内容一侧——before 栏外边距归零、用自身
  // 8px 下内边距紧贴其后正文（含轮首段的兜底栏），after 栏补 16px 上外边距
  // 拉开与上方正文的距离。
  assert.ok(
    bundle.includes('[data-chat-flow-kind="assistant-step"] .dsh-turnfold[data-bar-pos="before"],[data-chat-flow-kind="turn-process"] .dsh-turnfold[data-bar-pos="before"]{margin:0}'),
    'before 栏外边距归零（含轮首段的兜底栏），紧贴其下方正文',
  );
  assert.ok(bundle.includes('[data-chat-flow-kind="assistant-step"] .dsh-turnfold[data-bar-pos="after"]{margin:16px 0 0}'), 'after 栏补 16px 上外边距，偏向其折叠段一侧');
  assert.ok(bundle.includes('"data-bar-pos"'), '栏元素实际渲染 data-bar-pos（间距规则的选择器依赖它）');
});

test('T-E1/C4 动态隐藏规则选择器形状：模式属性 + 锚点 key + !important（后插入胜出）', () => {
  resetSeq();
  const { projectView } = client.__test;
  const nodes = [makeNode('user', 'u1', 1, {}), makeNode('tool-call', 't1', 1, { root: { name: 'bash' } }), makeNode('turn-tail', 'tt1', 1, {})];
  const timeline = buildTimeline(nodes.map((n) => n.key), makeStore(nodes));
  const proj = projectView(timeline, { active: true, auxVisible: () => false, isExpanded: () => false });
  assert.equal(
    proj.styleText,
    ':root[data-dsh-fold-mode=all] [data-chat-flow-key][data-chat-anchor-key="t1"][data-chat-flow-kind]{display:none!important}',
    '规则形状固定：同优先级靠动态样式后插入取胜，不得降级为无 !important',
  );
  assert.ok(proj.styleText.startsWith(':root[data-dsh-fold-mode=all]'), '规则由 fold 模式属性门控（T-F3：非 fold 模式不生效）');
});

test('T-A2/T-F3 fold 模式还原官方 compact 隐藏：unhide 规则排除插件隐藏标记', async () => {
  const bundle = await readFile(join(root, 'lib/client.js'), 'utf8');
  assert.ok(
    bundle.includes(':root[data-dsh-fold-mode=all] [data-chat-flow-key][hidden]:not(:has([data-dsh-hidden-turn])){display:block!important;content-visibility:visible!important}'),
    'fold 模式还原官方 hidden 座位，但带插件隐藏标记的座位仍被收掉',
  );
});
