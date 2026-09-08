// §4 轨迹模型（纯函数，无 DOM / 无 React，可单测）
//
// 节点分类表 —— 全插件唯一检查节点 kind 的地方；宿主新增节点类型只需在
// 此登记一个角色，视图与样式零改动（泛化边界条件的扩展点）：
//   user / steering        人机边界：封口当前段、开启新段。steering 是
//                          Ctrl+Enter 插入，逻辑上开启新一轮对话（范式 I1）。
//   assistant-step         有可见 block → 正文（封口当前段，永不折叠）；
//                          仅推理 → 过程；两者皆无 → 空载步（恒隐藏）。
//   tool-call 非 skill     过程（折叠时显示与否由设置 auxVisible 按类型豁免）
//   tool-call = skill      辅助项（不计步数；同样受 auxVisible 豁免）
//   context                辅助项（auxVisible 豁免）
//   其余（turn-tail / turn-process / command / compaction / retry ...）
//                          结构节点：turn-tail 兼作「轮已闭合」信号，不参与折叠。

/** 消息 block 的最小读取面（官方 ChatBlock 的本地子集，只列本插件读的字段）。 */
export interface ChatBlock {
	kind: string;
	text?: string;
	attachment?: unknown;
	block?: unknown;
}

/** 聊天树节点数据（官方 node.data 的本地子集）。 */
export interface ChatNodeData {
	blocks?: (ChatBlock | undefined)[];
	status?: string;
	root?: { name?: string; call?: { name?: string } };
	// turn-process 官方控件读数
	toolCallCount?: number;
	messageCount?: number;
	subagentCount?: number;
}

/** 聊天树节点（官方 ChatNode 的本地子集：模型/投影只读 key/kind/location/data）。 */
export interface ChatNode {
	key: string;
	kind: string;
	location?: { kind: string; turn?: { turn: number } | null } | null;
	data?: ChatNodeData | null;
}

/** useChat ChatSnapshot（DSH 0.1.2：order + nodes store，nodes.get 兼容旧 Map 读法）。 */
export interface ChatSnapshot {
	order: readonly string[];
	nodes: { get(key: string): ChatNode | undefined };
}

/** 运行时守卫：getProjection 只对合法快照缓存。 */
export function isChatSnapshot(chat: unknown): chat is ChatSnapshot {
	const value = chat as ChatSnapshot | null | undefined;
	return value !== null && value !== undefined &&
		Array.isArray(value.order) && typeof value.nodes?.get === "function";
}

/** 一个折叠段：两个边界之间的过程/辅助节点集合（折叠单位）。 */
export interface Segment {
	segKey: string;
	keys: string[];
	steps: number;
	toolCalls: number;
	hasReasoning: boolean;
	latestKey: string | null;
	startCtx: "user" | "body" | "steering";
	// endType=body/boundary 时 segKey 即封口边界节点的 key（闭合段锚定信息
	// 直接读 segKey，不设冗余的 boundaryKey 字段）；messages 同理，恒等于
	// endType === "body" ? 1 : 0，由投影侧现算。
	endType: "body" | "boundary" | "open";
	prevBody: string | null;
}

export interface TurnModel {
	turn: number;
	closed: boolean;
	segments: Segment[];
	bodies: string[];
	processKey: string | undefined;
}

export interface Timeline {
	turns: TurnModel[];
	bodySeg: Record<string, string | null>;
	segByKey: Record<string, Segment>;
	nodes: { get(key: string): ChatNode | undefined };
}

export function hasReasoning(node: ChatNode | null | undefined): boolean {
	const blocks = node && node.data && node.data.blocks;
	if (!Array.isArray(blocks)) return false;
	return blocks.some((block) => block !== undefined && block !== null && block.kind === "reasoning");
}

export function toolCallName(node: ChatNode | null | undefined): string | undefined {
	return node?.data?.root?.name || node?.data?.root?.call?.name;
}

export function isSkillToolCall(node: ChatNode | null | undefined): boolean {
	return !!node && node.kind === "tool-call" && toolCallName(node) === "skill";
}

export type NodeRole = "boundary" | "body" | "process" | "aux" | "empty-step" | "skip";

export function classifyNode(node: ChatNode | null | undefined): NodeRole {
	if (!node) return "skip";
	if (node.kind === "user" || node.kind === "steering") return "boundary";
	if (node.kind === "assistant-step") {
		// 有可见 block（reasoning / tool-call 块不算可见内容）→ 正文
		if (node.data?.blocks?.some((block) => block !== undefined && block !== null && block.kind !== "reasoning" && block.kind !== "tool-call")) return "body";
		return hasReasoning(node) ? "process" : "empty-step";
	}
	if (node.kind === "tool-call") return isSkillToolCall(node) ? "aux" : "process";
	if (node.kind === "context" || node.kind === "system-prompt") return "aux";
	return "skip";
}

export function turnOf(node: ChatNode): number | undefined {
	const loc = node.location;
	if (!loc) return undefined;
	if (loc.kind === "turn" || loc.kind === "step") {
		return loc.turn ? loc.turn.turn : undefined;
	}
	return undefined;
}

// buildTimeline(order, nodes) → Timeline
//   turns       按轨迹首现顺序的 TurnModel
//   segKey 稳定格式：闭合段 = 段后边界节点的 key（正文或 steering 节点 key，
//                   全局唯一，跨「加载更早」/重渲染稳定）；开放段（流式尾段）
//                   = "t<turn>:open"，出现边界后自然换键为边界 key。
//   bodySeg     正文节点 key → 其前一段 segKey（正文内思维链联动展开）
//   segByKey    segKey → segment
//   nodes       原样透传（投影/补点按 key 反查节点）
// 规则（R，边界条件的全部清单）：
//   R1 轨迹顺序：严格按 order 迭代，不重排。
//   R2 边界封口：user/steering/正文 封口当前段并开启新段。
//   R3 轮闭合：turn 内出现 turn-tail 即闭合（不要求带最终正文 closing）——
//      中止/中断轮同样闭合，否则尾段被误判为“流式中”（B10 根因之一）。
//   R4 空段不落账：封口时 keys 为空的段不生成（正文有思维链时例外，
//      仍落账以便给出「1 条消息」栏联动正文内思维链）。
//   R5 尾段开放：轮末未封口的段 endType=open（流式尾段；轮闭合时它就是
//      中止轮尾段，见投影 F3）。
//   R6 栏锚定信息：记录每轮首个 turn-process 节点键（processKey，官方保证
//      有过程证据的轮必有此节点）、每段封口前同轮最后一个正文键（prevBody）
//      与段首前边界类型（startCtx：user=轮首段 / body / steering），供投影
//      把折叠栏落位到段首上方（B2）——栏不集中堆在轮顶，展开步骤在栏下方。
export function buildTimeline(order: readonly string[], nodes: ChatSnapshot["nodes"]): Timeline {
	const turns: TurnModel[] = [];
	const turnByKey: Record<number, TurnModel> = {};
	const bodySeg: Timeline["bodySeg"] = {};
	const segByKey: Timeline["segByKey"] = {};
	let model: TurnModel | null = null;
	let cur: Segment | null = null;
	let lastBody: string | null = null;
	let pendingCtx: Segment["startCtx"] = "user";

	function openSeg(): Segment {
		// segKey/endType 等在 closeSeg 封口时写入，开段时给占位值
		return {
			keys: [], steps: 0, toolCalls: 0, hasReasoning: false, latestKey: null,
			startCtx: pendingCtx,
			segKey: "", endType: "open", prevBody: null
		};
	}

	function closeSeg(endType: Segment["endType"], boundaryKey: string | undefined, bodyHasReasoning: boolean): void {
		let seg = cur;
		const keep = (seg !== null && seg.keys.length > 0) || (endType === "body" && bodyHasReasoning === true);
		if (keep && model !== null) {
			// 段未开（纯问答正文封空段）且正文带思维链时也落账（R4 例外）；
			// openSeg() 的 startCtx=pendingCtx 与原内联字面量逐字段相同。
			if (seg === null) seg = openSeg();
			seg.endType = endType;
			seg.prevBody = lastBody;
			seg.segKey = endType === "open" ? "t" + model.turn + ":open" : String(boundaryKey);
			segByKey[seg.segKey] = seg;
			model.segments.push(seg);
		}
		cur = null;
		if (endType === "body" && boundaryKey !== undefined) {
			// 正文的前段 = 封住它的段（其 segKey 即该正文键）；段未落账
			// （纯问答、无过程且正文无思维链）时为 null，正文内思维链
			// 不受任何栏联动。
			bodySeg[boundaryKey] = keep ? String(boundaryKey) : null;
		}
	}

	for (const key of order) {
		const node = nodes.get(key);
		if (!node) continue;
		const turn = turnOf(node);
		if (turn === undefined) continue;
		if (model === null || model.turn !== turn) {
			// 换轮前先封上一轮的尾段（正常轨迹由 user 边界封口，此处兜底）。
			if (cur !== null) closeSeg("open", undefined, false);
			model = turnByKey[turn];
			if (model === undefined) {
				model = { turn: turn, closed: false, segments: [], bodies: [], processKey: undefined };
				turnByKey[turn] = model;
				turns.push(model);
			}
			lastBody = null;
			pendingCtx = "user";
		}
		if (node.kind === "turn-tail") model.closed = true;
		if (node.kind === "turn-process" && model.processKey === undefined) model.processKey = key;
		const role = classifyNode(node);
		if (role === "body") {
			model.bodies.push(key);
			closeSeg("body", key, hasReasoning(node));
			lastBody = key;
			pendingCtx = "body";
			continue;
		}
		if (role === "boundary") {
			closeSeg("boundary", key, false);
			pendingCtx = node.kind === "steering" ? "steering" : "user";
			continue;
		}
		if (role === "skip") continue;
		if (cur === null) cur = openSeg();
		cur.keys.push(key);
		if (role === "process") {
			cur.steps += 1;
			if (node.kind === "tool-call") cur.toolCalls += 1;
			else cur.hasReasoning = true;
			cur.latestKey = key;
		}
	}
	if (model !== null) closeSeg("open", undefined, false);
	return { turns: turns, bodySeg: bodySeg, segByKey: segByKey, nodes: nodes };
}
