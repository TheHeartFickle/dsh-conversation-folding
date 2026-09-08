// 加载真实的 lib/client.js bundle（生产工件本身，而非复制源码）：
// 模拟 window.__ModuleLoader__ 捕获模块定义，再以桩 require 调用 factory。
// 模型/投影是纯函数，测试只依赖 __test 导出；组件渲染不在单测范围。
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const primitivesStub = {
  MarkdownText: function MarkdownText() { return null; },
  JsonBlock: function JsonBlock() { return null; },
  DisclosureRow: function DisclosureRow() { return null; },
  IconThinkOutline14: function IconThinkOutline14() { return null; },
  IconChevronDownOutline14: function IconChevronDownOutline14() { return null; },
  Menu: function Menu() { return null; },
};

export async function loadClient() {
  const source = await readFile(fileURLToPath(new URL('../../lib/client.js', import.meta.url)), 'utf8');
  const definitions = [];
  const sandboxWindow = { __ModuleLoader__: { load(definition) { definitions.push(definition); } } };
  const requireStub = (name) => {
    if (name === 'react') return {};
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub;
    throw new Error(`load-client: unexpected require(${name})`);
  };
  // new Function 在当前 realm 编译：避免 vm.runInNewContext 产生异 realm 数组，
  // 使 deepEqual 等结构化断言与宿主对象语义一致。
  const boot = new Function('window', 'require', `${source}\n;`);
  boot(sandboxWindow, requireStub);
  if (definitions.length !== 1) throw new Error(`load-client: expected 1 module, got ${definitions.length}`);
  return definitions[0].factory(requireStub);
}

// 构造 ChatSnapshot 形状的测试节点（buildTimeline 只读 key/kind/location/data）。
let seqCounter = 0;
export function makeNode(kind, key, turn, data = {}) {
  seqCounter += 1;
  const seq = seqCounter;
  return {
    key,
    kind,
    id: key,
    target: 'chat',
    anchorSeq: seq,
    visibility: 'visible',
    location: turn === null
      ? { kind: 'session' }
      : {
          kind: 'step',
          turn: { turn, status: 'open', start: undefined, end: undefined, steps: [], data: undefined },
          step: { turn, step: 1, start: undefined, end: undefined, status: 'open', data: undefined },
        },
    data,
  };
}

export function makeStore(nodes) {
  const map = new Map(nodes.map((node) => [node.key, node]));
  return { get: (key) => map.get(key) };
}

export function resetSeq() {
  seqCounter = 0;
}
