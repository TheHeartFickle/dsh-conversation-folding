// dsh-conversation-folding — host 半边。
// 浏览器半边负责对话流折叠；host 半边只暴露一个配置文件读取接口，
// 让 client 能拿到 profile cordis.patch.yml 中配置的 foldMode 与 auxVisible。
const name = 'dsh-conversation-folding';
const inject = ['webServer'];

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function apply(ctx, config) {
  const foldMode = config && config.foldMode;
  const auxVisible = config && config.auxVisible;

  ctx.webServer.register({
    kind: 'prefix',
    path: '/api/conversation-folding',
    handler: (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://x');
        const sub = url.pathname.replace(/^\/api\/conversation-folding\/?/, '').replace(/\/$/, '');
        if (sub === 'config') {
          if (req.method !== 'GET') {
            json(res, 405, { ok: false, error: 'method-not-allowed' });
            return;
          }
          json(res, 200, {
            ok: true,
            foldMode: foldMode || 'all',
            auxVisible: Array.isArray(auxVisible) ? auxVisible : [],
          });
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
