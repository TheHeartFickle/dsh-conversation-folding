#!/usr/bin/env node
// 构建全部产物。源码一律在 src/（TypeScript），lib/ 整体为构建产物（.gitignore 不入库）：
//   src/index.ts        → lib/index.js    host 半边（Node ESM，schemastery external）
//   src/client/main.ts  → lib/client.js   浏览器 bundle
//
// host 以 dsh.plugin.json 的 client.main 整文件加载浏览器 bundle：产物必须是
// 单个 `window.__ModuleLoader__.load({ id, factory })` 注册文件，factory 内的
// require 只解析宿主注入的外部模块（react / 官方 primitives），其余全部内联。
// 构建方式参考 DSH-better-sidebar（打包器经 banner/intro/footer 吐出同款包装），
// 本插件纯 JS、无 JSX/CSS，esbuild 一步足够。
import { build } from "esbuild";

const ID = "@the-heart-fickle/dsh-conversation-folding";
const CLIENT_EXTERNALS = ["react", "@deepseek-ai/dsh-client-ui-primitives"];

const WRAPPER_BANNER = [
	"window.__ModuleLoader__.load({",
	`\tid: ${JSON.stringify(ID)},`,
	"\tfactory: (require) => {",
	"\t\tvar module = { exports: {} };"
].join("\n");

const WRAPPER_FOOTER = [
	"\t\tObject.defineProperty(module.exports, Symbol.toStringTag, { value: \"Module\" });",
	"\t\treturn module.exports;",
	"\t}",
	"});"
].join("\n");

await build({
	entryPoints: ["src/index.ts"],
	outfile: "lib/index.js",
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["schemastery"],
	logLevel: "info"
});

await build({
	entryPoints: ["src/client/main.ts"],
	outfile: "lib/client.js",
	bundle: true,
	format: "cjs",
	platform: "browser",
	external: CLIENT_EXTERNALS,
	banner: { js: WRAPPER_BANNER },
	footer: { js: WRAPPER_FOOTER },
	logLevel: "info"
});
