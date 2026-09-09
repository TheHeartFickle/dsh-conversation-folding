# B 层浏览器回归脚本（browser-harness）

对应 `docs/REGRESSION.md` 的 B 层条目。每个脚本自包含，可直接执行：

```bash
browser-harness < test/browser/T-A2.py
```

- 目标实例与 token：见仓库根 `.dsh-test-env.md`（token 每次重启 dsh web 后轮换，
  从 `.dsh-web.out.log` 重新读取；脚本顶部的 `TOKEN` 需同步更新）。
- **硬约束**：所有脚本只做只读交互（导航、打开会话、翻历史、展开/收起折叠栏、
  切换显示模式、设置页开关、DOM/computedStyle/localStorage 读取）。
  禁止发送消息、Ctrl+Enter 插入、重试/重新生成、新建会话——零 LLM 计费。
- 全局失败判据（每个脚本均断言）：`[data-slot-error]` 数量为 0，
  无 `data-dsh-debug-error` / `window.__DF_*`。
- 脚本编码：browser-harness 经 stdin 读脚本，Windows 下非 ASCII 会变成
  surrogate 崩溃；因此脚本正文与注释全部 ASCII，中文字面量用 `\uXXXX` 转义。

## 已验证的调用方式（2026-09-09 实测）

- `echo "print(page_info())" | browser-harness` —— 连通性检查（helpers 已预导入）。
- `browser-harness < test/browser/T-XX.py` —— 执行脚本；`js()` 的返回值若是
  JSON 对象可能被自动解析为 dict，断言前用
  `r if isinstance(r, (dict, list)) else json.loads(r)` 兜底。
- 可用 helpers：`goto_url`、`wait_for_load`、`js`、`page_info`、
  `click_at_xy`、`capture_screenshot`（本次环境中截图会超时，勿依赖）、
  `new_tab`（**无** `new_tab_background`/`attach_tab`，与 skill 文档有出入）。
- UI 定位要点（0.1.2-rc.1 web 端实测）：
  - 会话树：`.YDXeBa_projectRow`（工作区）/ `.YDXeBa_sessionRow`（会话）；
    组按点击开合；`新会话` 行绝不可点（会创建会话）。
  - 设置页：`.dsh-tv-row` / `.dsh-tv-selector`（对话显示下拉）；
    下拉项为 `[class*=_item_]` 的按钮，文案 `Normal/Compact/Fold`；
    插件页签文案 `对话折叠`，开关行 `.dsh-fs-row`（恰 18 行）。
  - 设置页每次模式切换后 `location.reload()`，重载后需重新打开会话。

## Fixture 映射（~/.dsh/sessions/ 实测）

| fixture | 位置 | 特征 | 用于 |
|---|---|---|---|
| 开发会话（dsh-conversation-folding 开发过程，标题随时间变化，曾为 "git-project…" / "ponytail-review…"） | 工作区 `git-project` 组第一个非「新会话」会话 | 多段正文、多工具调用、思维链、中止轮（segKey `tN:open`）、`.dsh-assistant-stopped`、内联代码块 | T-A2/B1/B2/B3/B4/B5/C1/C2/C3/C5/F2/F3 |
| 长会话（"生成HWTD测试用例代码"，约 4 天前） | 工作区 `AutoTest_Dotnet` 组第一个会话 | 117+ keys，多页历史，「加载更早」可用 | T-D1（D2 部分）、T-C4 亦可 |
| 会话 fixture：steering/Ctrl+Enter 插入 | **未找到**（FIXTURE-MISSING） | 需要同 turn 内含 steering 插入且两侧均有过程步骤；DOM 中 steering 节点无可辨识标记，且制造该会话属计费交互 | T-G2（G1 双重受限） |

注意：fixture 是"活"的（本会话开发仍在进行，正文/轮数会增长）。脚本一律用
「组内第一个非『新会话』行」动态定位，不写死标题。

## 脚本清单与状态（2026-09-09 全部实跑）

| 脚本 | 条目 | 状态 | 备注 |
|---|---|---|---|
| T-A2.py | T-A2 | ✅ 已跑通 | Normal/Compact 零介入、Fold 出栏；模式经 reload 持久化；结束恢复 Compact+Fold |
| T-B1.py | T-B1 | ✅ 已跑通 | 33px/细底边/透明背景/chevron -90°↔0°（读值时须禁用 transition，见下） |
| T-B2.py | T-B2 | ✅ 已跑通 | 34 栏文案全部命中四种官方格式（mixed 20/tools 6/msgs 8/thought 0）；展开收起文案不变 |
| T-B3.py | T-B3 | ✅ 已跑通 | 收起栏均紧贴其后内容（无轮顶堆叠）；展开步骤在栏下方 |
| T-B4.py | T-B4 | ✅ 已跑通 | 多段独立展开、互不影响、重渲染保持（跨 reload 不保持属预期：segStore 为内存态） |
| T-B5.py | T-B5 | ✅ 已跑通 | 48 个相邻可见条目间距恒 16px；0 渲染态隐藏座位 |
| T-C1.py | T-C1 | ✅ 已跑通 | 正文永不隐藏；收起/展开两态正文文本逐 key 一致（排除 .dsh-think 联动子树） |
| T-C2.py | T-C2 | ✅ 已跑通 | Σ栏计数 49 + 豁免基线 1 = 展开后可见 50；思维链不丢失 |
| T-C3.py | T-C3 | ✅ 已跑通 | 中止轮 `t8:open`：收起 0 可见 → 展开 2 工具+1 思维链 → 再收起 0 |
| T-C4.py | T-C4 | ✅ 已跑通 | 补页全程可见 tool-call 不超过豁免基线；动态规则存在；无 slot error |
| T-C5.py | T-C5 | ✅ 已跑通 | 12 个可见正文含渲染 code 元素、0 debug error（围栏块随虚拟化滚出视口时以 `pre` 计数为准） |
| T-D1.py | T-D1 / T-D2 | ✅ 已跑通（D2 部分） | 1 次真实点击 → 补点 4 次点击、firstBar segKey 前移（S1）、未拉到顶部；**D2 的重挂观测 remounts=0**（本次翻页未触发按钮重挂，重找路径未走到，属 PARTIAL） |
| T-E1.py | T-E1 | ⚠️ 仅静态 | `LIMITATION:` 流式阶段断言需实时流式（计费），静态 unhide 规则已验 |
| T-E2.py | T-E2 | ⚠️ 仅静态 | `LIMITATION:` 流式预览/收敛需实时流式（计费）；M 层 R2/R5/F4 覆盖 |
| T-E3.py | T-E3 | ⚠️ 仅静态 | `LIMITATION:` 需实时思维链出现（计费）；已验 `[data-chat-flow]` 向上解析滚动容器成功 |
| T-F1.py | T-F1 | ✅ 已跑通（重启保持除外） | 独立页签、18 行开关、即时生效、自有路由 GET ok；`NOT-COVERED:` 重启持久化需重启 dsh web（token 轮换），人工执行 |
| T-F2.py | T-F2 | ✅ 已跑通 | Bash 开关 off→23 个工具调用始终可见，on→恢复 0；结束已还原 |
| T-F3.py | T-F3 | ✅ 已跑通 | Normal/Compact：0 栏、动态样式空、无错误；Fold 还原正常 |
| T-G1.py | T-G1 | 🚫 LIMITATION | `LIMITATION:` Ctrl+Enter 插入 = 计费交互；I1 不变量由 M 层覆盖 |
| T-G2.py | T-G2 | 🚫 FIXTURE-MISSING | 无含可见 steering 的会话 fixture；分段/计数不变量由 M 层覆盖 |

## 实测发现（供对抗子代理/维护者参考）

1. **chevron 旋转的测量陷阱（非缺陷）**：折叠栏位于 `content-visibility` 优化
   的虚拟化子树内，CSS transition（transform .1s）在离屏元素上不会推进，
   `getComputedStyle` 永远读到过渡起点 `rotate(-90deg)`。禁用 transition 再读
   （或与新鲜克隆对比）可得正确值 `rotate(0)`。T-B1/T-B2 已按此处理。
2. **`.dsh-assistant-root` 的 textContent 含随段联动的思维链**（ThinkBox 收起
   /展开切换），跨状态对比正文必须排除 `.dsh-think` 子树（T-C1）。
3. **豁免类型 tool-call（skill 等）在收起态可见是设计行为**，任何「可见
   tool-call 数=0」的断言都要以「豁免基线」为参照（T-C2/T-C4）。
4. REGRESSION.md T-A2 写的 `localStorage["dsh-conversation-folding.displayMode"]`
   在实测中时有时无（T-A2 首次运行存在、T-F1 运行为空）——当前插件实现不写
   localStorage（配置走 host settings.yaml），该键疑似环境残留；脚本只做观测
   不作为判据。
5. browser-harness 版本差异：无 `new_tab_background`/`attach_tab`；
   `capture_screenshot` 在本实例上超时。
