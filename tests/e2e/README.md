# B 层无头回归 lane（Playwright，自包含）

对应 `docs/REGRESSION.md` 的 B 条目。**clone 仓库后一条命令即可跑**，不依赖
任何版本控制之外的环境（无硬编码 token、无活会话 fixture、无计划任务）。

```bash
npm run test:e2e     # = pretest:e2e（npm run build && npm pack）+ bash scripts/e2e-mount.sh
```

tarball 由 `pretest:e2e` 钩子每次自动重建（避免测到旧产物）；只在需要单独
出包时才用 `npm run pack:e2e`。

## 它做了什么

`scripts/e2e-mount.sh`（骨架 `scripts/e2e-common.sh`）：

1. `mktemp -d` 建一个全新 scratch `DSH_HOME`（**绝不写/删真实 `~/.dsh`**），
   写入最小 web profile 三件套（`package.json` / `cordis.patch.yml` /
   `pnpm-workspace.yaml`；`schemastery` 必须显式声明——本插件 host 半边的
   peerDependency，真实安装环境由 base bundle 传递提供）；
2. 官方 CLI 装包：`dsh plugin --profile web add file:<tarball>`，校验
   `dsh.profile.bundles` 已注册本插件；
3. `scripts/plant-fixtures.mjs` 把 `tests/fixtures/sessions` 的会话 fixture
   播种进 scratch home：解出 header 帧 → 改写 `cwd` 为本次 scratch 工作区
   路径 → 按 dsh 的写盘方式重压缩（每事件一帧、带 checksum）→ 与其余帧拼接；
4. 预置 `settings.yaml` 的 `dsh-conversation-folding.displayMode: fold`；
5. 启动真实 `dsh web --port 0 --no-open`（OS 分配端口），从日志解析含 token
   的启动 URL；
6. `DSH_E2E_URL` / `DSH_E2E_WORKSPACE` 注入后跑 `npx playwright test`
   （`tests/e2e/*.e2e.ts`）；
7. EXIT trap 杀服务器 + 删 scratch 目录（`KEEP_HOME=1` 可保留调试）。

浏览器默认用系统已装的 Chrome（`playwright.config.ts` 的 `channel: 'chrome'`），
不要求 `npx playwright install`；无 Chrome 时用 `DSH_E2E_CHANNEL=none` 回退
Playwright 自带 chromium。

## Fixture

| fixture | 特征 | 覆盖 |
|---|---|---|
| `session-9155068a-03e0-4a40-aa25-c30ae6faf769` | 自包含会话（6 轮：4 完成 / 2 中止），多正文段、工具调用、思维链、代码围栏、`load earlier` 多页历史 | T-A2/B1/B2/B3/B4/B5/C1/C2/C3/C4/C5/D1/D2/E1/E3/F1/F2/F3 |

fixture 由真实会话归档派生：header 去掉 `agentPreset`/`parentSession`/`seedLength`
（会话自包含，无继承前缀），其余事件逐帧保留。`cwd` 在播种时改写为 scratch
工作区路径，因此同一 fixture 可在任意机器/路径下复现。

## 只读约束与全局失败判据

所有 spec 只做只读交互（导航、开会话、翻历史、展开/收起、切模式、设置开关、
读 DOM/computedStyle）——**零 LLM 计费**：禁止发送消息、Ctrl+Enter、重试/
重新生成、新建会话。每个 spec 结束断言全局失败判据：`[data-slot-error]` 为 0、
无 `[data-dsh-debug-error]`、无 `window.__DF_*`。

## 与 `test/browser/*.py` 的关系

`test/browser/*.py` 是历史 browser-harness 脚本（依赖活实例 + `.dsh-test-env.md`
注入 token），保留作为本机实测工具，**不再是回归入口**。二者断言同源：
Python 脚本里的 JS 断言已逐条移植为 `tests/e2e` 的 Playwright spec，并补上了
变异轮发现的缺口（T-B2 计数交叉断言、T-D1 不拉到顶硬断言）。

## 已知覆盖边界（与 REGRESSION.md 的 LIMITATION 对齐）

- **T-E1/E2/E3 的流式阶段**（实时尾段栏、预览收敛、视口贴底）：需要实时流式
  = 计费交互，禁止；静态部分（unhide 规则、滚动容器解析）已在 e2e 断言，
  动态规则由 M 层 `test/model.test.mjs`（R2/R5/F4）与
  `test/projection-edge.test.mjs`（T-E1/E2）覆盖。
- **T-G1/G2（Ctrl+Enter 插入 / steering 切段）**：插入本身是计费交互，且现有
  归档会话中无可辨识的 steering 节点；不变量 I1 与分段计数由 M 层覆盖。
- **T-F1 的「重启 dsh web 后保持」**：重启属环境步骤（会轮换 token）；scratch
  home 每次重建 + `settings.yaml` 播种间接覆盖配置持久化。
- **F4 预览的浏览器观测面**：需要「轮未闭合的开放段」；所有归档会话在宿主投影
  里都已闭合（`turn-tail` 节点出现），静态 fixture 无法复现流式中状态。F4 由
  M 层 `model.test.mjs`「R2/R5 流式开放轮」与 `projection-edge.test.mjs`
  「T-E1 流式多隐藏步」精确覆盖（变异 M17 已被这两条捕获）。
- **补点循环内部（停止条件 S1/S2、按钮重挂重找、按钮文案识别）**：本 lane 的
  fixture 被监视段一页即补完，用户那次点击本身就已满足 S1，因此正常态与变异态
  都只观测到 1 次点击——浏览器侧无判别力（实测：autoload 变异 M1–M4 全部幸存）。
  该循环由 M 层 `test/autoload.test.mjs` 用 DOM 桩 + 假定时器驱动真实 bundle
  覆盖（5 例，变异 M1–M6 全部被捕获）。本 lane 只负责端到端可观测面：不拉到顶、
  点击后确实前插了历史、补页过程中可见 tool-call 保持 0。
