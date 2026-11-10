# dsh-remote-ssh 交接说明（写给接手开发的 AI）

> 目标读者：另一个 AI / 开发者。读完这份文档应能独立定位代码、修改功能、跑通测试，并避免踩已知的 DSH 0.2.2 组合坑。
> 项目根目录：`E:\开发\dsh插件\dsh-remote-ssh`，包名 `dsh-remote-ssh`，当前版本 **2.0.3**。

---

## 0. 一句话与快速事实

**一句话**：这是一个 DSH（DeepSeek Harness）插件，让对话输入框左侧选择的远程 Linux 服务器接管 DSH *原有* 的 `read / write / edit / apply_patch / glob / grep / bash / terminal` 工具；不新增 `ssh_*` 工具，也不修改 DSH 源码。

| 事实 | 值 |
| --- | --- |
| DSH 版本 | `0.2.2-rc.1`（Desktop 内置） |
| 运行时 | Node.js 24（Host 进程） |
| Host 入口 | `dist/index.js`（esbuild 自包含产物，`main` 指向它） |
| Client 入口 | `client.js`（浏览器 `__ModuleLoader__.load` 工厂，源码即产物） |
| Host 依赖 | **无运行时 npm 依赖**；ssh2 与所需 `@deepseek-ai/*` 全部打进 dist |
| 内置资产 | `assets/rg-linux-{x64,arm64,arm}`（远端 ripgrep） |
| 持久化 | `$DSH_HOME/remote-ssh/state.json`（默认 `~/.dsh/remote-ssh/state.json`，0600） |
| 测试 | `npm test`：48 项端到端检查，全通过 |
| 安装形态 | 已以 `link:` 方式装进 `C:\Users\a\.dsh\profiles\desktop`，profile 的 `dsh.profile.bundles` 含 `dsh-remote-ssh` |

---

## 1. 设计不变量（改动前先守住）

1. **不改 DSH 源码**，不新增受限的 `ssh_*` 替代工具。
2. **模型可见的工具目录不变**：仍然是官方工具；变化的只是工具背后的 `ctx.fs / ctx.subprocess / ctx.shell / ctx.terminals` 等服务实例。
3. **每个 Agent 一个隔离执行世界**：两个会话可以同时连同一台服务器，但不能共用 Provider 实例（否则 Cordis 服务重复注册）。
4. **DSH Session/Workspace 元数据不变**：左侧工作区、历史分组、`SessionHeader.cwd` 都不改；只有模型上下文与工具执行位置变化。
5. **密码不写入 state.json**：默认保存为 DSH 凭据库中的插件记录（可在界面取消），否则只留在 Host 内存；私钥只存路径；日志不输出密码/私钥。

---

## 2. 目录结构与职责

```text
dsh-remote-ssh/
├─ package.json            # 包声明：exports、dsh.bundle.patch、dsh.client、files
├─ cordis.patch.yml        # bundle 的 Loader 补丁：insert 一行 dsh-remote-ssh 插件
├─ src/
│  ├─ index.js             # Host 插件入口：状态机、RPC、Agent 事件、提示词、realm 调度
│  ├─ remote-realm.js      # 构造某个 Agent 的隔离执行世界（挂官方工具 + 服务桩）
│  ├─ remote-fs.js         # 基于 SFTP 的完整 ctx.fs 实现
│  ├─ remote-subprocess.js # 基于 SSH exec/PTY 的 ctx.subprocess 实现 + 远端 ripgrep 供给
│  ├─ connection-manager.js# ssh2 连接池、认证、主机指纹、错误分类
│  ├─ store.js             # state.json 读写（servers / 目标 / generation / handoff）
│  ├─ utils.js             # 路径归一化、targetKey、shellQuote、known_hosts 工具
│  └─ packaged-ripgrep.js  # 打包期 alias：把 @vscode/ripgrep 换成可识别的宿主坐标
├─ dist/index.js           # 构建产物（不要手改；改 src 后 npm run build）
├─ client.js               # 浏览器半部：执行环境选择器、服务器编辑器、管理弹窗
├─ locale/{zh,en}.json     # 插件卡片标题/描述 + meta.detail（详情页用中文 README）
├─ scripts/                # 构建 + 测试 + 离线 harness
├─ assets/                 # 远端 Linux ripgrep 二进制
├─ README*.md / TESTING.md
```

---

## 3. 运行原理

### 3.1 Host 入口

```js
export const inject = ['connection', 'agents', 'systemPrompt']
export const name = 'dsh-remote-ssh'
export async function apply(ctx, config = {}) { ... }
```

`inject` 的三个服务都必须存在：

- `connection`：用它的 **Fetch 注册表** 发布 HTTP 端点（见 §4）。
- `agents`：按 SessionId 找 Activity 中的 Agent（`ctx.agents.get(id)`）。
- `systemPrompt`：为 Agent 注册运行时上下文（当前执行环境/目录/交接说明）。

> 注意：不要把 `webServer` 加进 `inject`——它能注入成功，但对 RPC 注册没有帮助，反而抬高激活门槛。历史上就是这么踩坑的，见 §4.1。

### 3.2 每 Agent 的隔离执行世界（`src/remote-realm.js`）

选择远程目标后，插件把一组官方 Provider/工具挂到 `agent.ctx` 的隔离作用域：

```js
const realm = ctx
  .isolate('fs').isolate('subprocess').isolate('shell').isolate('terminals')
  .isolate('sandboxPolicy').isolate('workingDirectory').isolate('shellEnv')
```

挂载顺序（**顺序重要**：Provider 先于消费者）：

1. `SshFileSystem` → 注册 `ctx.fs`
2. `SshSubprocessRuntime` → 注册 `ctx.subprocess`
3. `RemoteWorkingDirectory` → 注册 `ctx.workingDirectory`（固定为远端 cwd）
4. `RemoteShellEnv` → 注册 `ctx.shellEnv`（空实现，远端不继承宿主 `DSH_*`）
5. `RemoteSandboxPolicy` → 注册 `ctx.sandboxPolicy`（默认 `danger-full-access`）
6. `ToolFs`（`applyPatch: true`）
7. `ToolFsSearch`（`sampleOverCapGlobResults: true`）
8. `LocalBashExecutor`（官方 bash 执行器，配置远端 cwd）
9. `ToolBash`
10. `TerminalSessionService` + `TerminalBash`（`/bin/bash --noprofile --norc -i`）
11. `ToolTerminal`

Windows 宿主上还会 `ctx.tools.restrict({ deny: ['pwsh'] })`，避免远端会话里出现只在宿主执行的 PowerShell 工具。

隔离产生的效果（`scripts/harness-realm.mjs` 的实测）：

```text
apply_patch, bash, edit, glob, grep, read,
terminal_close, terminal_list, terminal_open, terminal_read,
terminal_send, terminal_signal, write
```

这些是**官方工具定义在 Agent 作用域的 shadow**：模型看到的 schema、参数校验、渲染完全来自 DSH，只是 `execute` 闭包里的 `ctx.fs / ctx.subprocess / ctx.shell` 指向 SSH 实现。

### 3.3 服务桩的语义

| 桩 | 为什么需要 | 行为 |
| --- | --- | --- |
| `RemoteWorkingDirectory` | 官方工具用 `ctx.workingDirectory.ensure(agent)` 取默认目录 | 返回远端 cwd；`set()` 只在内存记录远端相对路径 |
| `RemoteShellEnv` | bash 工具会 `ctx.shellEnv.collect(exec)` 注入 `DSH_*` | 返回 `{}`；宿主的 `DSH_HOME`、目录等对远端无意义 |
| `RemoteSandboxPolicy` | 终端/写入会读 `sandboxPolicy.resolve()` | `defaultMode = danger-full-access`，`workspaceRoot = 远端 cwd`；远端没有宿主沙箱 |

> 远端真正的权限边界是 SSH 账号 + 远端 OS；这里的 `danger-full-access` 是**如实声明**，不是放权。

### 3.4 Agent 生命周期

- `agent/created` / `agent/session-start`：登记 Agent，提前挂 realm。
- `agent/status`：`running` 时冻结本轮目标（`frozen`），`idle` 时解冻并重新对齐 realm。
- `agent/pre-step`：**权威同步点**，先 `syncAgentRealm()` 再放行；同时处理一次性交接说明的 ack（见 §7）。
- `agent/disposed`：释放 realm 与提示词上下文。

`target.set` 在 `running` 状态会拒绝（“会话正在运行，本轮执行位置已经锁定”），这是有意的：一轮对话中途换机器会让前后观察错位。

---

## 4. Host ↔ Client 通信（**重点，别改回旧写法**）

### 4.1 为什么不用 `ctx.connection.rpc.handle()`

0.2.2 的实现：

```js
get rpc() { const owner = this.ctx; return { handle: (c, h) => this.register(owner, c, h) } }
register(owner, c, h) { ...; return owner.effect(() => owner.webServer.register(route), ...) }
```

`owner` 是 **Connection 服务自己的 fiber Context**，而 `webServer` 由**同级**插件 fiber 提供，不在其祖先链上，于是必然抛出：

```text
cannot get property "webServer" without inject
```

结果：Host 插件 `fiberPhase: failed`，路由未注册，浏览器 `POST /dsh-remote-ssh/*` 被 SPA 静态资源兜底接管 → **HTTP 405**。
给插件加 `inject: ['webServer']` 无效（`scripts/harness-connection-context.mjs` 已复现并证明）。

### 4.2 现行方案：`/api` 上的精确 Fetch 路由

Host（`src/index.js`）：

```js
ctx.connection.fetch.register({
  path: '/api/dsh-remote-ssh',
  methods: ['POST'],
  requestBody: 'buffered',
  fetch: async request => {
    const { endpoint, payload } = await request.json()
    try { return Response.json({ ok: true, value: await business(endpoint, payload, request.signal) }) }
    catch (error) { return Response.json({ ok: false, error: rpcError(error, request.signal) }) }
  },
})
```

`registerFetchRoute` 只用 `owner.effect` 维护一张 `fetchRoutes` 表，由 Connection 自己挂载的 `/api` 共享处理器分发，不碰 `webServer`。

Client（`client.js`）：

```js
const response = await fetch('/api/dsh-remote-ssh', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  credentials: 'same-origin',
  body: JSON.stringify({ endpoint: method, payload }),
  signal,
})
```

- 非 2xx：401/403 视为会话/权限问题；404/405 提示“Host 插件未激活或路由未注册”。
- 200 且 `{ ok:false }`：抛 `error`（保留 `AUTH_FAILED` 等域错误码给 UI）。

### 4.3 Endpoint 契约

请求：`{ endpoint: string, payload?: object }`
响应：`{ ok: true, value: T }` 或 `{ ok: false, error: { code, message, details } }`

| endpoint | payload | value |
| --- | --- | --- |
| `state` | `{ sessionId }` | `{ servers, target, generation, execution, busy, hostPlatform, connections, architecture }` |
| `server.test` | `{ server, password?, allowFingerprint?, rememberPassword? }` | `{ ok, fingerprint, home, os, shell, sftp, auth, server }` |
| `server.testAndSave` | 同上 | 同上；**连接成功后才写入 state** |
| `server.remove` | `{ serverId }` | `{ removed: boolean }` |
| `server.reconnect` | `{ serverId }` | `state` |
| `target.set` | `{ sessionId, target: {type:'local'} \| {type:'ssh', serverId} }` | `state` |

`server` 形如：

```json
{ "id": "srv_…", "name": "青岛", "host": "1.2.3.4", "port": 22,
  "username": "root", "auth": { "type": "password" }, "remoteRoot": "~",
  "hostKeyFingerprint": "SHA256:…" }
```

`auth.type`：`agent` | `key`（可带 `keyPath`）| `password`（可带隐式 legacy `auto`）。

### 4.4 域错误码

| code | 含义 |
| --- | --- |
| `NETWORK_TIMEOUT` / `NETWORK_REFUSED` / `HOST_NOT_FOUND` | 网络层 |
| `AUTH_FAILED` | 认证失败 |
| `PASSWORD_REQUIRED` | 密码认证，但内存与凭据库都没有密码（未勾选记住或记录已删） |
| `KEY_NOT_FOUND` / `KEY_PASSPHRASE_REQUIRED` | 私钥缺失 / 带口令 |
| `AGENT_UNAVAILABLE` | 没有可用 ssh-agent |
| `HOST_KEY_UNTRUSTED` | 首次连接，`details.fingerprint` 供 UI 信任 |
| `HOST_KEY_CHANGED` | 指纹与已保存/刚确认的不一致 |
| `SFTP_FAILED` / `SSH_CONNECT_FAILED` / `CANCELLED` | 其他 |

---

## 5. 连接层（`src/connection-manager.js`）

- **池化**：`ConnectionManager` 是 Host 级单例，按 `server.id` 复用一个 `ssh2.Client`；`sftp()` 懒建并复用 SFTP 通道。
- **认证候选**：
  - `password`：本次 RPC 传入 → 内存 → 凭据库记录（键 `dsh-remote-ssh/<serverId，_→->`）依次解析；
  - `key`：读取 `auth.keyPath`（支持 `~`），否则尝试 `~/.ssh/id_ed25519|id_ecdsa|id_rsa`；
  - `agent`：`SSH_AUTH_SOCK` + Windows `\\.\pipe\openssh-ssh-agent`。
- **指纹**：`hostVerifier` 依次判定
  1. `allowFingerprint`（UI 信任流程刚展示的指纹，可覆盖旧指纹，用于服务器重装）
  2. 已保存 `hostKeyFingerprint`
  3. `known_hosts`（含 hashed 条目）
- **probe vs pool**：`test()` 用**临时连接**验证（必须把密码显式传进 `#open`，历史 bug）；`ensure()` 才建池。
- **密码生命周期**：`rememberPassword()` 存 `Buffer`，`forgetPassword()` 清零；勾选“记住密码”时写成凭据库 grant 记录（`modifyRecord`），取消勾选、切换认证方式或删除服务器时 `deleteRecord`；`state.json` 永不出现密码。会话在 Host 重启后的第一轮 `agent/pre-step` 也会先做凭据解析再连 SSH。
- **错误分类**：统一转成 `RemoteRuntimeError(code, message, details)`，UI 直接展示 message。
- **事件安全**：`client.on('error')` 用持久监听，避免 ssh2 多次 error 造成未捕获异常杀进程。

---

## 6. 文件系统（`src/remote-fs.js`）

`SshFileSystem extends FileSystem`（`@deepseek-ai/dsh-fs`），实现 0.2.2 的完整契约：

| 方法 | 说明 |
| --- | --- |
| `resolve(path, {cwd,signal})` | 归一化远端路径，生成 `targetKey` |
| `processPath` / `fileUrl` / `contains` | 目标坐标、`file:///` URL、包含判断 |
| `stat` / `lstat` | 返回 `{version, type, size}`；版本 = `sshfs:size:mtime:mode:uid:gid` |
| `readText` / `streamText` | UTF-8 严格解码；二进制/非法 UTF-8 报 `FS_NOT_TEXT` |
| `readBytes` / `readByteRange` | 有界读取（SFTP `createReadStream(start/end)`） |
| `listDir` | 稳定名称顺序，只给元数据 |
| `writeText` | 同目录临时文件 + rename（优先 `ext_openssh_rename`）原子发布；版本/存在性守卫 |
| `editText` | 读全文 → 字面替换 → 保留 CRLF 风格 → 原子写 |
| `patchText` | 复用 `@deepseek-ai/dsh-fs-patch` 的 `applyHunks`；不匹配报 `FS_PATCH_MISMATCH` |
| `deleteFile` / `moveFile` | 带版本守卫；move 先发布目标再删源，源删除失败返回 `sourceDeleted:false` |

路径语义（`src/utils.js`）：

- `~` → 远端 home（SFTP `realpath('.')`）
- `~/x` → home 下
- 绝对 POSIX 路径保持绝对
- **Windows 风格路径**（`E:\…`）视为宿主坐标，映射到远端默认 cwd（DSH `SessionHeader.cwd` 会泄漏过来）
- `default cwd ≠ home ≠ 访问边界`

限制：**不支持 `watch()`**（基类默认抛 `FS_IO_ERROR`）；大文件 `readText` 会整读（工具层用 `readBytes`/`readByteRange` 限流）。

---

## 7. 子进程 / Shell / 终端（`src/remote-subprocess.js`）

`SshSubprocessRuntime extends SubprocessRuntime`：

- `spawn(spec)`：`sh -c` 包装脚本，`cd` 到远端 cwd，应用显式 env，`setsid` 起进程组，stderr 输出 PID marker `__YWM_PID:<pid>`，然后 `wait` 并回传退出码。
- `terminate()`：先 `kill -TERM -- -<pgid>`，等待 grace，再 `KILL`。
- `spawnTerminal(spec)`：`client.exec(cmd, { pty })`，解析 `__YWM_TTY_PID_<rand>__:<pid>` 得到顶层 pid；提供 `output`、`write`、`resize`、`inspectForeground`（`ps -o tpgid`）、`signalForeground`、`terminate`。
- `resolveExecutable()`：远端 `command -v` / `test -x`；打包 rg 坐标特殊处理。
- **ripgrep 供给**：`@vscode/ripgrep` 被 esbuild alias 到 `src/packaged-ripgrep.js`（`rgPath = 'dsh-packaged-ripgrep:rg'`）。`spawn/resolveExecutable` 识别该坐标后：
  1. 远端 `uname -s/-m` 判定 Linux 架构；
  2. 从 `assets/rg-linux-<arch>` 取二进制；
  3. SFTP 上传到 `~/.cache/dsh-remote-ssh/dsh-tools/ripgrep-1.18.0-<arch>/rg`，`chmod 700`；
  4. `rg --version` 校验后缓存复用。

`LocalBashExecutor` 由官方包提供，配置 `{ cwd: 远端cwd, timeoutMs, maxTimeoutMs, maxOutputBytes, maxSpillBytes, graceMs }`，通过上面的 `ctx.subprocess` 跑 `bash -c`。

终端栈：`TerminalSessionService`（官方）+ `TerminalBash`（官方 PTY 后端）+ `ToolTerminal`，PTY 由 SSH `pty` 通道提供。

---

## 8. 会话状态与提示词（`src/index.js` + `src/store.js`）

### 8.1 state.json（schemaVersion 8）

```json
{
  "version": 8,
  "servers": [ { "id": "srv_…", "name": "青岛", "host": "…", "port": 22,
                 "username": "root", "auth": { "type": "password" },
                 "remoteRoot": "~", "hostKeyFingerprint": "SHA256:…" } ],
  "selectedBySession": { "<sessionId>": { "type": "ssh", "serverId": "srv_…" } },
  "generationBySession": { "<sessionId>": 2 },
  "handoffsBySession": { "<sessionId>": [
      { "generation": 2, "time": 1760000000000,
        "from": { "type": "local", "name": "本地电脑", "platform": "Windows" },
        "to": { "type": "ssh", "identity": "server:srv_…", "name": "青岛", "platform": "Linux" } } ] },
  "handoffContextAckBySession": { "<sessionId>": 2 }
}
```

- 原子写：临时文件 + rename；`mode 0600`。
- **servers 里永远没有 password 字段**；`state` 只额外返回 `passwordStored: boolean`（凭据库里是否存在记录）。
- 勾选“记住密码”时，密码写入 `$DSH_HOME/.credentials.yaml` 的 `records["dsh-remote-ssh/<id>"] = { kind: "grant", payload: { password } }`；取消勾选、改为 key/agent、删除服务器都会 `deleteRecord`。
- 删除服务器会把它从各会话目标中移除并 bump generation。

### 8.2 执行环境上下文

`agent.ctx.systemPrompt.context({ name: 'dsh-remote-ssh:execution-world', order: 10000, text })`：

- 会话从未切换过 → 返回空串（保持原生 DSH 提示词）。
- 否则输出：当前环境名、OS、cwd，并声明“DSH 文件/Shell/搜索/终端工具在此环境执行”。
- 若存在未确认的 handoff，追加一句“刚从 A 切换到 B，切换前的机器观察属于旧环境”。

### 8.3 交接（handoff）与 ack

`target.set` 成功且目标变化时：`generation++`、记录 handoff。`agent/pre-step` 在 `next()` 返回 `{kind:'enter'}` 且未取消后才 `acknowledgeHandoffContext(generation)`——**被拒绝/取消的步骤不会消耗一次性提示**。

### 8.4 子会话

子 Agent（subagent）没有自己的目标时，继承 `session.header.parentSession` 的目标；只继承目标，不共享 Provider。

---

## 9. 客户端（`client.js`）

- 形态：`window.__ModuleLoader__.load({ id: 'dsh-remote-ssh', factory(require) { ... } })`。
- `inject = ['slots', 'locale']`；`require('react')` / `require('react-dom')` 来自平台种子模块。
- 注册位置：`conversation.input.left`，id `dsh-remote-ssh:target`，`inject: () => ({ t, rpc })`。
  - slot props 自带 `sessionId`；`t` 来自 locale 命名空间 `dshRemoteSsh`。
- UI 组成：
  - 触发器：服务器图标 + 当前目标名 + 下拉箭头；
  - 弹出菜单：本地电脑 / 已保存服务器（状态点）/ 添加 / 管理；运行中禁用；
  - 添加/编辑弹窗：名称、主机、端口、用户名、认证方式（Agent/私钥/密码）、默认目录、密码（可记住/仅内存）；
  - 指纹信任：`HOST_KEY_UNTRUSTED` / `HOST_KEY_CHANGED` 时展示 `SHA256:…`，用户确认后带 `allowFingerprint` 重试；
  - 保存成功自动 `target.set` 切到该服务器；
  - 管理弹窗：重连 / 编辑 / 删除。
- 样式：`<style id="dsh-remote-ssh-style">`，用 `--dsw-alias-*` 主题变量；弹窗 portal 到 `document.body`；整体紧凑（菜单 258px、弹窗 560px、输入 30px）。
- i18n：`ctx.locale.register('dshRemoteSsh', { zh, en })`，`t(key)`。
- 传输：见 §4.2（直接用 `fetch('/api/dsh-remote-ssh')`）。

---

## 10. 构建与依赖策略（`scripts/build-host.mjs`）

```bat
npm run build   :: 生成 dist/index.js + assets/rg-linux-*
npm run check   :: build + 全部 node --check
npm test        :: 端到端测试
```

关键点：

- `bundle: true`，**把所有 `@deepseek-ai/*` 与 `ssh2` 打进 dist**。原因：DSH 不会替 profile 里 `link:` 的插件解析其 `node_modules`，外部 import 会 `ERR_MODULE_NOT_FOUND`。
- `nodePaths: ['../ref/dsh-0.2.2']`：从本机 DSH 安装提取的 0.2.2-rc.1 官方包作为构建输入，保证与运行时 API 一致。
- `alias: { '@vscode/ripgrep': 'src/packaged-ripgrep.js' }`：把宿主 rg 坐标替换成可识别的标记。
- 插件内部依赖的 `cpu-features`、`sshcrypto.node` 被替换为“不可用”的桩，避免原生模块。
- `dist/index.js` 约 1.4 MB，无任何裸 import（除 `node:*`）。
- 修改 `client.js` 不需要构建；Host 侧改动必须 `npm run build`。
- Cordis 支持多份拷贝（`Symbol.for` 品牌），所以打包官方包不会与服务注册冲突。

---

## 11. 测试

`npm test`（`scripts/test-rpc.mjs`）会：

1. 用 `ssh2` 在本机起一个真实 SSH 服务器（密码 + 公钥、exec、SFTP REALPATH）；
2. 按真实 Desktop 组合搭 Context：`webServer` 是**同级** fiber，Connection 在自己的 fiber（`inject: ['credentials']`）；
3. 通过真实 `createSharedFetchHandler('/api')` 调 `POST /api/dsh-remote-ssh`；
4. 断言 48 项：状态、非 POST 拒绝、未信任指纹、错误密码不保存、正确密码保存、记住/取消记住、**模拟 Host 重启后从凭据库自动重连**、私钥登录、拒绝端口、`target.set`、`remove`、磁盘重读、无密码落盘等。

离线 harness（都需要 `../ref/dsh-0.2.2`）：

```bat
node scripts/harness.mjs                  # 假 connection.fetch + 插件 apply
node scripts/harness-plugin-rpc.mjs       # 真实 ConnectionService + 真实共享处理器
node scripts/harness-connection-context.mjs # 复现 rpc.handle 的 0.2.2 限制
node scripts/harness-realm.mjs            # 隔离世界注册 13 个官方工具
node scripts/harness-fs.mjs               # 内存 SFTP 全契约
node scripts/harness-subprocess.mjs       # 进程/PTY
node scripts/harness-client.mjs           # 浏览器半部加载 + slot 注册
```

参考包目录不存在时的重建方式：从 `E:\DeepSeek Harness\resources\app.asar` 提取 `dsh/node_modules/@deepseek-ai` 到 `../ref/dsh-0.2.2/`，再补 `diff`、`undici`、`zod`，并建 `node_modules/@deepseek-ai` junction。

---

## 12. 已知限制

1. **没有远端沙箱**：`sandboxPolicy` 固定 `danger-full-access`；权限 = SSH 账号。不要在远端假装有 `workspace-write`。
2. **密码默认记住**：保存在本机凭据库（与 API Key 同一文件，明文 YAML、0600）；可在弹窗取消勾选改为仅内存。
3. **ripgrep 仅 Linux**：非 Linux 远端会在 `glob/grep` 时明确报错。
4. **`fs.watch` 不支持**：依赖文件监听的 UI 在远端模式下不可用。
5. **紧耦合 0.2.2**：`inject` 名称、`fetch.register`、工具包内部结构变化都可能需要适配；升级 DSH 后先跑 `npm test` 与 harness。
6. **运行中锁定**：一轮对话不能换执行环境；需要等 idle。
7. **子会话继承目标**：父会话切远端时，新建子会话默认也在远端。
8. **仅 Web/Desktop**：客户端半部依赖 `__ModuleLoader__` 与 `/api` carrier。
9. **终端 `terminal_read` 的行为**取决于官方终端栈；远端 PTY 的 scrollback 由 SSH 通道与官方缓冲共同决定。

---

## 13. 二次开发指南

### 加一个 RPC endpoint

1. `src/index.js` 的 `business(method, payload, signal)` 加 `case 'server.xxx':`；
2. 错误用 `throw new RemoteRuntimeError(code, message, details)` 或普通 `Error`；
3. 客户端 `rpc('server.xxx', payload)` 即可；返回 `{ok:true, value}` / `{ok:false, error}` 由框架处理；
4. 在 `scripts/test-rpc.mjs` 加断言。

**不要**改回 `ctx.connection.rpc.handle()`。

### 改远端 Provider

- fs 契约变化 → 对照 `@deepseek-ai/dsh-fs` 的 `lib/index.js` 与 `fs-local` 实现补齐；
- subprocess 契约变化 → 对照 `dsh-subprocess` 的 handle 字段（`done/terminate/waitForExit/collected/output`）；
- 新增服务桩 → 在 `remote-realm.js` 的 `isolate()` 列表里加名字并挂实现，否则官方工具会读到宿主服务。

### 改 UI

- 只改 `client.js`，保存后 HMR 会在 ~500ms 内重建；若没变化按 F5；
- 弹窗用 `Modal`（portal 到 body），不要塞进 composer 的 overflow 容器；
- 文案走 `DICT` + `t()`；
- 样式优先用主题变量，别写死颜色。

### 升级 DSH 的检查清单

1. 重新导出参考包；
2. `npm run build`；
3. `npm test` + 全部 harness；
4. 重启 Desktop，`plugin_manager list_plugins` 确认 `fiberPhase: active`；
5. 打开页面确认 `POST /api/dsh-remote-ssh` 返回 200（不是 404/405）。

---

## 14. 排障手册

| 症状 | 原因 | 动作 |
| --- | --- | --- |
| 插件卡片“异常：cannot get property webServer without inject” | 用了 `rpc.handle` 或旧版本 dist | 用 `fetch.register`；重新 `npm run build` 并重启 Host |
| 保存报 HTTP 404/405 | Host 插件未激活 / 端点未注册 | `plugin_manager list_plugins` 看 `include:dsh-remote-ssh` 的 `fiberPhase` 与 `diagnostic`；重启 Desktop |
| `AUTH_FAILED` | 用户名/密码/私钥不匹配 | 检查认证方式；密码错误时重新输入并保存 |
| `PASSWORD_REQUIRED` | 内存和凭据库都没有密码 | 在管理弹窗点“输入密码”，或编辑后“测试并保存”并勾选记住 |
| `HOST_KEY_UNTRUSTED` | 首次连接 | 核对指纹后“信任并保存” |
| `HOST_KEY_CHANGED` | 服务器重装/换钥，或 MITM | 核对后再信任 |
| `NETWORK_REFUSED` / `NETWORK_TIMEOUT` | 网络/端口/防火墙 | 先在本地 `ssh` 验证 |
| `glob/grep` 报 ripgrep 错误 | 远端非 Linux 或架构不支持 | 检查 `uname -s/-m`；补充 `assets/rg-linux-*` |
| 切不了执行环境 | 会话正在运行 | 等本轮结束再切 |

诊断命令（只读）：

```text
plugin_manager list_plugins  → fiberPhase / diagnostic
cordis_inspect_query(host, Config, listConfigs, {name:'dsh-remote-ssh'})
cordis_inspect_query(host, Service, listService, {service:'webServer'})
```

---

## 15. 交接自检清单（接手者第一次上手）

- [ ] `npm run check` 通过
- [ ] `npm test` 48/48
- [ ] 读一遍 `src/index.js` 的 `business()` 与 `apply()` 末尾的 RPC 注册
- [ ] 读一遍 `src/remote-realm.js` 的挂载顺序
- [ ] 读一遍 `scripts/harness-connection-context.mjs`（理解为什么不能 `rpc.handle`）
- [ ] 确认 `client.js` 只依赖 `slots` 与 `locale`
- [ ] 改完 Host 代码：`npm run build` + 重启 DSH
- [ ] 改完 Client 代码：等 HMR 或 F5

---

## 16. 相关文件索引

| 主题 | 文件 |
| --- | --- |
| 入口 / RPC / 状态机 | [src/index.js](src/index.js) |
| 隔离世界 | [src/remote-realm.js](src/remote-realm.js) |
| SFTP 文件系统 | [src/remote-fs.js](src/remote-fs.js) |
| SSH 进程 / PTY / ripgrep | [src/remote-subprocess.js](src/remote-subprocess.js) |
| 连接池 / 认证 / 指纹 | [src/connection-manager.js](src/connection-manager.js) |
| 持久化 | [src/store.js](src/store.js) |
| 路径与工具函数 | [src/utils.js](src/utils.js) |
| 浏览器半部 | [client.js](client.js) |
| 构建 | [scripts/build-host.mjs](scripts/build-host.mjs) |
| 端到端测试 | [scripts/test-rpc.mjs](scripts/test-rpc.mjs) |
| 中文说明 | [README.zh-CN.md](README.zh-CN.md) / [TESTING.md](TESTING.md) |
