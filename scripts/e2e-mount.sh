#!/usr/bin/env bash
# =============================================================================
# dsh-conversation-folding B 层无头回归 lane（CI + 本地）
#
#   1. 用官方 CLI 把 npm 打包产物（tarball）装进一个全新 scratch profile
#      （`dsh plugin --profile web add file:<tarball>`，与用户安装路径一致）；
#   2. 把仓库内确定性会话 fixture 播种进 scratch home（不依赖 ~/.dsh 活会话）；
#   3. 启动真实 `dsh web`（keyless，--port 0 取 OS 分配端口，日志解析含 token URL）；
#   4. 运行 tests/e2e 无头渲染 lane（Playwright，默认系统 Chrome）。
#
# 用法：
#   bash scripts/e2e-mount.sh [--grep <playwright-filter>]
#
# 环境变量（均可省略）：
#   DSH_CMD        dsh 命令；缺省 PATH 上的 `dsh`，回退 npx 拉官方包
#   TARBALL        插件 tarball；缺省仓库根 the-heart-fickle-dsh-conversation-folding-*.tgz
#   PORT           固定端口（默认 0 = OS 分配，从日志解析 URL）
#   DSH_HOME_BASE  覆盖 scratch 根目录（默认系统临时目录）。脚本始终在其下
#                  新建本调用拥有的独立子目录，只写入/删除该子目录。
#   KEEP_HOME      非空时保留 scratch home（调试用）
#   DSH_E2E_CHANNEL  Playwright 浏览器通道（默认 chrome；none = 用自带 chromium）
#
# 退出码 = playwright 的退出码；服务器与 scratch 目录由 trap 兜底清理。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

E2E_TAG=e2e-mount
source "$SCRIPT_DIR/e2e-common.sh"

DSH_CMD="${DSH_CMD:-dsh}"
PORT="${PORT:-0}"
TARBALL="${TARBALL:-}"
GREP_FILTER=""
if [ "${1:-}" = "--grep" ]; then GREP_FILTER="${2:?--grep 需要参数}"; fi

e2e_require_cmd node "DSH 运行需要 Node.js >= 20"
e2e_require_cmd pnpm "dsh plugin 转发给 pnpm"
e2e_resolve_dsh_cmd
e2e_resolve_tarball || die "找不到 tarball（TARBALL 或 \$ROOT/the-heart-fickle-dsh-conversation-folding-*.tgz）——先运行 npm run build && npm pack"

# Git Bash / MSYS 下把路径转成 Windows 形式给 pnpm 与 dsh（纯 POSIX 上 cygpath 不存在，原样使用）。
win_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}
TARBALL_WIN="$(win_path "$TARBALL")"

e2e_make_scratch dsh-cf-e2e
export DSH_HOME="$SCRATCH/home"
WORKSPACE_DIR="$SCRATCH/workspace"
WEB_LOG="$SCRATCH/web.log"
mkdir -p "$DSH_HOME/profiles/web" "$WORKSPACE_DIR"
say "scratch home: ${DSH_HOME}（DSH_HOME=${DSH_HOME}）"

SERVER_PID=""
trap e2e_cleanup EXIT

# 步骤 1：scratch profile + 官方 CLI 安装 tarball
PROFILE_DIR="$DSH_HOME/profiles/web"
e2e_write_profile "$PROFILE_DIR"
say "执行 dsh plugin --profile web add file:${TARBALL_WIN} ..."
$DSH_CMD plugin --profile web add "file:${TARBALL_WIN}"

if ! node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const bundles = p.dsh?.profile?.bundles ?? [];
  process.exit(bundles.includes("@the-heart-fickle/dsh-conversation-folding") ? 0 : 1);
' "$PROFILE_DIR/package.json"; then
  warn "插件未出现在 dsh.profile.bundles 中——挂载未注册"
  cat "$PROFILE_DIR/package.json" >&2
  exit 1
fi
say "挂载已注册：dsh.profile.bundles 含 @the-heart-fickle/dsh-conversation-folding"

# 步骤 2：播种确定性会话 fixture + 预置 fold 显示模式
say "播种会话 fixture ..."
node "$ROOT/scripts/plant-fixtures.mjs" "$ROOT/tests/fixtures/sessions" "$(win_path "$DSH_HOME/sessions")" "$(win_path "$WORKSPACE_DIR")"
printf 'dsh-conversation-folding:\n  displayMode: fold\n' > "$DSH_HOME/settings.yaml"

# 步骤 3：启动 dsh web
say "启动 dsh web（port=${PORT}）..."
e2e_start_dsh_web "$WEB_LOG"

WAIT_RC=0
e2e_wait_dsh_web_ready "$WEB_LOG" || WAIT_RC=$?
if [ "$WAIT_RC" -eq 2 ]; then
  echo "=== dsh web 提前退出，日志尾部 ===" >&2
  tail -30 "$WEB_LOG" >&2 || true
  exit 1
fi
if [ "$WAIT_RC" -ne 0 ]; then
  echo "=== 120s 内未等到 dsh web 就绪，日志尾部 ===" >&2
  tail -40 "$WEB_LOG" >&2 || true
  exit 1
fi
URL_ONLY="${URL#dsh web: }"
say "dsh web 就绪：${URL_ONLY}（pid ${SERVER_PID}）"

# 步骤 4：运行无头 lane
say "运行 Playwright 无头 lane ..."
DSH_E2E_URL="$URL_ONLY" DSH_E2E_WORKSPACE="$(win_path "$WORKSPACE_DIR")" \
  npx playwright test ${GREP_FILTER:+--grep "$GREP_FILTER"}

say "通过：插件挂载到真实 DSH 后无头回归全绿"
