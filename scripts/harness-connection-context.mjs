// Reproduce the real 0.2.2 composition shape:
//  - `webServer` is provided by a SIBLING plugin fiber, so it is not on the
//    ancestor chain of the Connection service's fiber;
//  - `ctx.connection.rpc.handle()` resolves `owner.webServer` on that fiber and
//    therefore throws `cannot get property "webServer" without inject`;
//  - `ctx.connection.fetch.register()` only uses `owner.effect`, so it works.
import { Context } from '../../ref/dsh-0.2.2/@deepseek-ai/cordis/lib/index.js'
import { HostConnectionService } from '../../ref/dsh-0.2.2/@deepseek-ai/dsh-client-connection/lib/index.js'

const root = new Context()
root.provide('credentials', {
  async readRecord() {}, async modifyRecord() {}, async resolve() {}, async describe() {},
  async describeRecord() {}, async listRecords() { return [] }, async set() {}, async unset() {}, async deleteRecord() {},
})

const routes = []
// Sibling provider: webServer lives on this plugin's fiber, not on root.
await root.plugin({
  name: 'web-server',
  apply(ctx) {
    ctx.provide('webServer', {
      protocol: 'http:',
      port: 0,
      register(route) { routes.push(route); return () => {} },
      collectIndexInjections() { return [] },
    })
  },
}).await()

const browserAuth = {
  isAuthenticated: () => true,
  authenticateApi: () => undefined,
  authorizeConnect() {},
  authorizeIndex() { return true },
}

await root.plugin({
  name: 'client-connection-double',
  inject: ['credentials'],
  apply(ctx) { new HostConnectionService(ctx, [], browserAuth) },
}).await()

let rpcHandleError
let fetchRegisterError
await root.plugin({
  name: 'consumer',
  inject: ['connection'],
  apply(ctx) {
    try {
      ctx.connection.rpc.handle('/dsh-remote-ssh', async () => ({ ok: true, value: {} }))
    } catch (error) {
      rpcHandleError = error.message
    }
    try {
      ctx.connection.fetch.register({
        path: '/api/dsh-remote-ssh',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async () => Response.json({ ok: true, value: { hello: 1 } }),
      })
    } catch (error) {
      fetchRegisterError = error.message
    }
  },
}).await()

console.log('rpc.handle error:', rpcHandleError ?? '(none)')
console.log('fetch.register error:', fetchRegisterError ?? '(none)')

const service = root.connection
const shared = service.createSharedFetchHandler('/api')
const post = await shared.fetch(new Request('http://127.0.0.1/api/dsh-remote-ssh', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ endpoint: 'state', payload: {} }),
}), service.browserPeer)
console.log('POST /api/dsh-remote-ssh:', post.status, await post.text())
const get = await shared.fetch(new Request('http://127.0.0.1/api/dsh-remote-ssh', { method: 'GET' }), service.browserPeer)
console.log('GET /api/dsh-remote-ssh:', get.status)
console.log('webServer routes:', routes.map(route => `${route.kind}:${route.path}`).join(',') || '(none)')
