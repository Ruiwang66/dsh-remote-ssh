// Offline harness: exercise the SSH subprocess provider against a fake ssh2
// client (no network).
import { Duplex } from 'node:stream'
import { Context } from '../../ref/dsh-0.2.2/@deepseek-ai/cordis/lib/index.js'
import { SshFileSystem } from '../dist/index.js'

const ctx = new Context()
const server = { id: 'srv_sp', host: '127.0.0.1', port: 22, username: 'root', remoteRoot: '~', auth: { type: 'agent' } }

function fakeStream({ stdout = '', stderr = '', exitCode = 0 }) {
  const stream = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
  stream.stderr = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
  process.nextTick(() => {
    if (stdout) stream.push(stdout)
    if (stderr) stream.stderr.push(stderr)
    stream.emit('exit', exitCode, undefined)
    stream.push(null)
    stream.stderr.push(null)
    process.nextTick(() => stream.emit('close'))
  })
  return stream
}

const commands = []
const client = {
  exec(command, options, callback) {
    if (typeof options === 'function') { callback = options; options = undefined }
    commands.push(command)
    callback(undefined, fakeStream({ stdout: 'hello\n', stderr: "__YWM_PID:4242\nwarn\n", exitCode: 0 }))
  },
}
const connections = {
  async ensure() { return { client } },
  async sftp() { throw new Error('sftp not used') },
  async exec(_server, command) {
    commands.push(command)
    if (command.includes('command -v')) return { stdout: '/usr/bin/node\n', stderr: '', exitCode: 0 }
    return { stdout: 'Linux\nx86_64\n', stderr: '', exitCode: 0 }
  },
}

await ctx.plugin(SshFileSystem, { connections, server, resolvedEnvironment: { home: '/root', cwd: '/root' } }).await()
const sub = await import('../dist/index.js')
const fiber = ctx.plugin(sub.SshSubprocessRuntime, { connections, server })
await fiber.await()

const executable = await ctx.subprocess.resolveExecutable('node')
console.log('resolveExecutable:', executable)

const handle = ctx.subprocess.spawn({
  argv: ['node', '-e', 'console.log(1)'],
  cwd: '/root',
  stdio: {
    stdin: 'ignore',
    stdout: { maxBytes: 4096 },
    stderr: { maxBytes: 4096 },
  },
  graceMs: 1000,
})
const outcome = await handle.done
console.log('done:', JSON.stringify(outcome))
console.log('stdout:', JSON.stringify(handle.collected.stdout?.readFrom(0).text))
console.log('stderr:', JSON.stringify(handle.collected.stderr?.readFrom(0).text))

const terminal = await ctx.subprocess.spawnTerminal({ argv: ['bash', '-l'], cwd: '/root', rows: 24, cols: 80, term: 'xterm-256color', stdio: {} })
console.log('terminal pid:', terminal.pid)
await terminal.terminate()
console.log('terminal terminated')
console.log('spawn commands seen:', commands.filter(c => c.includes('__YWM_PID')).length > 0)

await fiber.dispose?.()
console.log('subprocess harness ok')
