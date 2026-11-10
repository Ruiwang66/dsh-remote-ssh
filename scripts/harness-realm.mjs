// Offline harness: compose the SSH execution realm on a real Cordis context
// with the official tool registry, then list the model-facing tool set.
import { Context } from '../../ref/dsh-0.2.2/@deepseek-ai/cordis/lib/index.js'
import { ToolsService } from '../../ref/dsh-0.2.2/@deepseek-ai/dsh-tools/lib/index.js'

const ctx = new Context()

ctx.provide('systemPrompt', {
  section: () => () => {},
  context: () => () => {},
  tools: () => () => {},
  variable: () => () => {},
  getSectionOrder: () => 0,
  getContextOrder: () => 0,
  suppressRuntimeContext: () => () => {},
  assemble: async () => ({ sections: [], contexts: [], variables: {}, tools: [] }),
})

await ctx.plugin(ToolsService).await()

const plugin = await import('../dist/index.js')
const server = {
  id: 'srv_test',
  name: 'test server',
  host: '127.0.0.1',
  port: 22,
  username: 'root',
  remoteRoot: '/root',
  auth: { type: 'agent' },
}
const connections = {
  async sftp() { throw new Error('no live transport in harness') },
  async exec() { return { stdout: '', stderr: '', exitCode: 0 } },
  async ensure() { throw new Error('no live transport in harness') },
}

const fiber = ctx.plugin(plugin.RemoteExecutionRealm, {
  server,
  connections,
  resolvedEnvironment: { home: '/root', cwd: '/root' },
})
await fiber.await()

const tools = ctx.tools.definitions()
console.log('tools:', tools.map(tool => tool.name).sort().join(', '))

const read = ctx.tools.get('read')
console.log('read tool present:', Boolean(read))

await fiber.dispose?.()
console.log('realm harness ok')
