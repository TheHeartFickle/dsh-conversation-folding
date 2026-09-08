// §1 折叠配置（host 设置文件持久化） / §2 对话显示模式 / §3 段展开状态
//
// §1 以原 cordis.patch.yml auxVisible 机制为基准：auxVisible 仍是「不折叠的
// 豁免键」列表（原为 profile 下发，现改为设置页开关，经插件自有 RPC 路由
// /conversation-folding/api 读写，由 host 半边经官方 settings 服务持久化到
// <harness home>/settings.yaml 的 dsh-conversation-folding: 命名空间——
// DSH settings RPC 只对白名单命名空间开放，第三方必须走自有路由，
// 机制与 DSH-better-sidebar 完全一致。浏览器 localStorage 不存任何配置。
// 在此基础上增加一张匹配表（AUX_TYPES）：豁免键 → 节点匹配规则。
//
// 工具调用的实际名称是 host 工具注册表的字面注册名（tool/call 事件的
// data.name；聊天树节点在 data.root.name / data.root.call.name），上游
// 不做任何别名解析，因此 names 匹配 = 小写归一 + 精确相等；未命中的
// 工具类型不在表内，始终折叠。
//   names    tool-call 注册名（含同类工具/跨版本变体）
//   kinds    直接按节点 kind 匹配（context=上下文注入行、system-prompt=系统提示词）
//   process  仅推理过程步（assistant-step：无可见 block 且有 reasoning）
import { classifyNode, toolCallName, type ChatNode } from "./model.js";

export interface AuxType {
	key: string;
	label: string;
	names?: string[];
	kinds?: string[];
	process?: true;
}

export const AUX_TYPES: AuxType[] = [
	{ key: "bash", label: "Bash / Shell 命令", names: ["bash", "pwsh", "sh", "shell", "powershell"] },
	{ key: "think", label: "思维链", process: true },
	{ key: "read", label: "读取文件", names: ["read", "read_image", "view", "see"] },
	{ key: "write", label: "写入文件", names: ["write", "create"] },
	{ key: "edit", label: "编辑文件", names: ["edit", "str_replace", "str_replace_editor", "str-replace-editor", "multi-edit"] },
	{ key: "glob", label: "Glob 文件搜索", names: ["glob"] },
	{ key: "grep", label: "Grep 内容搜索", names: ["grep"] },
	{ key: "web", label: "网络搜索与抓取", names: ["web_search", "web_fetch"] },
	{ key: "skill", label: "Skill 加载", names: ["skill"] },
	{ key: "subagent", label: "子代理", names: ["subagent", "list_agents", "list_subagent_models", "interrupt_agent", "send_message"] },
	{ key: "job", label: "后台任务", names: ["job_output", "job_list", "job_kill"] },
	{ key: "goal", label: "目标", names: ["create_goal", "get_goal", "update_goal"] },
	{ key: "todo", label: "任务清单", names: ["todo_write", "todo-write", "todowrite", "todo"] },
	{ key: "ask", label: "向用户提问", names: ["ask_user_question", "ask_user", "askuser"] },
	{ key: "ralph", label: "Ralph 循环", names: ["ralph"] },
	{ key: "workflow", label: "工作流", names: ["workflow"] },
	{ key: "context", label: "上下文注入", kinds: ["context"] },
	{ key: "system-prompt", label: "系统提示词", kinds: ["system-prompt"] }
];

// 默认豁免（不折叠）的类型：上下文注入 / Skill 加载 / 系统提示词；
// 其余固定类型与所有未列出的工具类型默认折叠。与 src/index.ts 的
// DEFAULT_AUX_VISIBLE 保持一致（两个运行域无法共享代码，plugin.test 对账）。
export const DEFAULT_AUX_VISIBLE = ["context", "skill", "system-prompt"];

// ---------- 响应式 store（值 + version + listeners 一体） ----------
// 三个 store（§1 豁免表 / §2 显示模式 / §3 段展开）共用：set 写值即广播
// （version 递增，listeners 逐个通知）。值引用不比较——§3 的段展开依赖
// 无条件广播，调用方需要"值未变不广播"时自行短路（见 setTranscriptMode）。
function createStore<T>(initial: T) {
	let value = initial;
	let version = 0;
	const listeners = new Set<() => void>();
	return {
		get: () => value,
		version: () => version,
		subscribe(fn: () => void): () => void {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		set(next: T): void {
			value = next;
			version += 1;
			listeners.forEach((fn) => fn());
		}
	};
}

// ---------- §1 豁免表 store ----------
const auxStore = createStore<string[]>(DEFAULT_AUX_VISIBLE.slice());

// 节点 → 豁免键（匹配表查询）；未命中返回 undefined。
export function auxKeyOfNode(node: ChatNode | null | undefined): string | undefined {
	if (!node) return undefined;
	if (node.kind === "tool-call") {
		const name = toolCallName(node);
		if (typeof name !== "string") return undefined;
		const lower = name.toLowerCase();
		for (const rule of AUX_TYPES) {
			if (rule.names !== undefined && rule.names.includes(lower)) return rule.key;
		}
		return undefined;
	}
	for (const rule of AUX_TYPES) {
		if (rule.kinds !== undefined && rule.kinds.includes(node.kind)) return rule.key;
		if (rule.process === true && node.kind === "assistant-step" && classifyNode(node) === "process") return rule.key;
	}
	return undefined;
}

export const getAuxVisible = auxStore.get;
export const subscribeAux = auxStore.subscribe;
export const getAuxVersion = auxStore.version;

export function includesAux(key: string): boolean {
	return auxStore.get().includes(key);
}

export function setAuxVisible(list: unknown): void {
	if (!Array.isArray(list)) return;
	auxStore.set(list.filter((item): item is string => typeof item === "string"));
}

interface ConfigPayload {
	ok?: boolean;
	displayMode?: unknown;
	auxVisible?: unknown;
}

// host 配置读写共用一个端点：GET /conversation-folding/config 恢复，
// POST 局部更新（host 半边经官方 settings 服务持久化到 settings.yaml）。
// 网络/解析失败一律吞掉（返回 null）：配置恢复失败回退内置默认值。
function fetchConfig(init?: RequestInit): Promise<ConfigPayload | null> {
	return fetch("/conversation-folding/config", init)
		.then((res) => (res.ok ? res.json() : null))
		.catch(() => null);
}

// 用户动作才落盘：POST 给 host 半边，由官方 settings 服务写入 settings.yaml。
export function persistConfig(patch: Record<string, unknown>): void {
	void fetchConfig({
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(patch)
	});
}

export function loadConfig(): void {
	fetchConfig().then((data) => {
		if (!data || !data.ok) return;
		if (data.displayMode !== undefined) setTranscriptMode(data.displayMode);
		if (data.auxVisible !== undefined) setAuxVisible(data.auxVisible);
	});
}

export function toggleAux(kind: string): void {
	setAuxVisible(includesAux(kind)
		? auxStore.get().filter((key) => key !== kind)
		: auxStore.get().concat([kind]));
	persistConfig({ auxVisible: auxStore.get().slice() });
}

// ---------- §2 对话显示模式 ----------
// DSH 官方只有 normal / compact；本插件新增下拉项 fold（名称“折叠”），
// 只有选中 fold 时插件才接管过程折叠，官方两种模式完全不受影响。
// 模式值随 auxVisible 一起持久化到 host settings.yaml；GET 恢复前先以
// 默认值 compact 渲染，恢复后应用并同步 fold-mode 属性。
const TRANSCRIPT_MODES = ["normal", "compact", "fold"] as const;
export type TranscriptMode = (typeof TRANSCRIPT_MODES)[number];

function isTranscriptMode(value: unknown): value is TranscriptMode {
	return TRANSCRIPT_MODES.includes(value as TranscriptMode);
}

const modeStore = createStore<TranscriptMode>("compact");
export const subscribeTranscript = modeStore.subscribe;
export const getTranscriptVersion = modeStore.version;

export function getTranscriptMode(): TranscriptMode {
	return modeStore.get();
}

// 参数保持 unknown：GET 恢复的值未经校验，非法模式直接忽略（与原实现一致）。
export function setTranscriptMode(mode: unknown): void {
	if (!isTranscriptMode(mode) || mode === modeStore.get()) return;
	modeStore.set(mode);
	syncFoldModeAttr(isFoldActive());
}

export function isFoldActive(): boolean {
	return getTranscriptMode() === "fold";
}

export function syncFoldModeAttr(active: boolean): void {
	if (typeof document !== "undefined") document.documentElement.dataset.dshFoldMode = active ? "all" : "none";
}

// ---------- §3 段展开状态 ----------
// 折叠单位是「段」（见 model.ts §4）；展开状态按段 segKey 共享。
const segStore = createStore(new Map<string, boolean>());
export const subscribeSeg = segStore.subscribe;
export const getSegVersion = segStore.version;

export function isSegExpanded(key: string | undefined): boolean {
	return key !== undefined && segStore.get().get(key) === true;
}

export function setSegExpanded(key: string | undefined, expanded: boolean): void {
	if (key === undefined) return;
	// 不可变更新（拷贝后写）：store 靠 version 广播，不比较值引用。
	const next = new Map(segStore.get());
	next.set(key, expanded);
	segStore.set(next);
}
