/**
 * Playwright config for the headless render lane (tests/e2e).
 *
 * 本 lane 不自己启动服务器：`scripts/e2e-mount.sh` 用官方 CLI 把 npm 打包产物
 * 装进一个全新 scratch profile、启动真实 `dsh web --port 0`、把含 token 的
 * 启动 URL 经 `DSH_E2E_URL` 注入；spec 只负责在无头 Chromium 里渲染它。
 *
 * spec 命名 `*.e2e.ts`（不是 `*.spec.ts`），避免被 `node --test` / vitest 的
 * 默认收集拾取；本仓库的 `npm test` 只跑 `test/**\/*.test.mjs`。
 *
 * 浏览器：优先用系统已装的 Chrome（`channel: 'chrome'`），不要求
 * `npx playwright install` 下载浏览器；没有 Chrome 时回退 Playwright 自带的
 * chromium（需先安装）。
 */
import { defineConfig } from '@playwright/test';

const channel = process.env.DSH_E2E_CHANNEL ?? 'chrome';

export default defineConfig({
	testDir: './tests/e2e',
	testMatch: '**/*.e2e.ts',
	// 确定性闸门：不重试、单 worker、串行。整个 lane 针对同一个服务器实例，
	// 串行执行让断言保持归因力（任何崩溃都会让下一条断言失败）。
	retries: 0,
	workers: 1,
	fullyParallel: false,
	timeout: 180_000,
	expect: { timeout: 15_000 },
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		channel: channel === 'none' ? undefined : channel,
		headless: true,
		viewport: { width: 1440, height: 900 },
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure',
	},
});
