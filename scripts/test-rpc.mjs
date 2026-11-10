// End-to-end RPC test with a real ssh2 server, the real Host Connection
// service, and the real plugin channel over HTTP.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '../../ref/dsh-0.2.2/@deepseek-ai/cordis/lib/index.js'
import { HostConnectionService } from '../../ref/dsh-0.2.2/@deepseek-ai/dsh-client-connection/lib/index.js'
import ssh2 from 'ssh2'

const { Server: SshServer, utils: sshUtils } = ssh2

const tmp = mkdtempSync(join(tmpdir(), 'dsh-remote-ssh-test-'))
process.env.DSH_HOME = join(tmp, 'home')
mkdirSync(process.env.DSH_HOME, { recursive: true })

let passed = 0
let failed = 0
function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ok  ${label}`)
  } else {
    failed += 1
    console.error(`FAIL  ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`)
  }
}

// ---------------------------------------------------------------- ssh server
const hostKey = sshUtils.generateKeyPairSync('ed25519')
const clientKey = sshUtils.generateKeyPairSync('ed25519')
const clientKeyPath = join(tmp, 'id_ed25519')
writeFileSync(clientKeyPath, clientKey.private, { mode: 0o600 })

let authMode = 'password'
const sshServer = new SshServer({ hostKeys: [hostKey.private] }, client => {
  client.on('error', error => {
    // A refused host key makes the client drop the handshake during KEX; that
    // is the expected path for the untrusted-fingerprint test.
    if (!/KEY_EXCHANGE_FAILED/u.test(String(error?.message))) {
      console.error('ssh server saw client error:', error?.message)
    }
  })
  client.on('authentication', auth => {
    if (authMode === 'password') {
      if (auth.method === 'password') {
        if (auth.username === 'tester' && auth.password === 's3cret') return auth.accept()
        return auth.reject()
      }
      return auth.reject(['password'])
    }
    if (auth.method === 'publickey') {
      const expected = sshUtils.parseKey(clientKey.public).getPublicSSH()
      if (auth.username === 'tester' && Buffer.compare(auth.key.data, expected) === 0) return auth.accept()
      return auth.reject(['publickey'])
    }
    return auth.reject(['publickey'])
  })
  client.on('ready', () => {
    client.on('session', accept => {
      const session = accept()
      session.on('exec', acceptExec => {
        const stream = acceptExec()
        stream.write('Linux\n/bin/bash\n')
        stream.exit(0)
        stream.end()
      })
      session.on('sftp', acceptSftp => {
        const sftp = acceptSftp()
        sftp.on('REALPATH', reqid => {
          sftp.name(reqid, [{ filename: '/home/tester', longname: '/home/tester', attrs: {} }])
        })
      })
    })
  })
})
await new Promise(resolve => sshServer.listen(0, '127.0.0.1', resolve))
const sshPort = sshServer.address().port

// ------------------------------------------------------- host connection ctx
// Mirror the real composition: `webServer` belongs to a sibling plugin fiber,
// and the Connection service lives in its own fiber (`inject: ['credentials']`).
// A generic rpc.handle() channel cannot work there; the exact /api Fetch route
// can, which is what this test exercises.
const plugin = await import('../dist/index.js')

// One in-memory credential store shared by every simulated Host restart.
const credentialRecords = new Map()

function credentialService() {
  return {
    async readRecord(key) { return credentialRecords.get(String(key)) },
    async modifyRecord(key, mutate) {
      const next = await mutate(credentialRecords.get(String(key)))
      if (next !== undefined) credentialRecords.set(String(key), next)
      return next
    },
    async deleteRecord(key) { credentialRecords.delete(String(key)) },
    async describeRecord(key) { return { configured: credentialRecords.has(String(key)), writable: true } },
    async listRecords() { return [...credentialRecords.keys()].map(key => ({ key, kind: 'grant' })) },
    async resolve() { return undefined },
    async describe() { return { configured: false, writable: true } },
    async set() {},
    async unset() {},
  }
}

async function createHost() {
  let connectionService
  const routes = []
  const root = new Context()
  root.provide('credentials', credentialService())
  root.provide('agents', { get: () => undefined })
  root.provide('systemPrompt', { context: () => () => {} })

  await root.plugin({
    name: 'web-server-double',
    apply(ctx) {
      ctx.provide('webServer', {
        protocol: 'http:',
        port: 0,
        register(route) { routes.push(route); return () => {} },
        collectIndexInjections() { return [] },
      })
    },
  }).await()

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

  const fiber = root.plugin(plugin, {})
  await fiber.await()
  const shared = connectionService.createSharedFetchHandler('/api')

  async function call(method, payload = {}) {
    const response = await shared.fetch(new Request('http://127.0.0.1/api/dsh-remote-ssh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: method, payload }),
    }), connectionService.browserPeer)
    check(`HTTP ${method} status 200`, response.status === 200, response.status)
    const body = await response.json()
    if (body.ok !== true) return { ok: false, error: body.error }
    return { ok: true, value: body.value }
  }

  return { root, fiber, shared, call, routes, peer: connectionService.browserPeer }
}

const host = await createHost()
const shared = host.shared
const call = host.call
console.log('plugin mounted; inject:', plugin.inject.join(','))

const methodsProbe = await shared.fetch(new Request('http://127.0.0.1/api/dsh-remote-ssh', { method: 'GET' }), host.peer)
check('non-POST method is refused', methodsProbe.status === 404, methodsProbe.status)

// ------------------------------------------------------------------- tests
async function runTests() {
const serverBase = {
  name: 'local test',
  host: '127.0.0.1',
  port: sshPort,
  username: 'tester',
  remoteRoot: '~',
  auth: { type: 'password' },
}

console.log('\n[1] state')
const initialState = await call('state', { sessionId: 'sess-test' })
check('state returns empty servers', initialState.ok && Array.isArray(initialState.value.servers) && initialState.value.servers.length === 0, initialState)
check('state target is local', initialState.ok && initialState.value.target.type === 'local')

console.log('\n[2] untrusted host key')
const untrusted = await call('server.testAndSave', { sessionId: 'sess-test', server: serverBase, password: 's3cret' })
check('untrusted key reports HOST_KEY_UNTRUSTED', !untrusted.ok && untrusted.error.code === 'HOST_KEY_UNTRUSTED', untrusted.error)
check('untrusted key includes SHA256 fingerprint', !untrusted.ok && /^SHA256:/.test(String(untrusted.error.details?.fingerprint)), untrusted.error?.details)
const fingerprint = untrusted.error?.details?.fingerprint

console.log('\n[3] authentication failure')
const badPassword = await call('server.testAndSave', { sessionId: 'sess-test', server: serverBase, password: 'wrong', allowFingerprint: fingerprint })
check('wrong password reports AUTH_FAILED', !badPassword.ok && badPassword.error.code === 'AUTH_FAILED', badPassword.error)
const afterFailure = await call('state', { sessionId: 'sess-test' })
check('failed connection saves nothing', afterFailure.ok && afterFailure.value.servers.length === 0)

console.log('\n[4] successful password login saves server')
const saved = await call('server.testAndSave', { sessionId: 'sess-test', server: serverBase, password: 's3cret', allowFingerprint: fingerprint })
check('save succeeds', saved.ok === true, saved.error)
const savedServer = saved.ok ? saved.value.server : undefined
check('saved server has id', typeof savedServer?.id === 'string' && savedServer.id.length > 0)
check('saved server stores the fingerprint', savedServer?.hostKeyFingerprint === fingerprint, savedServer?.hostKeyFingerprint)
check('saved server never contains a password', savedServer !== undefined && !JSON.stringify(savedServer).includes('s3cret'))

const statePath = join(process.env.DSH_HOME, 'remote-ssh', 'state.json')
const onDisk = readFileSync(statePath, 'utf8')
check('state file persists the server', onDisk.includes(savedServer.id))
check('state file contains no password value or password key', !onDisk.includes('s3cret') && !onDisk.toLowerCase().includes('"password":'))
check('remembered password is stored as a credential record', credentialRecords.size === 1)
const withStored = await call('state', { sessionId: 'sess-test' })
check('state reports passwordStored without the value', withStored.ok
  && withStored.value.servers.find(server => server.id === savedServer.id)?.passwordStored === true
  && !JSON.stringify(withStored.value).includes('s3cret'))

console.log('\n[4b] remembering is opt-out')
const forgotten = await call('server.testAndSave', {
  sessionId: 'sess-test',
  server: { ...serverBase, id: savedServer.id },
  password: 's3cret',
  rememberPassword: false,
})
check('rememberPassword:false clears the record', forgotten.ok === true && credentialRecords.size === 0, forgotten.error)
const remembered = await call('server.testAndSave', {
  sessionId: 'sess-test',
  server: { ...serverBase, id: savedServer.id },
  password: 's3cret',
  rememberPassword: true,
})
check('rememberPassword:true stores the record again', remembered.ok === true && credentialRecords.size === 1, remembered.error)

console.log('\n[5] re-test of the saved server reuses the trusted fingerprint')
const retest = await call('server.testAndSave', { sessionId: 'sess-test', server: { ...serverBase, id: savedServer.id }, password: 's3cret' })
check('re-test without explicit trust succeeds', retest.ok === true, retest.error)

console.log('\n[6] private key login')
authMode = 'key'
const keyServer = { ...serverBase, name: 'key test', auth: { type: 'key', keyPath: clientKeyPath } }
const keySaved = await call('server.testAndSave', { sessionId: 'sess-test', server: keyServer, allowFingerprint: fingerprint })
check('private key login succeeds', keySaved.ok === true, keySaved.error)
check('private key server saved without key material', keySaved.ok && !JSON.stringify(keySaved.value.server).includes(clientKey.private.slice(0, 40)))

console.log('\n[7] network failure')
const refused = await call('server.testAndSave', {
  sessionId: 'sess-test',
  server: { ...serverBase, name: 'closed port', port: 1 },
  password: 's3cret',
  allowFingerprint: fingerprint,
})
check('closed port reports NETWORK_REFUSED', !refused.ok && refused.error.code === 'NETWORK_REFUSED', refused.error)

console.log('\n[8] switching the execution target')
authMode = 'password'
const switched = await call('target.set', { sessionId: 'sess-test', target: { type: 'ssh', serverId: savedServer.id } })
check('target.set connects and commits', switched.ok === true && switched.value.target.type === 'ssh', switched.error)
const afterSwitch = await call('state', { sessionId: 'sess-test' })
check('state reports ssh target', afterSwitch.ok && afterSwitch.value.target.serverId === savedServer.id)

console.log('\n[9] restart hydration from the credential store')
authMode = 'password'
const restarted = await createHost()
const hydrated = await restarted.call('target.set', { sessionId: 'sess-other', target: { type: 'ssh', serverId: savedServer.id } })
check('a fresh Host reconnects without a typed password', hydrated.ok === true, hydrated.error)
const restartedState = await restarted.call('state', { sessionId: 'sess-other' })
check('fresh Host reports the stored password', restartedState.ok
  && restartedState.value.servers.find(server => server.id === savedServer.id)?.passwordStored === true)
await restarted.fiber.dispose?.()

console.log('\n[10] removing a server resets its sessions')
const removed = await call('server.remove', { sessionId: 'sess-test', serverId: savedServer.id })
check('remove succeeds', removed.ok === true, removed.error)
check('removing the server deletes its credential record', credentialRecords.size === 0)
const afterRemove = await call('state', { sessionId: 'sess-test' })
check('removed server disappears', afterRemove.ok && !afterRemove.value.servers.some(server => server.id === savedServer.id))
check('sessions fall back to local', afterRemove.ok && afterRemove.value.target.type === 'local')

console.log('\n[11] reload from disk')
const { RuntimeStore } = plugin
const reloaded = new RuntimeStore({ file: statePath })
await reloaded.ready()
check('persisted servers reload', reloaded.listServersNow().some(server => server.name === 'key test'))
check('reloaded records keep no password key', !JSON.stringify(reloaded.listServersNow()).toLowerCase().includes('"password":'))

}

try {
  await runTests()
} finally {
  await host.fiber.dispose?.()
  await new Promise(resolve => sshServer.close(resolve))
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
