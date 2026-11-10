// Offline harness: exercise the SFTP-backed filesystem contract against an
// in-memory SFTP double (no network).
import { Readable, Writable } from 'node:stream'
import { posix } from 'node:path'
import { Context } from '../../ref/dsh-0.2.2/@deepseek-ai/cordis/lib/index.js'

const files = new Map()
const dirs = new Set(['/'])
files.set('/root/a.txt', Buffer.from('one\ntwo\nthree\n'))
dirs.add('/root')

function attrsFor(path) {
  if (dirs.has(path)) return { mode: 0o040755, size: 0, mtime: 1, uid: 0, gid: 0 }
  const bytes = files.get(path)
  if (!bytes) return undefined
  return { mode: 0o100644, size: bytes.length, mtime: 2, uid: 0, gid: 0 }
}

const sftp = {
  stat(path, callback) {
    const attrs = attrsFor(path)
    if (!attrs) return callback(Object.assign(new Error('no such file'), { code: 2 }))
    callback(undefined, attrs)
  },
  lstat(path, callback) { this.stat(path, callback) },
  realpath(path, callback) { callback(undefined, posix.resolve('/root', path)) },
  readdir(path, callback) {
    if (!dirs.has(path)) return callback(Object.assign(new Error('no such dir'), { code: 2 }))
    const prefix = path === '/' ? '/' : `${path}/`
    const entries = []
    for (const key of [...files.keys(), ...dirs]) {
      if (key === path || !key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      if (rest.includes('/')) continue
      entries.push({ filename: rest, attrs: attrsFor(key) })
    }
    callback(undefined, entries)
  },
  unlink(path, callback) {
    if (!files.delete(path)) return callback(Object.assign(new Error('no such file'), { code: 2 }))
    callback()
  },
  rename(from, to, callback) {
    const bytes = files.get(from)
    if (!bytes) return callback(Object.assign(new Error('no such file'), { code: 2 }))
    files.delete(from)
    files.set(to, bytes)
    callback()
  },
  mkdir(path, options, callback) {
    dirs.add(path)
    callback()
  },
  createReadStream(path, options = {}) {
    const bytes = files.get(path)
    if (!bytes) {
      const stream = new Readable({ read() {} })
      process.nextTick(() => stream.destroy(Object.assign(new Error('no such file'), { code: 2 })))
      return stream
    }
    const start = Number(options.start ?? 0)
    const end = options.end === undefined ? bytes.length - 1 : Math.min(Number(options.end), bytes.length - 1)
    return Readable.from([bytes.subarray(start, end + 1)])
  },
  createWriteStream(path, options = {}) {
    const chunks = []
    const self = this
    return new Writable({
      write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() },
      final(callback) {
        files.set(path, Buffer.concat(chunks))
        dirs.add(posix.dirname(path))
        callback()
      },
    })
  },
}

const ctx = new Context()
const plugin = await import('../dist/index.js')
const server = { id: 'srv_fs', host: '127.0.0.1', port: 22, username: 'root', remoteRoot: '~', auth: { type: 'agent' } }
const connections = { async sftp() { return sftp }, async exec() { return { stdout: '', stderr: '', exitCode: 0 } } }
const fiber = ctx.plugin(plugin.SshFileSystem, {
  connections,
  server,
  resolvedEnvironment: { home: '/root', cwd: '/root' },
})
await fiber.await()

const fs = ctx.fs
const target = await fs.resolve('a.txt')
console.log('resolve:', target.displayPath, '| contains:', fs.contains(await fs.resolve('/root'), target))
console.log('readText:', JSON.stringify(await fs.readText(target)))
console.log('readByteRange:', (await fs.readByteRange(target, { offset: 4, length: 3 })).toString())
console.log('stat:', JSON.stringify(await fs.stat(target)))
const listed = await fs.listDir(await fs.resolve('/root'))
console.log('listDir:', listed.map(entry => entry.name).join(','))

const version = (await fs.stat(target)).version
const written = await fs.writeText(target, 'ONE\ntwo\nthree\n', { kind: 'replaceIfVersion', version })
console.log('writeText:', written.operation, JSON.stringify(written.after))
const current = await fs.resolve('a.txt')
const edited = await fs.editText(current, { oldString: 'two', newString: '2', replaceAll: false }, { version: (await fs.stat(current)).version })
console.log('editText:', JSON.stringify(edited.after))

const patchTarget = await fs.resolve('a.txt')
const patched = await fs.patchText(patchTarget, [{
  lineNumber: 1,
  oldLines: ['three'],
  newLines: ['3'],
  isEndOfFile: false,
}], { version: (await fs.stat(patchTarget)).version })
console.log('patchText:', JSON.stringify(patched.after))

const dest = await fs.resolve('/root/moved.txt')
const moved = await fs.moveFile(await fs.resolve('a.txt'), dest, {})
console.log('moveFile:', moved.sourceDeleted, '| a.txt exists:', Boolean(files.get('/root/a.txt')), '| moved exists:', Boolean(files.get('/root/moved.txt')))

const removed = await fs.deleteFile(await fs.resolve('/root/moved.txt'), {})
console.log('deleteFile before:', JSON.stringify(removed.before), '| exists:', Boolean(files.get('/root/moved.txt')))

await fiber.dispose?.()
console.log('fs harness ok')
