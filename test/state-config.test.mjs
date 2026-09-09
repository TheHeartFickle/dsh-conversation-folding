// M 层补充回归：配置域（§1 豁免表 / §2 显示模式）与 host 路由的 fetch 契约。
// 覆盖 REGRESSION.md T-A2（模式切换的持久化语义）、T-F2（按类型开关的开关
// 往返与 POST 契约）、T-F1 的机械化前提。每个用例重新加载 bundle，store 互不污染。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClient } from './helpers/load-client.mjs';

const realFetch = globalThis.fetch;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

// 应用 bundle 并模拟 host 配置端点。GET 契约：options === undefined；
// POST 契约：options.method === 'POST' 且 body 为 JSON（与 model.test.mjs 一致）。
// fetch mock 保持安装到用例结束（afterEach 恢复）：toggleAux 的 POST 发生在
// apply 之后的用户动作时机。
async function boot(config, { failFetch = false } = {}) {
  const client = await loadClient();
  const posts = [];
  globalThis.fetch = (url, options) => {
    if (failFetch) return Promise.reject(new Error('network down'));
    if (url === '/conversation-folding/config' && options === undefined) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, ...(config ?? {}) }) });
    }
    if (url === '/conversation-folding/config' && options && options.method === 'POST') {
      posts.push(JSON.parse(options.body));
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    }
    return Promise.resolve({ ok: false, json: async () => ({ ok: false }) });
  };
  const injects = [];
  const ctx = {
    get: (name) => (name === 'slots' ? {
      inject: (slot, factory) => injects.push([slot, factory()]),
      register: (meta, component) => ({ meta, component }),
    } : undefined),
    effect: () => () => { },
  };
  client.apply(ctx);
  await tick();
  return { client, posts, injects };
}

test('T-A2 显示模式经 GET 恢复：fold 生效，恢复失败回退 compact', async () => {
  const folded = await boot({ displayMode: 'fold', auxVisible: ['bash'] });
  assert.equal(folded.client.__test.getTranscriptMode(), 'fold', 'GET 恢复 fold 模式');
  assert.deepEqual(folded.client.__test.getAuxVisible(), ['bash']);
  const failed = await boot(null, { failFetch: true });
  assert.equal(failed.client.__test.getTranscriptMode(), 'compact', '网络失败 → 内置默认 compact');
  assert.deepEqual(failed.client.__test.getAuxVisible(), ['context', 'skill', 'system-prompt']);
});

test('T-A2 非法显示模式被忽略：normal/compact 合法，bogus/类型不符回退默认', async () => {
  const normal = await boot({ displayMode: 'normal' });
  assert.equal(normal.client.__test.getTranscriptMode(), 'normal', '官方模式原样恢复');
  const bogus = await boot({ displayMode: 'bogus' });
  assert.equal(bogus.client.__test.getTranscriptMode(), 'compact', '未知串忽略');
  const wrongType = await boot({ displayMode: 123 });
  assert.equal(wrongType.client.__test.getTranscriptMode(), 'compact', '非字符串忽略');
});

test('T-A2 载荷缺省与畸形：缺 displayMode 只动豁免表，auxVisible 非数组/含非字符串被过滤', async () => {
  const partial = await boot({ auxVisible: ['bash'] });
  assert.equal(partial.client.__test.getTranscriptMode(), 'compact', '载荷缺 displayMode → 模式保持默认');
  assert.deepEqual(partial.client.__test.getAuxVisible(), ['bash']);
  const noAux = await boot({ displayMode: 'fold' });
  assert.deepEqual(noAux.client.__test.getAuxVisible(), ['context', 'skill', 'system-prompt'], '载荷缺 auxVisible → 豁免表保持默认');
  const badList = await boot({ auxVisible: 'bash' });
  assert.deepEqual(badList.client.__test.getAuxVisible(), ['context', 'skill', 'system-prompt'], '非数组忽略');
  const mixed = await boot({ auxVisible: [1, 'bash', null, 'todo'] });
  assert.deepEqual(mixed.client.__test.getAuxVisible(), ['bash', 'todo'], '非字符串成员过滤');
  const notOk = await boot({ ok: false, displayMode: 'fold', auxVisible: ['bash'] });
  assert.equal(notOk.client.__test.getTranscriptMode(), 'compact', 'ok:false 整体忽略');
  assert.deepEqual(notOk.client.__test.getAuxVisible(), ['context', 'skill', 'system-prompt']);
});

test('T-F2 toggleAux 开关往返：加入/移除即时生效，每次变更 POST 全量豁免表', async () => {
  const { client, posts } = await boot({ auxVisible: ['context', 'skill', 'system-prompt'] });
  client.__test.toggleAux('bash');
  assert.deepEqual(client.__test.getAuxVisible(), ['context', 'skill', 'system-prompt', 'bash'], '开（豁免）立即生效');
  client.__test.toggleAux('bash');
  assert.deepEqual(client.__test.getAuxVisible(), ['context', 'skill', 'system-prompt'], '关（折叠）立即生效');
  client.__test.toggleAux('context');
  assert.deepEqual(client.__test.getAuxVisible(), ['skill', 'system-prompt'], '默认豁免类型同样可关');
  await tick();
  assert.deepEqual(posts, [
    { auxVisible: ['context', 'skill', 'system-prompt', 'bash'] },
    { auxVisible: ['context', 'skill', 'system-prompt'] },
    { auxVisible: ['skill', 'system-prompt'] },
  ], '每次用户动作 POST 一次，body 为当时的全量豁免表');
});

test('T-F2 默认豁免对账：defaultAuxVisible 恰为 context/skill/system-prompt 且与匹配表一致', async () => {
  const { client } = await boot();
  const { auxTypes, defaultAuxVisible } = client.__test;
  assert.deepEqual(defaultAuxVisible, ['context', 'skill', 'system-prompt']);
  assert.deepEqual([...new Set(defaultAuxVisible)], defaultAuxVisible, '豁免表无重复');
  for (const rule of auxTypes) {
    if (rule.key === 'context' || rule.key === 'skill' || rule.key === 'system-prompt') {
      assert.ok(defaultAuxVisible.includes(rule.key), rule.key + ' 默认不折叠');
    } else {
      assert.ok(!defaultAuxVisible.includes(rule.key), rule.key + ' 默认折叠');
    }
  }
});
