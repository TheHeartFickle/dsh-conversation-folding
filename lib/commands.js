// dsh-conversation-folding — 权威命令面。
// client↔host 通信的唯一权威实现：官方 HTTP 通道（lib/index.js 的
// /api/conversation-folding 薄投影）与标准 Command 通道（lib/std-host.js 经
// @dsh-std/adapter-dsh 发布到 commands.dsh/v1alpha1 的命令）都委托到这里。
//
// 命令处理器契约（@dsh-std/command CommandHandler）：
//   execute({ rawInput }, { signal }) -> { kind: 'success' | 'error', text? }
// text 携带 JSON 序列化的结果，与官方 HTTP 通道的响应体逐字节同形。

export const COMMAND_API_VERSION = 'commands.dsh/v1alpha1'
export const COMMAND_KIND = 'Command'

// 标准通道的默认值（官方通道的 foldMode/auxVisible 来自 cordis.patch.yml config，
// 与 cordis.patch.yml 头部注释中记载的文档默认值一致）。
export const FOLDING_DEFAULTS = Object.freeze({
  foldMode: 'all',
  auxVisible: Object.freeze(['context', 'skill']),
})

// 与官方 HTTP 通道的历史语义逐字段一致：
// foldMode 缺失回退 'all'；auxVisible 仅在非数组时回退（用户显式配置的空数组保留）。
export function normalizeFoldingConfig(config) {
  return {
    foldMode: (config && config.foldMode) || FOLDING_DEFAULTS.foldMode,
    auxVisible: Array.isArray(config && config.auxVisible) ? config.auxVisible : FOLDING_DEFAULTS.auxVisible,
  }
}

export function createFoldingCommands({ resolveConfig }) {
  return [
    {
      id: 'the-heart-fickle.dsh-conversation-folding.config',
      spec: {
        title: 'Conversation folding config',
        description: 'Return the active foldMode and auxVisible settings as JSON',
      },
      async execute(input) {
        if (input && typeof input.rawInput === 'string' && input.rawInput.trim() !== '') {
          return { kind: 'error', text: 'this command takes no arguments' }
        }
        let config
        try {
          config = normalizeFoldingConfig(resolveConfig())
        } catch (error) {
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
        }
        return { kind: 'success', text: JSON.stringify({ ok: true, ...config }) }
      },
    },
  ]
}
