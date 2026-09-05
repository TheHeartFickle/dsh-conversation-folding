// dsh-conversation-folding — host 半边。
// 浏览器半边负责对话流折叠；host 半边只暴露一个配置文件读取接口，
// 让 client 能拿到 profile cordis.patch.yml 中配置的 foldMode 与 auxVisible。
//
// 权威实现位于 lib/commands.js（标准 Command 通道与官方 HTTP 通道共用）；
// 本文件的 /api/conversation-folding 路由只是官方通道的薄投影，不再承载逻辑。
import { createFoldingCommands } from './commands.js'

const name = 'dsh-conversation-folding';
const inject = ['webServer'];

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function apply(ctx, config) {
  const commands = createFoldingCommands({ resolveConfig: () => config });
  const configCommand = commands[0];

  ctx.webServer.register({
    kind: 'prefix',
    path: '/api/conversation-folding',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://x');
        const sub = url.pathname.replace(/^\/api\/conversation-folding\/?/, '').replace(/\/$/, '');
        if (sub === 'config') {
          if (req.method !== 'GET') {
            json(res, 405, { ok: false, error: 'method-not-allowed' });
            return;
          }
          // 权威实现来自 lib/commands.js；result.text 即旧版响应体（{ ok, foldMode, auxVisible }）
          const result = await configCommand.execute({ rawInput: '' });
          if (result.kind === 'success') {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
            res.end(result.text);
          } else {
            json(res, 500, { ok: false, error: 'internal', message: result.text });
          }
          return;
        }
        json(res, 404, { ok: false, error: 'unknown-endpoint' });
      } catch (error) {
        json(res, 500, { ok: false, error: 'internal', message: error instanceof Error ? error.message : String(error) });
      }
    },
  });
}

export { apply, inject, name };
