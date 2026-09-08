import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as plugin from '../lib/index.js';

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

test('cordis.patch.yml mounts the plugin row with default foldMode and aux exceptions', async () => {
  const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /id: conversation-folding/);
  assert.match(patch, /name: '@the-heart-fickle\/dsh-conversation-folding'/);
  assert.match(patch, /foldMode: 'all'/);
  assert.match(patch, /auxVisible:/);
  assert.match(patch, /- context/);
  assert.match(patch, /- skill/);
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
  assert.ok(client.includes('exports.__test'));
  // 旧的分散判定应已消失：分段逻辑不得散落在视图组件内
  assert.ok(!client.includes('function segmentsOfTurn'), '分段已统一进 buildTimeline');
  assert.ok(!client.includes('function closingOfTurn'), '轮闭合判定已统一为 turn-tail 信号');
});

test('client bundle reads conversation data via useChat (DSH 0.1.2 removed session.chat)', async () => {
  const client = await readFile(join(root, 'lib/client.js'), 'utf8');
  assert.match(client, /function chatOf\(props\)/);
  assert.match(client, /props\.useChat/);
  assert.ok(!client.includes('s.chat.order'), 'session snapshot no longer carries .chat');
  assert.ok(!client.includes('s.chat.nodes'), 'session snapshot no longer carries .chat');
});

test('client bundle shadows only assistant-step and turn-process with explicit priority', async () => {
  const client = await readFile(join(root, 'lib/client.js'), 'utf8');
  // 0.1.2 slots 选举制：同 key 必须显式更低 priority（BUGS.md B3）
  assert.match(client, /key: "assistant-step", locale: "conversation", priority: -1/);
  assert.match(client, /key: "turn-process", locale: "conversation", priority: -1/);
  // 不 shadow tool-call / context：显隐由投影生成的动态 CSS 控制
  assert.ok(!client.includes('key: "tool-call"'));
  assert.ok(!client.includes('key: "context"'));
});

test('plugin exports follow the Cordis plugin shape', () => {
  assert.equal(plugin.name, 'dsh-conversation-folding');
  assert.deepEqual(plugin.inject, ['webServer']);
  assert.equal(typeof plugin.apply, 'function');
});

test('apply registers a config API that returns foldMode and auxVisible', async () => {
  const routes = [];
  const ctx = {
    webServer: {
      register(route) { routes.push(route); },
    },
  };
  plugin.apply(ctx, { foldMode: 'toolcall', auxVisible: ['context'] });
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, 'prefix');
  assert.equal(routes[0].path, '/api/conversation-folding');

  const res = {
    status: 0,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
  const req = { method: 'GET', url: '/api/conversation-folding/config' };
  await routes[0].handler(req, res);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, foldMode: 'toolcall', auxVisible: ['context'] });
});
