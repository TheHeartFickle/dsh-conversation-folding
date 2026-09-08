// dsh-conversation-folding — host 半边。
// 借鉴 DSH-better-sidebar 的持久化机制：经官方 settings 服务注册本插件命名空间
// （settings.register + schemastery schema），配置落盘到
// <harness home>/settings.yaml 的 dsh-conversation-folding: 命名空间。
// DSH 的 settings RPC 只对白名单命名空间开放，第三方命名空间必须走插件自有路由：
// GET /conversation-folding/config 读，POST 写（写前 host 侧校验）。
// settings 服务可选：未挂载时路由返回 503，client 回退内置默认值。
import z from "schemastery";

const CONFIG_NS = "dsh-conversation-folding";
const DISPLAY_MODES = ["normal", "compact", "fold"] as const;
// 与 src/client/state.ts 的 DEFAULT_AUX_VISIBLE 保持一致（浏览器 bundle 与
// Node ESM 两个运行域无法共享代码，plugin.test.mjs 对账）。
export const DEFAULT_AUX_VISIBLE = ["context", "skill", "system-prompt"];
const inject = ["webServer"];

interface PluginConfig {
	displayMode: string;
	auxVisible: string[];
}

const ConfigSchema = z.object({
	displayMode: z.union([z.const("normal"), z.const("compact"), z.const("fold")]),
	auxVisible: z.array(z.string()).default(DEFAULT_AUX_VISIBLE.slice())
});

// 官方 settings / webServer 服务（ctx.inject 鸭子类型的最小读取面）。
interface SettingsService {
	register(ns: string, schema: unknown): void;
	describe(): { ns: string; value?: Partial<PluginConfig> }[];
	update(ns: string, patch: Record<string, unknown>): Promise<void>;
}

interface RouteRequest {
	method?: string;
	url?: string;
	[Symbol.asyncIterator](): AsyncIterableIterator<Buffer>;
}

interface RouteResponse {
	writeHead(status: number, headers: Record<string, string>): unknown;
	end(body?: string): unknown;
}

interface HostContext {
	inject(services: string[], fn: (sctx: { settings: SettingsService; effect(fn: () => void): void }) => void): void;
	effect(fn: () => unknown): void;
	webServer: {
		register(route: {
			kind: string;
			path: string;
			handler: (req: RouteRequest, res: RouteResponse) => Promise<void>;
		}): unknown;
	};
}

function writeJson(res: RouteResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}

function apply(ctx: HostContext): void {
	let api: { read(): PluginConfig; update(patch: Record<string, unknown>): Promise<PluginConfig> } | null = null;
	ctx.inject(["settings"], (sctx) => {
		sctx.settings.register(CONFIG_NS, ConfigSchema);
		const read = (): PluginConfig => {
			const info = sctx.settings.describe().find((c) => c.ns === CONFIG_NS);
			const value: Partial<PluginConfig> = info && info.value ? info.value : {};
			const mode = value.displayMode;
			return {
				// 非法/缺失 displayMode 回退 compact（原实现语义）
				displayMode: mode !== undefined && mode !== null && DISPLAY_MODES.includes(mode as (typeof DISPLAY_MODES)[number]) ? mode : "compact",
				auxVisible: Array.isArray(value.auxVisible) ? value.auxVisible : DEFAULT_AUX_VISIBLE.slice()
			};
		};
		const update = async (patch: Record<string, unknown>): Promise<PluginConfig> => {
			await sctx.settings.update(CONFIG_NS, patch);
			return read();
		};
		api = { read, update };
		// settings 服务的 fiber 卸载/重载时，恢复"服务不可用"语义。
		sctx.effect(() => () => { api = null; });
	});

	ctx.effect(() => ctx.webServer.register({
		kind: 'prefix',
		path: '/conversation-folding',
		handler: async (req, res) => {
			const url = new URL(req.url ?? '/', 'http://x');
			const sub = url.pathname.replace(/^\/conversation-folding\/?/, '').replace(/\/$/, '');
			if (sub !== 'config') { writeJson(res, 404, { ok: false, error: 'unknown-endpoint' }); return; }
			if (req.method === 'GET') {
				if (api === null) { writeJson(res, 503, { ok: false, error: 'settings-unavailable' }); return; }
				try {
					writeJson(res, 200, { ok: true, ...api.read() });
				} catch (e) {
					writeJson(res, 500, { ok: false, error: String((e && (e as Error).message) || e) });
				}
				return;
			}
			if (req.method === 'POST') {
				if (api === null) { writeJson(res, 503, { ok: false, error: 'settings-unavailable' }); return; }
				const chunks: Buffer[] = [];
				for await (const chunk of req) {
					chunks.push(chunk);
				}
				let patch: Record<string, unknown>;
				try {
					patch = JSON.parse(Buffer.concat(chunks).toString('utf8'));
				} catch {
					writeJson(res, 400, { ok: false, error: 'invalid-json' });
					return;
				}
				if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) { writeJson(res, 400, { ok: false, error: 'invalid-patch' }); return; }
				if (patch.displayMode !== undefined && DISPLAY_MODES.indexOf(patch.displayMode as (typeof DISPLAY_MODES)[number]) === -1) { writeJson(res, 400, { ok: false, error: 'invalid-displayMode' }); return; }
				if (patch.auxVisible !== undefined && !Array.isArray(patch.auxVisible)) { writeJson(res, 400, { ok: false, error: 'invalid-auxVisible' }); return; }
				try {
					const config = await api.update(patch);
					writeJson(res, 200, { ok: true, ...config });
				} catch (e) {
					writeJson(res, 500, { ok: false, error: String((e && (e as Error).message) || e) });
				}
				return;
			}
			writeJson(res, 405, { ok: false, error: 'method-not-allowed' });
		},
	}))
}

export { apply, inject }
