import { Service } from '@deepseek-ai/cordis'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolFsSearch from '@deepseek-ai/dsh-tool-fs-search'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import { TerminalSessionService } from '@deepseek-ai/dsh-terminal'
import * as TerminalBash from '@deepseek-ai/dsh-terminal-bash'
import * as ToolTerminal from '@deepseek-ai/dsh-tool-terminal'
import { SshFileSystem } from './remote-fs.js'
import { SshSubprocessRuntime } from './remote-subprocess.js'

/**
 * A remote execution world has no Host-side sandbox: the SSH account and the
 * remote operating system are the real authority boundary. Report that fact
 * honestly to the official tool layers instead of pretending the Host
 * workspace confines remote paths.
 */
export class RemoteSandboxPolicy extends Service {
  constructor(ctx, config) {
    super(ctx, 'sandboxPolicy')
    this.workspaceRoot = String(config?.cwd || '/')
  }

  get defaultMode() { return 'danger-full-access' }

  get additionalWritableRoots() { return undefined }

  resolve(request = {}) {
    return {
      mode: request.mode || 'danger-full-access',
      workspaceRoot: this.workspaceRoot,
      ...(request.session?.id ? { sessionId: request.session.id } : {}),
    }
  }

  overrideOf() { return undefined }
}

/**
 * The official tools read their default directory from `ctx.workingDirectory`.
 * In this execution world that directory is a remote POSIX path; the immutable
 * Session header keeps its Host workspace for the sidebar and history.
 */
export class RemoteWorkingDirectory extends Service {
  constructor(ctx, config) {
    super(ctx, 'workingDirectory')
    this.runtimeState = { cwd: String(config?.cwd || '/'), bySession: new Map() }
  }

  get defaultDirectory() { return this.runtimeState.cwd }

  get(session) {
    const id = String(session?.id || '')
    return this.runtimeState.bySession.get(id) || this.runtimeState.cwd
  }

  async ensure() { return this.runtimeState.cwd }

  async set(agent, path) {
    const requested = String(path || '').trim()
    const next = requested.startsWith('/') ? requested : `${this.runtimeState.cwd.replace(/\/+$/u, '')}/${requested}`
    const id = String(agent?.id || '')
    if (id) this.runtimeState.bySession.set(id, next)
    return next
  }
}

/**
 * `DSH_*` shell facts describe Host deployment coordinates (home, profile,
 * mounts). They are meaningless — and misleading — inside a remote account, so
 * this execution world contributes none of them.
 */
export class RemoteShellEnv extends Service {
  constructor(ctx) {
    super(ctx, 'shellEnv')
  }

  register() { return () => {} }

  collect() { return {} }

  list() { return [] }
}

async function mount(ctx, plugin, config) {
  const fiber = config === undefined ? ctx.plugin(plugin) : ctx.plugin(plugin, config)
  if (typeof fiber?.await === 'function') await fiber.await()
  return fiber
}

/**
 * One Agent-scoped, isolated DSH execution world backed by SSH.
 *
 * Every model-facing tool stays the official DSH package; only the provider
 * seams (filesystem, subprocess, shell, terminals, sandbox policy, working
 * directory, shell environment) are replaced inside this Agent's scope.
 */
export const RemoteExecutionRealm = {
  name: 'dsh-remote-ssh-execution-realm',
  inject: ['tools'],
  async apply(ctx, config) {
    const { server, connections } = config
    const environment = config.resolvedEnvironment || {
      home: String(server.remoteRoot || '/'),
      cwd: String(server.remoteRoot || '/'),
    }
    const defaultCwd = String(environment.cwd || '/')

    // Fresh isolation symbols per Agent: two conversations may select the same
    // server without colliding on one Service registration.
    const realm = ctx
      .isolate('fs')
      .isolate('subprocess')
      .isolate('shell')
      .isolate('terminals')
      .isolate('sandboxPolicy')
      .isolate('workingDirectory')
      .isolate('shellEnv')

    // A Windows Host inherits the PowerShell tool. That tool runs on the Host,
    // so it must not stay visible in a remote Linux execution world.
    if (process.platform === 'win32') {
      try {
        const disposeRestriction = realm.tools.restrict({ deny: ['pwsh'] })
        if (typeof disposeRestriction === 'function' && realm.effect) {
          realm.effect(() => disposeRestriction, 'DSH Remote SSH hide Host pwsh in remote execution world')
        }
      } catch (error) {
        realm.logger?.debug?.(`DSH Remote SSH execution realm: inherited pwsh not present: ${String(error)}`)
      }
    }

    await mount(realm, SshFileSystem, {
      connections,
      server,
      resolvedEnvironment: environment,
      diffBasisMaxBytes: config.diffBasisMaxBytes,
    })
    await mount(realm, SshSubprocessRuntime, { connections, server })
    await mount(realm, RemoteWorkingDirectory, { cwd: defaultCwd })
    await mount(realm, RemoteShellEnv)
    await mount(realm, RemoteSandboxPolicy, { cwd: defaultCwd })

    await mount(realm, ToolFs, { applyPatch: true })
    await mount(realm, ToolFsSearch, { sampleOverCapGlobResults: true })
    await mount(realm, LocalBashExecutor, {
      cwd: defaultCwd,
      timeoutMs: config.defaultTimeoutMs || 120_000,
      maxTimeoutMs: config.maxTimeoutMs || 600_000,
      maxOutputBytes: config.maxOutputBytes || 64_000,
      maxSpillBytes: config.maxSpillBytes || 8 * 1024 * 1024,
      graceMs: config.graceMs || 3_000,
    })
    await mount(realm, ToolBash)

    await mount(realm, TerminalSessionService)
    await mount(realm, TerminalBash, {
      backendType: 'shell',
      shellDialect: 'bash',
      shellPath: '/bin/bash',
      shellArgs: ['--noprofile', '--norc', '-i'],
    })
    await mount(realm, ToolTerminal)
  },
}

export async function mountRemoteExecutionRealm(agent, config) {
  const fiber = agent.ctx.plugin(RemoteExecutionRealm, config)
  if (typeof fiber?.await === 'function') await fiber.await()
  return {
    serverId: String(config.server.id),
    remoteRoot: String(config.resolvedEnvironment?.cwd || config.server.remoteRoot || '/'),
    remoteHome: String(config.resolvedEnvironment?.home || config.resolvedEnvironment?.cwd || config.server.remoteRoot || '/'),
    server: config.server,
    environment: config.resolvedEnvironment,
    fiber,
    async dispose() {
      if (typeof fiber?.dispose === 'function') await fiber.dispose()
    },
  }
}

export const __test = { RemoteSandboxPolicy, RemoteWorkingDirectory, RemoteShellEnv }
