// Offline harness: mount the real plugin on the real Host Connection service
// (sibling webServer fiber, like the Desktop composition) and verify that its
// exact /api Fetch endpoint answers.
import { Context } from '../../ref/dsh-0.2.2/@deepseek-ai/cordis/lib/index.js'
import { HostConnectionService } from '../../ref/dsh-0.2.2/@deepseek-ai/dsh-client-connection/lib/index.js'

const root = new Context()
root.provide('credentials', {
  async readRecord() {}, async modifyRecord() {}, async resolve() {}, async describe() {},
  async describeRecord() {}, async listRecords() { return [] }, async set() {}, async unset() {}, async deleteRecord() {},
})
root.provide('agents', { get: () => undefined })
root.provide('systemPrompt', { context: () => () => {} })

await root.plugin({
  name: 'web-server-double',
  apply(ctx) {
    ctx.provide('webServer', {
      protocol: 'http:', port: 0,
      register() { return () => {} },
      collectIndexInjections() { return [] },
    })
  },
}).await()

let connectionService
await root.plugin({
  name: 'client-connection-double',
  inject: ['credentials'],
  apply(ctx) {
    connectionService = new HostConnectionService(ctx, [], {
      isAuthenticated: () => true,
      authenticateApi: () => undefined,
      authorizeConnect() {},
      authorizeIndex() { return true },
    })
  },
}).await()

const plugin = await import('../dist/index.js')
console.log('plugin inject:', plugin.inject.join(','))
const fiber = root.plugin(plugin, {})
await fiber.await()
console.log('plugin mounted')

const shared = connectionService.createSharedFetchHandler('/api')
const response = await shared.fetch(new Request('http://127.0.0.1/api/dsh-remote-ssh', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ endpoint: 'state', payload: { sessionId: 'session-1' } }),
}), connectionService.browserPeer)
console.log('status:', response.status)
const body = await response.json()
console.log('body ok:', body.ok, '| servers:', JSON.stringify(body.value?.servers))

await fiber.dispose?.()
console.log('plugin rpc harness ok')
