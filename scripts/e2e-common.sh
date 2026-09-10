# =============================================================================
# scripts/e2e-common.sh — B 层无头 lane 的共享骨架（dsh-conversation-folding）
#
# 与 DSH-better-sidebar 的同名脚本同构：日志三件套、前置校验、scratch home 与
# 清理 trap、scratch profile 三件套、`dsh web` 后台启动与就绪轮询。
# 本 lane 的差异：
#   - profile 依赖需要 schemastery（本插件 host 半边的 peerDependency，
#     真实安装环境由 base bundle 传递提供，scratch profile 需显式声明）；
#   - 会话 fixture 由本仓库 tests/fixtures/sessions 播种进 scratch home；
#   - 就绪行解析含 token 的完整 URL（页面导航用它换取浏览器 cookie）。
#
# 用法：调用方先设 E2E_TAG 再 source；依赖调用方已 `set -euo pipefail`
# 并定义 ROOT（仓库根绝对路径）。
# =============================================================================

: "${E2E_TAG:?必须先设置 E2E_TAG（日志前缀）再 source e2e-common.sh}"

say()  { printf '\033[32m[%s]\033[0m %s\n' "$E2E_TAG" "$*"; }
warn() { printf '\033[33m[%s]\033[0m %s\n' "$E2E_TAG" "$*" >&2; }
die()  { printf '\033[31m[%s]\033[0m %s\n' "$E2E_TAG" "$*" >&2; exit 1; }

e2e_require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    if [ $# -ge 2 ]; then die "未找到 $1（$2）"; else die "未找到 $1"; fi
  fi
}

# PATH 上的 dsh 优先，否则回退 npx 拉官方包。
e2e_resolve_dsh_cmd() {
  if ! command -v "$DSH_CMD" >/dev/null 2>&1; then
    if command -v npx >/dev/null 2>&1; then
      say "PATH 上无 ${DSH_CMD}，回退 npx -y --package @deepseek-ai/dsh"
      DSH_CMD="npx -y --package @deepseek-ai/dsh dsh"
    else
      die "未找到 $DSH_CMD 或 npx；请先安装 DSH CLI（npm i -g @deepseek-ai/dsh）或用 DSH_CMD 指定"
    fi
  fi
}

# tarball 解析：TARBALL 显式给出时原样使用；否则取仓库根最新的
# the-heart-fickle-dsh-conversation-folding-*.tgz（按 mtime，避免字典序取到旧版）。
e2e_resolve_tarball() {
  if [ -z "${TARBALL:-}" ]; then
    TARBALL="$(ls -t "$ROOT"/the-heart-fickle-dsh-conversation-folding-*.tgz 2>/dev/null | head -1 || true)"
  fi
  [ -n "$TARBALL" ] && [ -f "$TARBALL" ]
}

# scratch home：始终在本调用拥有的全新目录里运行。DSH_HOME_BASE 给出时只在
# 其下新建子目录（调用方提供的目录本身绝不写入或删除）。
e2e_make_scratch() {
  if [ -n "${DSH_HOME_BASE:-}" ]; then
    SCRATCH="$(mktemp -d "$DSH_HOME_BASE/$1.XXXXXX")"
  else
    SCRATCH="$(mktemp -d /tmp/$1.XXXXXX)"
  fi
}

# EXIT trap：杀 dsh web 后台进程；按 KEEP_HOME 决定是否删除 scratch。
e2e_cleanup() {
  local code=$?
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [ -z "${KEEP_HOME:-}" ]; then
    if [ -d "${SCRATCH:-}" ]; then rm -rf "$SCRATCH"; fi
  else
    warn "KEEP_HOME 已设置，保留 $SCRATCH"
  fi
  exit "$code"
}

# 引导 scratch profile（web 模板，镜像 dsh initProfile + install.sh 的 pnpm 豁免）。
# schemastery 必须显式声明：本插件 host 半边把它当 peerDependency external，
# 真实安装环境由 base bundle 传递提供，scratch profile 里没有就会 ERR_MODULE_NOT_FOUND。
e2e_write_profile() {
  mkdir -p "$1"
  cat > "$1/package.json" <<'JSON'
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": { "schemastery": "^3.18.0" },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]
    }
  }
}
JSON
  printf '[]\n' > "$1/cordis.patch.yml"
  cat > "$1/pnpm-workspace.yaml" <<'YAML'
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false

allowBuilds:
  node-pty: true
  protobufjs: true

minimumReleaseAgeExclude:
  - '@the-heart-fickle/*'
  - '@deepseek-ai/*'
YAML
}

# 后台启动 dsh web（--port 0 = OS 分配）。$1 = 日志文件。写入全局 SERVER_PID。
e2e_start_dsh_web() {
  $DSH_CMD web --port "$PORT" --no-open >"$1" 2>&1 &
  SERVER_PID=$!
}

# 轮询就绪行（最多 120s），返回：0 = URL 已写入全局 URL；1 = 超时；2 = 提前退出。
# 就绪行形如 `dsh web: http://127.0.0.1:<port>/?token=<...>`；必须延伸到空白，
# 在 `/` 处截断会丢 token 导致首屏 401。
e2e_wait_dsh_web_ready() {
  URL=""
  local _
  for _ in $(seq 1 120); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then return 2; fi
    URL="$(grep -oE 'dsh web: http://127\.0\.0\.1:[0-9]+[^ ]*' "$1" | head -1 || true)"
    if [ -n "$URL" ]; then return 0; fi
    sleep 1
  done
  return 1
}
