import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COMMAND_API_VERSION, COMMAND_KIND, createFoldingCommands, FOLDING_DEFAULTS, normalizeFoldingConfig } from '../lib/commands.js';
import stdHost from '../lib/std-host.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('dsh-plugin.json is a valid Community v0.15 standard manifest', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'dsh-plugin.json'), 'utf8'));
  assert.equal(manifest.manifestVersion, '0.15');
  assert.equal(manifest.id, 'the-heart-fickle.dsh-conversation-folding');
  assert.match(manifest.id, /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/);
  assert.equal(manifest.facets.host.apiVersion, 'v1alpha1');
  // 不声明 requires.services；可选契约必须带 fallback
  assert.equal(manifest.requires?.services, undefined);
  for (const contract of manifest.requires?.contracts ?? []) {
    if (contract.optional) assert.ok(contract.fallback, `optional contract ${contract.apiVersion} needs fallback`);
  }
  // 命令声明完整且 id namespaced
  const ids = manifest.contributes.commands.map(c => c.id);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/);
  assert.equal(new Set(ids).size, ids.length);
  // facets.host.entry 指向真实文件
  assert.ok(existsSync(join(root, manifest.facets.host.entry)), 'facets.host.entry must exist');
});

test('std-host publishes every declared command under commands.dsh/v1alpha1', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'dsh-plugin.json'), 'utf8'));
  const published = [];
  const context = {
    identity: { component: manifest.id, facet: 'host' },
    scope: { signal: new AbortController().signal, add() { return () => {} } },
    protocols: { agreement: () => undefined, client: () => undefined, implement: () => () => {} },
    extensions: {
      publish(reference, name, handler) {
        published.push({ reference, name, handler });
        return () => {};
      },
    },
  };
  stdHost.activate(context);

  const declared = manifest.contributes.commands.map(c => c.id.split('.').at(-1));
  assert.deepEqual(published.map(p => p.name).sort(), [...declared].sort());
  for (const p of published) {
    assert.deepEqual(p.reference, { apiVersion: COMMAND_API_VERSION, kind: COMMAND_KIND });
    assert.equal(typeof p.handler.execute, 'function');
  }
});

test('config command returns the canonical JSON body and rejects arguments', async () => {
  const [command] = createFoldingCommands({ resolveConfig: () => FOLDING_DEFAULTS });
  const ok = await command.execute({ rawInput: '' });
  assert.deepEqual(JSON.parse(ok.text), { ok: true, foldMode: 'all', auxVisible: ['context', 'skill'] });
  assert.equal(ok.kind, 'success');

  const rejected = await command.execute({ rawInput: '{}' });
  assert.equal(rejected.kind, 'error');
});

test('normalizeFoldingConfig keeps the official-channel semantics', () => {
  // foldMode 缺失回退 'all'；auxVisible 非数组才回退；用户显式空数组保留
  assert.deepEqual(normalizeFoldingConfig(undefined), { foldMode: 'all', auxVisible: FOLDING_DEFAULTS.auxVisible });
  assert.deepEqual(normalizeFoldingConfig({ foldMode: 'toolcall', auxVisible: [] }), { foldMode: 'toolcall', auxVisible: [] });
  assert.deepEqual(normalizeFoldingConfig({ foldMode: 'none', auxVisible: 'bad' }).auxVisible, FOLDING_DEFAULTS.auxVisible);
});

test('official route delegates to the same command implementation', async () => {
  const { apply } = await import('../lib/index.js');
  assert.equal(typeof apply, 'function');
  const routes = [];
  const ctx = { webServer: { register: r => routes.push(r) } };
  apply(ctx, { foldMode: 'toolcall', auxVisible: ['context'] });

  const route = routes[0];
  assert.equal(route.path, '/api/conversation-folding');
  const res = captureResponse();
  await route.handler({ method: 'GET', url: '/api/conversation-folding/config' }, res);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, foldMode: 'toolcall', auxVisible: ['context'] });
});

function captureResponse() {
  const res = { status: 0, body: '', headers: null };
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
  res.end = body => { res.body = body ?? ''; };
  return res;
}
