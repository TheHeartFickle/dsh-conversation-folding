// M 层补充回归：host 半边路由（src/index.ts → lib/index.js）的失败分支。
// 针对变异测试幸存的 M23/M24/M25 与覆盖率报告暴露的未覆盖分支：
//   M23 settings.update 落盘失败 → POST 500 + ok:false（不谎报成功）；
//   M24 describe() 缺失/含未知 displayMode → GET 回退 compact 与默认豁免表；
//   M25 畸形 JSON / 请求体流中断 → POST 400 invalid-json（不是 500）；
//   分支：GET read() 抛异常 → 500；settings 未挂载时 POST → 503；
//         patch 非对象（null/数组/字符串/数字）→ 400 invalid-patch。
// 宿主形状与 plugin.test.mjs 的 apply 用例一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as plugin from '../lib/index.js';

const CONFIG_NS = 'dsh-conversation-folding';
const DEFAULTS = { displayMode: 'compact', auxVisible: ['context', 'skill', 'system-prompt'] };

// settings 服务的合法桩：内存态 current，update 合并落盘。
function validSettings() {
  const current = { ...DEFAULTS };
  return {
    register: () => { },
    describe: () => [{ ns: CONFIG_NS, value: { ...current } }],
    update: async (ns, patch) => { Object.assign(current, patch); },
  };
}

function boot(settings) {
  const routes = [];
  plugin.apply({
    inject(names, cb) { if (names[0] === 'settings') cb({ settings, effect: () => () => { } }); },
    effect(fn) { fn(); return () => { }; },
    webServer: { register: (route) => { routes.push(route); return () => { }; } },
  });
  assert.equal(routes.length, 1);
  const capture = () => {
    const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = b ?? ''; } };
    return res;
  };
  return { handler: routes[0].handler, capture };
}

const getReq = { method: 'GET', url: '/conversation-folding/config' };
// 原始字节流请求体（不做 JSON 序列化）：畸形 JSON / 非对象 patch 用。
const rawReq = (raw) => ({
  method: 'POST',
  url: '/conversation-folding/config',
  async *[Symbol.asyncIterator]() { yield Buffer.from(raw); },
});
// 请求体读取中断（流抛错）——与 JSON 解析失败同归 400（index.ts 注释承诺）。
const boomReq = {
  method: 'POST',
  url: '/conversation-folding/config',
  async *[Symbol.asyncIterator]() { throw new Error('stream broke'); },
};

test('M23 settings.update 落盘失败：POST 返回 500 + ok:false（不谎报成功）', async () => {
  const { handler, capture } = boot({
    register: () => { },
    describe: () => [{ ns: CONFIG_NS, value: { ...DEFAULTS } }],
    update: async () => { throw new Error('disk full'); },
  });
  const res = capture();
  await handler(rawReq(JSON.stringify({ displayMode: 'fold' })), res);
  assert.equal(res.status, 500, '落盘失败必须 500（变异改 200 时在此失败）');
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false, '变异改 ok:true 时在此失败');
  assert.match(body.error, /disk full/);
});

test('M24 describe() 缺失或含未知 displayMode：GET 回退 compact 与默认豁免表', async () => {
  const cases = [
    ['命名空间条目缺失', []],
    ['条目无 value', [{ ns: CONFIG_NS }]],
    ['value 为空对象', [{ ns: CONFIG_NS, value: {} }]],
    ['未知 displayMode + 非数组 auxVisible', [{ ns: CONFIG_NS, value: { displayMode: 'bogus', auxVisible: 'oops' } }]],
  ];
  for (const [name, described] of cases) {
    const { handler, capture } = boot({
      register: () => { },
      describe: () => described,
      update: async () => { },
    });
    const res = capture();
    await handler(getReq, res);
    assert.equal(res.status, 200, name);
    // 变异删除 ?? "compact" 后 displayMode 为 undefined，JSON 序列化丢字段 → deepEqual 失败。
    assert.deepEqual(JSON.parse(res.body), { ok: true, ...DEFAULTS }, name);
  }
});

test('M24 合法 describe() 原样透传：displayMode/auxVisible 逐字段返回（防兜底吞掉合法值）', async () => {
  const { handler, capture } = boot({
    register: () => { },
    describe: () => [{ ns: CONFIG_NS, value: { displayMode: 'fold', auxVisible: ['todo'] } }],
    update: async () => { },
  });
  const res = capture();
  await handler(getReq, res);
  assert.deepEqual(JSON.parse(res.body), { ok: true, displayMode: 'fold', auxVisible: ['todo'] });
});

test('M25 畸形 JSON 与请求体流中断：POST 400 invalid-json（不是 500）', async () => {
  const { handler, capture } = boot(validSettings());
  for (const [name, bad] of [['字面量 {oops', rawReq('{oops')], ['流中断', boomReq]]) {
    const res = capture();
    await handler(bad, res);
    assert.equal(res.status, 400, name + ' 必须 400（变异改 500 时在此失败）');
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: 'invalid-json' }, name);
  }
});

test('分支：GET read() 抛异常 → 500；settings 未挂载 POST → 503；patch 非对象 → 400 invalid-patch', async () => {
  const throwing = boot({
    register: () => { },
    describe: () => { throw new Error('boom'); },
    update: async () => { },
  });
  let res = throwing.capture();
  await throwing.handler(getReq, res);
  assert.equal(res.status, 500, 'read() 抛异常 → 500');
  assert.equal(JSON.parse(res.body).ok, false);

  // settings 服务未挂载（inject 空实现）：api 保持 null，POST 与 GET 同样 503。
  const routes = [];
  plugin.apply({
    inject() { },
    effect(fn) { fn(); return () => { }; },
    webServer: { register: (route) => { routes.push(route); return () => { }; } },
  });
  const post = { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = b ?? ''; } };
  await routes[0].handler(rawReq(JSON.stringify({ displayMode: 'fold' })), post);
  assert.equal(post.status, 503, 'api=null 时 POST → 503');
  assert.deepEqual(JSON.parse(post.body), { ok: false, error: 'settings-unavailable' });

  const { handler, capture } = boot(validSettings());
  for (const raw of ['null', '[1,2]', '"x"', '123']) {
    res = capture();
    await handler(rawReq(raw), res);
    assert.equal(res.status, 400, raw + ' → 400 invalid-patch');
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: 'invalid-patch' }, raw);
  }
  // 正向对照：合法 patch 在同一 settings 桩上仍走 200（兜底分支未误伤正常路径）。
  res = capture();
  await handler(rawReq(JSON.stringify({ displayMode: 'fold' })), res);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).displayMode, 'fold');
});
