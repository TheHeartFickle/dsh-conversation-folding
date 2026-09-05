// dsh-conversation-folding — 标准通道入口（dsh-plugin.json facets.host.entry）。
// 由 @dsh-std/adapter-dsh 的 profile loader 发现并激活：包根 default 导出一个
// FacetModule（@dsh-std/lifecycle 的激活形状，activate/deactivate/snapshot）。
//
// 本文件是标准通道的边界：不含任何 DSH 官方服务触点，只把 lib/commands.js 的
// 权威命令发布到 commands.dsh/v1alpha1。publish 返回的 disposer 已挂 activation
// scope，deactivate 时由宿主自动撤销，无需手动清理。
//
// 适配层现状（@dsh-std/adapter-dsh 0.1.1-rc.2）：
// - 标准通道没有 patch config，LocalStorage 只有协议定义、没有 provider，
//   因此 config 命令返回内置默认值（FOLDING_DEFAULTS）；
// - 官方通道（lib/index.js）仍从 cordis.patch.yml config 取值。
// 两条通道共用同一命令实现，上游通道语义变化时只改 commands.js。
import { COMMAND_API_VERSION, COMMAND_KIND, createFoldingCommands, FOLDING_DEFAULTS } from './commands.js'

const COMMAND_EXTENSION = Object.freeze({ apiVersion: COMMAND_API_VERSION, kind: COMMAND_KIND })

function createStdHost() {
  return Object.freeze({
    activate(context) {
      for (const command of createFoldingCommands({ resolveConfig: () => FOLDING_DEFAULTS })) {
        // 发布名 = 命令 id 的最后一段（manifest projection 生成的 metadata.name）
        const localName = command.id.split('.').at(-1)
        context.extensions.publish(COMMAND_EXTENSION, localName, {
          execute: (input, handlerContext) => command.execute(input, handlerContext),
        })
      }
    },
  })
}

export default createStdHost()
