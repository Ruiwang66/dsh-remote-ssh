// Offline harness: mount the host plugin with fake DSH services and exercise
// the published /api Fetch endpoint.
import { Context } from '../../ref/dsh-0.2.2/@deepseek-ai/cordis/lib/index.js'

const routes = []
const ctx = new Context()

ctx.provide('connection', {
  fetch: {
    register(route) {
      routes.push(route)
      return async () => { routes.splice(routes.indexOf(route), 1) }
    },
  },
})
ctx.provide('agents', { get: () => undefined })
ctx.provide('systemPrompt', { context: () => () => {} })

const plugin = await import('../dist/index.js')
const fiber = ctx.plugin(plugin, {})
await fiber.await?.()
console.log('mounted; inject:', plugin.inject.join(','))
console.log('endpoints:', routes.map(route => `${route.path} [${route.methods.join(',')}]`).join(','))

const route = routes.find(candidate => candidate.path === '/api/dsh-remote-ssh')
if (!route) throw new Error('the /api/dsh-remote-ssh endpoint was not registered')

async function call(endpoint, payload) {
  const response = await route.fetch(new Request('http://127.0.0.1/api/dsh-remote-ssh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, payload }),
  }))
  return response.json()
}

const state = await call('state', { sessionId: 'session-1' })
console.log('state:', JSON.stringify(state))
const invalid = await call('server.test', { server: { name: '' } })
console.log('invalid test:', invalid.ok, invalid.error?.code, invalid.error?.message)
const switched = await call('target.set', { sessionId: 'session-1', target: { type: 'local' } })
console.log('switch local:', JSON.stringify(switched.value?.target))

await fiber.dispose?.()
console.log('harness ok')
