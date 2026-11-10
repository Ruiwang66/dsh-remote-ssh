// Offline harness: prove how a generic RPC channel is published by the real
// Host Connection service, using a fake webServer to record routes.
import { Context } from '../../ref/dsh-0.2.2/@deepseek-ai/cordis/lib/index.js'
import { HostConnectionService } from '../../ref/dsh-0.2.2/@deepseek-ai/dsh-client-connection/lib/index.js'

const routes = []
const root = new Context()
root.provide('webServer', {
  protocol: 'http:',
  port: 1234,
  register(route) { routes.push(route); return () => {} },
  collectIndexInjections() { return [] },
})
root.provide('credentials', {
  async readRecord() { return undefined },
  async modifyRecord() { return undefined },
  async resolve() { return undefined },
  async describe() { return { known: false } },
  async describeRecord() { return { known: false } },
  async listRecords() { return [] },
  async set() {},
  async unset() {},
  async deleteRecord() {},
})

const browserAuth = {
  isAuthenticated: () => true,
  authenticateApi: () => 'peer-1',
  authorizeConnect() {},
  authorizeIndex() { return true },
}

const service = new HostConnectionService(root, [], browserAuth)
console.log('connection service constructed:', service.name)

// A descendant context stands in for an installed plugin.
const pluginCtx = root.extend()
const dispose = pluginCtx.connection.rpc.handle('/dsh-remote-ssh', async () => ({ ok: true, value: {} }))
console.log('routes after handle():', routes.map(route => `${route.kind}:${route.path}`).join(','))
console.log('disposer type:', typeof dispose)
