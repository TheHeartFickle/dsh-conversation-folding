import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as plugin from '../lib/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('package.json is a public scoped plugin package', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@theheartfickle/dsh-conversation-folding-plugin');
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.main, 'lib/index.js');
  assert.equal(pkg.scripts['package:registry'], 'node scripts/package-registry.mjs');
});

test('dsh.plugin.json declares the registry manifest and client entry', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'dsh.plugin.json'), 'utf8'));
  assert.equal(manifest.id, 'theheartfickle/dsh-conversation-folding');
  assert.equal(manifest.main, './lib/index.js');
  assert.equal(manifest.client.main, './lib/client.js');
  assert.ok(Array.isArray(manifest.contributes.tools));
  assert.ok(Array.isArray(manifest.contributes.skills));
});

test('cordis.patch.yml mounts the plugin row with default foldMode and aux exceptions', async () => {
  const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /id: conversation-folding/);
  assert.match(patch, /name: '@theheartfickle\/dsh-conversation-folding-plugin'/);
  assert.match(patch, /foldMode: 'all'/);
  assert.match(patch, /auxVisible:/);
  assert.match(patch, /- context/);
  assert.match(patch, /- skill/);
});

test('client bundle registers the scoped module id', async () => {
  const client = await readFile(join(root, 'lib/client.js'), 'utf8');
  assert.match(client, /id: "@theheartfickle\/dsh-conversation-folding-plugin"/);
});

test('plugin exports follow the Cordis plugin shape', () => {
  assert.equal(plugin.name, 'dsh-conversation-folding');
  assert.deepEqual(plugin.inject, ['webServer']);
  assert.equal(typeof plugin.apply, 'function');
});

test('apply registers a config API that returns foldMode and auxVisible', () => {
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
  routes[0].handler(req, res);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, foldMode: 'toolcall', auxVisible: ['context'] });
});
