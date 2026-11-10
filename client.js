window.__ModuleLoader__.load({
  id: 'dsh-remote-ssh',
  factory: (require) => {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const { useEffect, useMemo, useRef, useState } = React
    const RPC_PATH = '/api/dsh-remote-ssh'

    const CACHE = new Map()
    const LISTENERS = new Map()
    const REQUESTS = new Map()

    function publish(sessionId, state) {
      const id = String(sessionId || '')
      if (!id || !state) return
      CACHE.set(id, state)
      for (const listener of LISTENERS.get(id) || []) listener(state)
    }

    function subscribe(sessionId, listener) {
      const id = String(sessionId || '')
      if (!id) return () => {}
      let set = LISTENERS.get(id)
      if (!set) { set = new Set(); LISTENERS.set(id, set) }
      set.add(listener)
      return () => {
        set.delete(listener)
        if (!set.size) LISTENERS.delete(id)
      }
    }

    function loadState(sessionId, rpc) {
      const id = String(sessionId || '')
      if (!id) return Promise.resolve(null)
      const cached = CACHE.get(id)
      if (cached) return Promise.resolve(cached)
      const running = REQUESTS.get(id)
      if (running) return running
      const request = rpc('state', { sessionId: id })
        .then(state => { publish(id, state); return state })
        .finally(() => { if (REQUESTS.get(id) === request) REQUESTS.delete(id) })
      REQUESTS.set(id, request)
      return request
    }

    const CSS = `
.dshrs-trigger{display:inline-flex;align-items:center;gap:5px;height:26px;max-width:196px;padding:0 6px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);font:inherit;font-size:13px;line-height:1;cursor:pointer}
.dshrs-trigger:hover,.dshrs-trigger:focus-visible{background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-2,transparent));color:var(--dsw-alias-label-primary,currentColor);outline:none}
.dshrs-trigger[disabled]{opacity:.5;cursor:not-allowed}
.dshrs-trigger-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshrs-chevron{opacity:.55;font-size:9px;line-height:1}
.dshrs-menu{position:fixed;z-index:1200;width:258px;max-height:min(400px,56vh);overflow:auto;padding:5px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-stroke-primary,color-mix(in srgb,currentColor 22%,transparent)));border-radius:10px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,Canvas));box-shadow:var(--dsw-shadow-popover,0 10px 28px color-mix(in srgb,currentColor 16%,transparent));font:inherit;font-family:var(--dsw-font-family,inherit);font-size:13px;line-height:1.25;color:var(--dsw-alias-label-primary,currentColor)}
.dshrs-menu-label{padding:5px 7px 3px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary,currentColor));font-size:11px;opacity:.78}
.dshrs-sep{height:1px;margin:4px 3px;background:var(--dsw-alias-border-l1,var(--dsw-alias-stroke-primary,color-mix(in srgb,currentColor 16%,transparent)))}
.dshrs-row{width:100%;display:flex;align-items:center;gap:7px;min-height:32px;padding:5px 7px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.dshrs-row:hover,.dshrs-row:focus-visible{background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,transparent));outline:none}
.dshrs-row[disabled]{opacity:.5;cursor:not-allowed}
.dshrs-row-main{display:block;min-width:0;flex:1;line-height:1.25}
.dshrs-row-title{display:block;font-weight:500;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshrs-row-sub{display:block;margin-top:1px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary,currentColor));font-size:11px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshrs-dot{width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:var(--dsw-alias-label-caption,currentColor);opacity:.55}
.dshrs-dot[data-state="connected"]{background:var(--dsw-alias-state-success-primary,#2f9e6a);opacity:1}
.dshrs-dot[data-state="connecting"]{background:var(--dsw-alias-state-warning-primary,#c88a19);opacity:1}
.dshrs-dot[data-state="error"]{background:var(--dsw-alias-state-error-primary,#c94b4b);opacity:1}
.dshrs-check{width:14px;flex:0 0 14px;text-align:center;color:var(--dsw-alias-brand-primary,currentColor);font-size:12px}
.dshrs-backdrop{position:fixed;inset:0;z-index:1400;display:flex;align-items:center;justify-content:center;padding:16px;background:color-mix(in srgb,#000 36%,transparent)}
.dshrs-modal{width:min(560px,100%);max-height:min(78vh,700px);overflow:auto;display:grid;gap:12px;padding:16px 18px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-stroke-primary,color-mix(in srgb,currentColor 20%,transparent)));background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,Canvas));color:var(--dsw-alias-label-primary,currentColor);box-shadow:0 18px 60px color-mix(in srgb,#000 28%,transparent);font:inherit;font-family:var(--dsw-font-family,inherit);font-size:13px;line-height:1.3}
.dshrs-modal-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.dshrs-modal-title{font-size:15px;font-weight:600}
.dshrs-close{border:0;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);font:inherit;font-size:14px;line-height:1;cursor:pointer;padding:3px 5px;border-radius:6px}
.dshrs-close:hover{background:var(--dsw-alias-bg-layer-1,transparent)}
.dshrs-grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 14px}
.dshrs-field{display:grid;gap:4px;min-width:0}
.dshrs-field label{font-weight:600;font-size:12.5px}
.dshrs-field input,.dshrs-field select{width:100%;min-width:0;box-sizing:border-box;min-height:30px;padding:0 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-stroke-primary,color-mix(in srgb,currentColor 24%,transparent)));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;font-size:13px}
.dshrs-field input:focus,.dshrs-field select:focus{outline:none;border-color:var(--dsw-alias-brand-primary,currentColor)}
.dshrs-hint{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary,currentColor));font-size:11px;opacity:.72}
.dshrs-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px}
.dshrs-btn{min-height:28px;padding:0 11px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-stroke-primary,color-mix(in srgb,currentColor 22%,transparent)));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;font-size:13px;cursor:pointer}
.dshrs-btn:hover{background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-2,transparent))}
.dshrs-btn[disabled]{opacity:.5;cursor:not-allowed}
.dshrs-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#247bbf);color:#fff}
.dshrs-btn-primary:hover{filter:brightness(1.05)}
.dshrs-status{display:grid;gap:5px;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-stroke-primary,color-mix(in srgb,currentColor 18%,transparent)));background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,transparent))}
.dshrs-status-title{font-weight:600;font-size:12.5px}
.dshrs-status-text{color:var(--dsw-alias-label-secondary,currentColor);font-size:12px;white-space:pre-wrap;word-break:break-word;opacity:.9}
.dshrs-status[data-kind="error"]{border-color:var(--dsw-alias-state-error-primary,#c94b4b)}
.dshrs-fingerprint{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:12px;word-break:break-all}
.dshrs-server{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-stroke-primary,color-mix(in srgb,currentColor 12%,transparent)))}
.dshrs-server:last-child{border-bottom:0}
.dshrs-server-main{min-width:0;flex:1}
.dshrs-server-title{display:flex;align-items:center;gap:6px;font-weight:600;font-size:13px}
.dshrs-server-sub{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary,currentColor));font-size:11px;opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshrs-mini{display:flex;gap:5px}
.dshrs-mini .dshrs-btn{min-height:26px;padding:0 8px;font-size:12px}
.dshrs-empty{color:var(--dsw-alias-label-secondary,currentColor);opacity:.8;padding:8px 0;font-size:12.5px}
@media (max-width:720px){.dshrs-grid2{grid-template-columns:1fr}.dshrs-modal{padding:14px}}
`

    const DICT = {
      zh: {
        environment: '执行环境',
        local: '本地电脑',
        loading: '正在读取执行环境…',
        addServer: '添加服务器…',
        manageServers: '管理服务器…',
        serverName: '名称',
        host: '主机地址',
        port: '端口',
        username: '用户名',
        auth: '认证方式',
        authAgent: 'SSH Agent',
        authKey: '私钥文件',
        authPassword: '密码',
        keyPath: '私钥路径（留空使用默认 id_ed25519 / id_ecdsa / id_rsa）',
        password: 'SSH 密码（只保存在本机 Host 内存）',
        remoteRoot: '默认工作目录',
        remoteRootHint: '远端默认 cwd，例如 /root 或 ~/project；不是路径沙箱。',
        testAndSave: '测试并保存',
        save: '保存',
        cancel: '取消',
        close: '关闭',
        delete: '删除',
        edit: '编辑',
        reconnect: '重连',
        trust: '信任并保存',
        fingerprint: '服务器指纹',
        fingerprintHint: '首次连接需要核对指纹。确认与你服务器上 ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 的输出一致后再信任。',
        fingerprintChanged: '服务器指纹与已保存的指纹不一致。可能是服务器重装或更换了主机密钥，也可能是中间人攻击；确认无误后再信任。',
        hostRouteMissing: 'Host 插件未激活或 /dsh-remote-ssh 路由未注册，浏览器请求被静态页面接管（HTTP 404/405）。请重启 DSH Desktop 后再试。',
        testing: '正在测试 SSH 连接…',
        saved: '已保存',
        deleted: '已删除',
        switched: '执行环境已切换',
        failed: '操作失败',
        serverList: '已保存的服务器',
        noServers: '还没有服务器。添加一台服务器后即可在对话中切换执行环境。',
        runningLocked: '会话正在运行，本轮不能切换执行环境。',
        rpcLost: 'DSH Host 连接在请求期间中断。请查看启动 DSH 的终端日志。',
        namePlaceholder: '例如 开发机',
        hostPlaceholder: '10.0.0.8 或 example.com',
        userPlaceholder: 'root',
        rootPlaceholder: '~',
        required: '请填写名称、主机地址和用户名。',
        server: '服务器',
        localPlatform: '本机',
      },
      en: {
        environment: 'Execution environment',
        local: 'This computer',
        loading: 'Reading the execution environment…',
        addServer: 'Add server…',
        manageServers: 'Manage servers…',
        serverName: 'Name',
        host: 'Host',
        port: 'Port',
        username: 'Username',
        auth: 'Authentication',
        authAgent: 'SSH agent',
        authKey: 'Private key file',
        authPassword: 'Password',
        keyPath: 'Key path (blank uses the default id_ed25519 / id_ecdsa / id_rsa)',
        password: 'SSH password (kept in this Host process only)',
        remoteRoot: 'Default working directory',
        remoteRootHint: 'Remote default cwd, for example /root or ~/project. This is not a path sandbox.',
        testAndSave: 'Test and save',
        save: 'Save',
        cancel: 'Cancel',
        close: 'Close',
        delete: 'Delete',
        edit: 'Edit',
        reconnect: 'Reconnect',
        trust: 'Trust and save',
        fingerprint: 'Server fingerprint',
        fingerprintHint: 'Verify this fingerprint against ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub on the server before trusting it.',
        fingerprintChanged: 'The server fingerprint differs from the saved one. The host may have been reinstalled or its host key replaced — or this could be a man-in-the-middle attack. Trust it only after verifying.',
        hostRouteMissing: 'The Host plugin is not active or its /dsh-remote-ssh route is missing, so the static page answered the request (HTTP 404/405). Restart DSH Desktop and try again.',
        testing: 'Testing the SSH connection…',
        saved: 'Saved',
        deleted: 'Deleted',
        switched: 'Execution environment switched',
        failed: 'Operation failed',
        serverList: 'Saved servers',
        noServers: 'No servers yet. Add one to switch the execution environment inside a conversation.',
        runningLocked: 'The conversation is running, so this turn cannot switch environments.',
        rpcLost: 'The DSH Host connection dropped during the request. Check the terminal running DSH.',
        namePlaceholder: 'e.g. Dev box',
        hostPlaceholder: '10.0.0.8 or example.com',
        userPlaceholder: 'root',
        rootPlaceholder: '~',
        required: 'Name, host, and username are required.',
        server: 'Server',
        localPlatform: 'local',
      },
    }

    function createTranslator(ctx) {
      try {
        ctx.locale.register('dshRemoteSsh', DICT)
        return ctx.locale.bind('dshRemoteSsh')
      } catch {
        return key => DICT.zh[key] ?? key
      }
    }

    function ServerIcon(props) {
      const size = props?.size || 16
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, style: { flex: '0 0 auto', opacity: 0.9 },
      },
        h('rect', { x: 3, y: 4, width: 18, height: 7, rx: 2 }),
        h('rect', { x: 3, y: 13, width: 18, height: 7, rx: 2 }),
        h('path', { d: 'M7 7.5h.01M7 16.5h.01' }),
      )
    }

    function Dot(props) {
      return h('span', { className: 'dshrs-dot', 'data-state': props.state || 'disconnected' })
    }

    function connectionOf(state, serverId) {
      return state?.connections?.[serverId] || { state: 'disconnected' }
    }

    function Modal(props) {
      useEffect(() => {
        const onKey = event => { if (event.key === 'Escape') props.onClose?.() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [props.onClose])
      return ReactDOM.createPortal(
        h('div', {
          className: 'dshrs-backdrop',
          onMouseDown: event => { if (event.target === event.currentTarget) props.onClose?.() },
        }, h('div', { role: 'dialog', 'aria-modal': 'true', className: 'dshrs-modal' },
          h('div', { className: 'dshrs-modal-head' },
            h('div', { className: 'dshrs-modal-title' }, props.title),
            h('button', { type: 'button', className: 'dshrs-close', onClick: props.onClose, title: props.closeLabel }, '✕'),
          ),
          props.children,
        )),
        document.body,
      )
    }

    function StatusBox(props) {
      const status = props.status
      if (!status || status.kind === 'idle') return null
      return h('div', { className: 'dshrs-status', 'data-kind': status.kind },
        status.title ? h('div', { className: 'dshrs-status-title' }, status.title) : null,
        status.message ? h('div', { className: 'dshrs-status-text' }, status.message) : null,
        status.fingerprint
          ? h('div', { className: 'dshrs-fingerprint' }, status.fingerprint)
          : null,
        status.fingerprint && !status.message
          ? h('div', { className: 'dshrs-status-text' }, props.fingerprintHint)
          : null,
        status.kind === 'trust'
          ? h('div', { className: 'dshrs-actions' },
            h('button', { type: 'button', className: 'dshrs-btn', onClick: props.onCancel }, props.cancelLabel),
            h('button', { type: 'button', className: 'dshrs-btn dshrs-btn-primary', onClick: props.onTrust, disabled: props.busy }, props.trustLabel),
          )
          : null,
      )
    }

    function ServerEditor(props) {
      const { server, rpc, sessionId, onSaved, onCancel, t } = props
      const [form, setForm] = useState(() => ({
        name: server?.name || '',
        host: server?.host || '',
        port: String(server?.port || 22),
        username: server?.username || '',
        authType: server?.auth?.type || 'agent',
        keyPath: server?.auth?.keyPath || '',
        remoteRoot: server?.remoteRoot || '~',
      }))
      const [password, setPassword] = useState('')
      const [busy, setBusy] = useState(false)
      const [status, setStatus] = useState({ kind: 'idle' })
      const [trustedFingerprint, setTrustedFingerprint] = useState('')

      const update = (key, value) => setForm(current => ({ ...current, [key]: value }))

      const submit = async (allowFingerprint) => {
        if (busy) return
        if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
          setStatus({ kind: 'error', title: t('failed'), message: t('required') })
          return
        }
        setBusy(true)
        setStatus({ kind: 'busy', title: t('testing') })
        try {
          const payload = {
            sessionId,
            server: {
              ...(server?.id ? { id: server.id } : {}),
              name: form.name.trim(),
              host: form.host.trim(),
              port: Number(form.port) || 22,
              username: form.username.trim(),
              auth: form.authType === 'key'
                ? { type: 'key', ...(form.keyPath.trim() ? { keyPath: form.keyPath.trim() } : {}) }
                : { type: form.authType },
              remoteRoot: form.remoteRoot.trim() || '~',
            },
            ...(form.authType === 'password' && password ? { password } : {}),
            ...(allowFingerprint ? { allowFingerprint } : {}),
          }
          const result = await rpc('server.testAndSave', payload)
          setStatus({ kind: 'ok', title: t('saved'), message: `${result.os || 'Linux'} · ${result.auth || ''}` })
          setPassword('')
          onSaved(result.server)
        } catch (error) {
          if ((error?.code === 'HOST_KEY_UNTRUSTED' || error?.code === 'HOST_KEY_CHANGED') && error?.details?.fingerprint) {
            setTrustedFingerprint(String(error.details.fingerprint))
            setStatus({
              kind: 'trust',
              title: t('fingerprint'),
              message: error.code === 'HOST_KEY_CHANGED' ? t('fingerprintChanged') : '',
              fingerprint: String(error.details.fingerprint),
            })
          } else {
            setStatus({ kind: 'error', title: t('failed'), message: String(error?.message || error) })
          }
        } finally {
          setBusy(false)
        }
      }

      return h(React.Fragment, null,
        h('div', { className: 'dshrs-grid2' },
          h('div', { className: 'dshrs-field' },
            h('label', null, t('serverName')),
            h('input', { value: form.name, placeholder: t('namePlaceholder'), onChange: event => update('name', event.target.value) }),
          ),
          h('div', { className: 'dshrs-field' },
            h('label', null, t('auth')),
            h('select', { value: form.authType, onChange: event => update('authType', event.target.value) },
              h('option', { value: 'agent' }, t('authAgent')),
              h('option', { value: 'key' }, t('authKey')),
              h('option', { value: 'password' }, t('authPassword')),
            ),
          ),
          h('div', { className: 'dshrs-field' },
            h('label', null, t('host')),
            h('input', { value: form.host, placeholder: t('hostPlaceholder'), onChange: event => update('host', event.target.value) }),
          ),
          h('div', { className: 'dshrs-field' },
            h('label', null, t('port')),
            h('input', { value: form.port, inputMode: 'numeric', onChange: event => update('port', event.target.value) }),
          ),
          h('div', { className: 'dshrs-field' },
            h('label', null, t('username')),
            h('input', { value: form.username, placeholder: t('userPlaceholder'), onChange: event => update('username', event.target.value) }),
          ),
          h('div', { className: 'dshrs-field' },
            h('label', null, t('remoteRoot')),
            h('input', { value: form.remoteRoot, placeholder: t('rootPlaceholder'), onChange: event => update('remoteRoot', event.target.value) }),
            h('div', { className: 'dshrs-hint' }, t('remoteRootHint')),
          ),
        ),
        form.authType === 'key'
          ? h('div', { className: 'dshrs-field' },
            h('label', null, t('keyPath')),
            h('input', { value: form.keyPath, placeholder: '~/.ssh/id_ed25519', onChange: event => update('keyPath', event.target.value) }),
          )
          : null,
        form.authType === 'password'
          ? h('div', { className: 'dshrs-field' },
            h('label', null, t('password')),
            h('input', { type: 'password', value: password, onChange: event => setPassword(event.target.value) }),
          )
          : null,
        h(StatusBox, {
          status: status.kind === 'trust'
            ? { ...status, title: t('fingerprint'), message: t('fingerprintHint') }
            : status,
          fingerprintHint: t('fingerprintHint'),
          trustLabel: t('trust'),
          cancelLabel: t('cancel'),
          busy,
          onCancel,
          onTrust: () => submit(trustedFingerprint || status.fingerprint),
        }),
        status.kind === 'trust'
          ? null
          : h('div', { className: 'dshrs-actions' },
            h('button', { type: 'button', className: 'dshrs-btn', onClick: onCancel, disabled: busy }, t('cancel')),
            h('button', { type: 'button', className: 'dshrs-btn dshrs-btn-primary', onClick: () => submit(), disabled: busy }, busy ? t('testing') : t('testAndSave')),
          ),
      )
    }

    function ServerManager(props) {
      const { state, rpc, sessionId, t, onEdit, onAdd, reload } = props
      const [status, setStatus] = useState({ kind: 'idle' })
      const servers = state?.servers || []

      const remove = async server => {
        setStatus({ kind: 'busy', title: t('testing') })
        try {
          await rpc('server.remove', { sessionId, serverId: server.id })
          setStatus({ kind: 'idle' })
          reload()
        } catch (error) {
          setStatus({ kind: 'error', title: t('failed'), message: String(error?.message || error) })
        }
      }

      const reconnect = async server => {
        setStatus({ kind: 'busy', title: t('reconnect') })
        try {
          await rpc('server.reconnect', { sessionId, serverId: server.id })
          setStatus({ kind: 'idle' })
          reload()
        } catch (error) {
          setStatus({ kind: 'error', title: t('failed'), message: String(error?.message || error) })
        }
      }

      return h(React.Fragment, null,
        h('div', null, t('serverList')),
        servers.length
          ? h('div', null, servers.map(server => h('div', { className: 'dshrs-server', key: server.id },
            h('div', { className: 'dshrs-server-main' },
              h('div', { className: 'dshrs-server-title' },
                h(Dot, { state: connectionOf(state, server.id).state }),
                h('span', null, server.name),
              ),
              h('div', { className: 'dshrs-server-sub' }, `${server.username}@${server.host}:${server.port} · ${server.remoteRoot}`),
            ),
            h('div', { className: 'dshrs-mini' },
              h('button', { type: 'button', className: 'dshrs-btn', onClick: () => reconnect(server) }, t('reconnect')),
              h('button', { type: 'button', className: 'dshrs-btn', onClick: () => onEdit(server) }, t('edit')),
              h('button', { type: 'button', className: 'dshrs-btn', onClick: () => remove(server) }, t('delete')),
            ),
          )))
          : h('div', { className: 'dshrs-empty' }, t('noServers')),
        h(StatusBox, { status, fingerprintHint: t('fingerprintHint'), trustLabel: t('trust'), cancelLabel: t('cancel') }),
        h('div', { className: 'dshrs-actions' },
          h('button', { type: 'button', className: 'dshrs-btn', onClick: onAdd }, t('addServer')),
        ),
      )
    }

    function TargetPicker(props) {
      const { sessionId, t, rpc } = props
      const [state, setState] = useState(() => CACHE.get(String(sessionId)) || null)
      const [menu, setMenu] = useState(null)
      const [modal, setModal] = useState(null)
      const [editing, setEditing] = useState(null)
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState(false)
      const triggerRef = useRef(null)

      const reload = () => {
        const id = String(sessionId || '')
        CACHE.delete(id)
        return loadState(id, rpc)
          .then(next => { if (next) setState(next) })
          .catch(() => {
            setState(current => current || { servers: [], target: { type: 'local' }, connections: {}, execution: { type: 'local' } })
          })
      }

      useEffect(() => {
        const id = String(sessionId || '')
        if (!id) { setState(null); return undefined }
        let active = true
        const cached = CACHE.get(id)
        if (cached) setState(cached)
        const dispose = subscribe(id, next => { if (active) setState(next) })
        if (!cached) {
          loadState(id, rpc).catch(() => {
            if (active) setState({ servers: [], target: { type: 'local' }, connections: {}, execution: { type: 'local' } })
          })
        }
        return () => { active = false; dispose() }
      }, [sessionId, rpc])

      const openMenu = () => {
        const rect = triggerRef.current?.getBoundingClientRect()
        if (!rect) return
        setMenu({
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 274)),
          bottom: Math.max(8, window.innerHeight - rect.top + 8),
        })
        void reload()
      }

      useEffect(() => {
        if (!menu) return undefined
        const close = event => {
          if (triggerRef.current?.contains(event.target)) return
          if (event.target?.closest?.('.dshrs-menu, .dshrs-backdrop')) return
          setMenu(null)
        }
        const onKey = event => { if (event.key === 'Escape') setMenu(null) }
        document.addEventListener('mousedown', close, true)
        document.addEventListener('keydown', onKey)
        window.addEventListener('resize', () => setMenu(null), { once: true })
        return () => {
          document.removeEventListener('mousedown', close, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [menu])

      const target = state?.target || { type: 'local' }
      const servers = state?.servers || []
      const activeServer = target.type === 'ssh' ? servers.find(server => server.id === target.serverId) : undefined
      const label = target.type === 'ssh' ? String(activeServer?.name || t('server')) : t('local')

      const chooseTarget = async next => {
        if (busy) return
        setBusy(true)
        setNotice('')
        try {
          const nextState = await rpc('target.set', { sessionId, target: next })
          publish(String(sessionId), nextState)
          setState(nextState)
          setMenu(null)
          setNotice(t('switched'))
        } catch (error) {
          setNotice(String(error?.message || error))
        } finally {
          setBusy(false)
        }
      }

      return h(React.Fragment, null,
        h('button', {
          ref: triggerRef,
          type: 'button',
          className: 'dshrs-trigger',
          title: `${t('environment')}: ${label}${notice ? ` — ${notice}` : ''}`,
          disabled: state === null,
          onClick: () => (menu ? setMenu(null) : openMenu()),
        },
          h(ServerIcon, { size: 14 }),
          h('span', { className: 'dshrs-trigger-name' }, state === null ? t('loading') : label),
          h('span', { className: 'dshrs-chevron' }, '▾'),
        ),
        menu ? ReactDOM.createPortal(
          h('div', { className: 'dshrs-menu', style: { left: menu.left, bottom: menu.bottom }, role: 'menu' },
            h('div', { className: 'dshrs-menu-label' }, t('environment')),
            h('button', {
              type: 'button', role: 'menuitemradio', className: 'dshrs-row',
              'aria-checked': target.type === 'local', disabled: busy || Boolean(state?.busy),
              onClick: () => chooseTarget({ type: 'local' }),
            },
              h('span', { className: 'dshrs-check' }, target.type === 'local' ? '✓' : ''),
              h(ServerIcon, { size: 14 }),
              h('span', { className: 'dshrs-row-main' },
                h('span', { className: 'dshrs-row-title' }, t('local')),
                h('span', { className: 'dshrs-row-sub' }, `${state?.execution?.platform || state?.hostPlatform || ''}`),
              ),
            ),
            servers.length ? h('div', { className: 'dshrs-sep' }) : null,
            servers.map(server => h('button', {
              key: server.id,
              type: 'button', role: 'menuitemradio', className: 'dshrs-row',
              'aria-checked': target.type === 'ssh' && target.serverId === server.id,
              disabled: busy || Boolean(state?.busy),
              onClick: () => chooseTarget({ type: 'ssh', serverId: server.id }),
            },
              h('span', { className: 'dshrs-check' }, target.type === 'ssh' && target.serverId === server.id ? '✓' : ''),
              h(Dot, { state: connectionOf(state, server.id).state }),
              h('span', { className: 'dshrs-row-main' },
                h('span', { className: 'dshrs-row-title' }, server.name),
                h('span', { className: 'dshrs-row-sub', title: `${server.username}@${server.host}:${server.port} · ${server.remoteRoot}` }, `${server.username}@${server.host}:${server.port} · ${server.remoteRoot}`),
              ),
            )),
            h('div', { className: 'dshrs-sep' }),
            h('button', {
              type: 'button', role: 'menuitem', className: 'dshrs-row',
              onClick: () => { setEditing(null); setModal('edit'); setMenu(null) },
            }, h('span', { className: 'dshrs-check' }, '+'), h('span', { className: 'dshrs-row-main' }, h('span', { className: 'dshrs-row-title' }, t('addServer')))),
            h('button', {
              type: 'button', role: 'menuitem', className: 'dshrs-row',
              onClick: () => { setModal('manage'); setMenu(null) },
            }, h('span', { className: 'dshrs-check' }, '⚙'), h('span', { className: 'dshrs-row-main' }, h('span', { className: 'dshrs-row-title' }, t('manageServers')))),
            state?.busy ? h('div', { className: 'dshrs-menu-label' }, t('runningLocked')) : null,
          ),
          document.body,
        ) : null,
        modal === 'edit'
          ? h(Modal, {
            title: editing ? `${t('edit')} · ${editing.name}` : t('addServer'),
            closeLabel: t('close'),
            onClose: () => { setModal(null); setEditing(null) },
          }, h(ServerEditor, {
            server: editing,
            sessionId,
            rpc,
            t,
            onCancel: () => { setModal(null); setEditing(null) },
            onSaved: async server => {
              setModal(null)
              setEditing(null)
              try {
                const nextState = await rpc('target.set', { sessionId, target: { type: 'ssh', serverId: server.id } })
                publish(String(sessionId), nextState)
                setState(nextState)
                setNotice(t('switched'))
              } catch (error) {
                setNotice(String(error?.message || error))
              }
              void reload()
            },
          }))
          : null,
        modal === 'manage'
          ? h(Modal, {
            title: t('manageServers'),
            closeLabel: t('close'),
            onClose: () => { setModal(null); setEditing(null) },
          }, h(ServerManager, {
            state,
            sessionId,
            rpc,
            t,
            reload,
            onAdd: () => { setEditing(null); setModal('edit') },
            onEdit: server => { setEditing(server); setModal('edit') },
          }))
          : null,
      )
    }

    const name = 'dsh-remote-ssh-client'
    const inject = ['slots', 'locale']

    function apply(ctx) {
      const t = createTranslator(ctx)
      const rpc = async (method, payload, signal) => {
        let response
        try {
          response = await fetch(RPC_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ endpoint: method, payload }),
            credentials: 'same-origin',
            ...(signal === undefined ? {} : { signal }),
          })
        } catch (error) {
          if (signal?.aborted) throw error
          throw {
            code: 'RPC_TRANSPORT_FAILED',
            message: t('rpcLost'),
            details: { method: String(method), raw: String(error?.message || error) },
          }
        }
        if (!response.ok) {
          const missing = response.status === 404 || response.status === 405
          throw {
            code: missing ? 'HOST_ROUTE_MISSING' : 'RPC_HTTP_ERROR',
            message: missing ? t('hostRouteMissing') : `${t('failed')} (HTTP ${response.status})`,
            details: { method: String(method), status: response.status },
          }
        }
        let envelope
        try {
          envelope = await response.json()
        } catch (error) {
          throw { code: 'RPC_BAD_RESPONSE', message: t('failed'), details: { method: String(method), raw: String(error?.message || error) } }
        }
        if (envelope?.ok === false) throw envelope.error
        return envelope?.value
      }

      const removeStyles = (() => {
        const element = document.createElement('style')
        element.id = 'dsh-remote-ssh-style'
        element.textContent = CSS
        document.head.appendChild(element)
        return () => element.remove()
      })()
      if (typeof ctx.effect === 'function') ctx.effect(() => removeStyles, 'DSH Remote SSH client styles')

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'dsh-remote-ssh:target',
        order: 25,
        inject: () => ({ t, rpc }),
      }, TargetPicker))
    }

    return { name, inject, apply }
  },
})
