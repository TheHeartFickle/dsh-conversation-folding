import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as plugin from '../lib/index.js';
import { loadClient } from './helpers/load-client.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('package.json is a public scoped plugin package', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@the-heart-fickle/dsh-conversation-folding');
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.main, 'lib/index.js');
  assert.equal(pkg.scripts['package:registry'], 'node scripts/package-registry.mjs');
});

test('dsh.plugin.json declares the registry manifest and client entry', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'dsh.plugin.json'), 'utf8'));
  assert.equal(manifest.id, 'the-heart-fickle/dsh-conversation-folding');
  assert.equal(manifest.main, './lib/index.js');
  assert.equal(manifest.client.main, './lib/client.js');
  assert.ok(Array.isArray(manifest.contributes.tools));
  assert.ok(Array.isArray(manifest.contributes.skills));
});

test('cordis.patch.yml mounts the plugin without host config (load entry, settings-only)', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'dsh.plugin.json'), 'utf8'));
  assert.equal(manifest.main, './lib/index.js');
  assert.equal(manifest.client.main, './lib/client.js');
  // 补丁是装载入口，不可省略；但配置已全部移到浏览器设置，不得再出现 config 块。
  const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /id: conversation-folding/);
  assert.match(patch, /name: '@the-heart-fickle\/dsh-conversation-folding'/);
  assert.ok(!/config:/.test(patch), 'cordis.patch.yml 不得携带 config');
  assert.ok(!/foldMode|auxVisible/.test(patch), 'cordis.patch.yml 不得携带 foldMode/auxVisible');
});

test('client bundle registers the scoped module id', async () => {
  const client = await readFile(join(root, 'lib/client.js'), 'utf8');
  assert.match(client, /id: "@the-heart-fickle\/dsh-conversation-folding"/);
});

test('client bundle keeps model/projection as pure testable core', async () => {
  const client = await readFile(join(root, 'lib/client.js'), 'utf8');
  // 轨迹模型 / 视图投影（架构范式 §4/§5）：边界条件只在模型里，不在视图补丁里
  assert.ok(client.includes('function classifyNode'));
  assert.ok(client.includes('function buildTimeline'));
  assert.ok(client.includes('function projectView'));
  assert.ok(client.includes('__test'));
  // 旧的分散判定应已消失：分段逻辑不得散落在视图组件内
  assert.ok(!client.includes('function segmentsOfTurn'), '分段已统一进 buildTimeline');
  assert.ok(!client.includes('function closingOfTurn'), '轮闭合判定已统一为 turn-tail 信号');
});

test('client bundle reads conversation data via useChat (DSH 0.1.2 removed session.chat)', async () => {
  const client = await readFile(join(root, 'lib/client.js'), 'utf8');
  assert.match(client, /function useProjection\(props\)/);
  assert.match(client, /props\.useChat/);
  assert.ok(!client.includes('s.chat.order'), 'session snapshot no longer carries .chat');
  assert.ok(!client.includes('s.chat.nodes'), 'session snapshot no longer carries .chat');
  // 配置来自浏览器设置（localStorage），client 不再请求 host HTTP API
  assert.ok(!client.includes('/api/conversation-folding'), 'client 不得依赖官方 HTTP 配置通道');
});

test('client bundle shadows only assistant-step and turn-process with explicit priority', async () => {
  const client = await readFile(join(root, 'lib/client.js'), 'utf8');
  // 0.1.2 slots 选举制：同 key 必须显式更低 priority（BUGS.md B3）
  assert.match(client, /key: "assistant-step", locale: "conversation", priority: -1/);
  assert.match(client, /key: "turn-process", locale: "conversation", priority: -1/);
  // 不 shadow tool-call / context：显隐由投影生成的动态 CSS 控制。
  // （守卫精确到 conversation.chat.node 注册形状——STEP_TYPES 配置表里的
  // key: "context" 字段与座位注册无关。）
  assert.ok(!/name: "conversation\.chat\.node",\s*\n\s*key: "tool-call"/.test(client));
  assert.ok(!/name: "conversation\.chat\.node",\s*\n\s*key: "context"/.test(client));
});

test('plugin exports follow the Cordis plugin shape', () => {
  assert.deepEqual(plugin.inject, ['webServer']);
  assert.equal(typeof plugin.apply, 'function');
});

test('apply registers a settings-backed config route (persisted to settings.yaml)', async () => {
  const routes = [];
  const registered = [];
  const updates = [];
  let current = { displayMode: 'compact', auxVisible: ['context', 'skill', 'system-prompt'] };
  const settings = {
    register: (ns, schema) => { registered.push(ns); return { ns, schema }; },
    describe: () => [{ ns: 'dsh-conversation-folding', value: { ...current } }],
    update: async (ns, patch) => { updates.push([ns, patch]); Object.assign(current, patch); },
  };
  const ctx = {
    inject(names, cb) { if (names[0] === 'settings') cb({ settings, effect: () => () => { } }); },
    effect(fn) { fn(); return () => { }; },
    webServer: { register: (route) => { routes.push(route); return () => { }; } },
  };
  plugin.apply(ctx);
  assert.deepEqual(registered, ['dsh-conversation-folding'], '注册插件 settings 命名空间');
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, 'prefix');
  assert.equal(routes[0].path, '/conversation-folding');

  const capture = () => {
    const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = b ?? ''; } };
    return res;
  };
  const bodyReq = (method, obj) => ({
    method,
    url: '/conversation-folding/config',
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(obj)); },
  });

  // GET 读当前配置
  let res = capture();
  await routes[0].handler({ method: 'GET', url: '/conversation-folding/config' }, res);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, displayMode: 'compact', auxVisible: ['context', 'skill', 'system-prompt'] });

  // POST 局部更新（经 settings.update 落盘）
  res = capture();
  await routes[0].handler(bodyReq('POST', { auxVisible: ['todo'] }), res);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, displayMode: 'compact', auxVisible: ['todo'] });
  assert.deepEqual(updates[0], ['dsh-conversation-folding', { auxVisible: ['todo'] }]);

  // 非法 displayMode / auxVisible → 400
  res = capture();
  await routes[0].handler(bodyReq('POST', { displayMode: 'bogus' }), res);
  assert.equal(res.status, 400);
  res = capture();
  await routes[0].handler(bodyReq('POST', { auxVisible: 'bad' }), res);
  assert.equal(res.status, 400);

  // settings 服务未挂载 → 503；GET 之外的方法 → 405；未知子路径 → 404
  const noSettingsCtx = {
    inject() { },
    effect(fn) { fn(); return () => { }; },
    webServer: { register: (route) => { routes.push(route); return () => { }; } },
  };
  plugin.apply(noSettingsCtx);
  const last = routes[routes.length - 1];
  res = capture();
  await last.handler({ method: 'GET', url: '/conversation-folding/config' }, res);
  assert.equal(res.status, 503);
  res = capture();
  await last.handler({ method: 'DELETE', url: '/conversation-folding/config' }, res);
  assert.equal(res.status, 405);
  res = capture();
  await last.handler({ method: 'GET', url: '/conversation-folding/other' }, res);
  assert.equal(res.status, 404);
});
test('client bundle defaults agree with the host-half defaults', async () => {
  // 浏览器 bundle（src/client/state.js）与 host 半边（src/index.js）两个运行域
  // 无法共享常量，必须逐字段一致，避免默认值分叉回归。
  const client = await loadClient();
  assert.deepEqual(client.__test.defaultAuxVisible, [...plugin.DEFAULT_AUX_VISIBLE]);
});
