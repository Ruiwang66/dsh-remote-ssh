# DSH Remote SSH

让 **DeepSeek Harness（DSH）** 使用原生工具直接操作远程 Linux 服务器。

在对话输入框左侧选择一台已添加的服务器后，DSH 原有的 `read / write / edit / apply_patch / glob / grep / bash / terminal` 会切换到远端执行。插件不修改 DSH 源码，服务器也无需安装 DSH、本插件、Node.js 或 Python。

## 功能

- 在 DSH 页面内添加、测试、管理和选择 SSH 服务器。
- 在本地电脑与已添加的服务器之间切换执行环境。
- 保留 DSH 官方工具，不新增能力受限的 `ssh_*` 替代工具。
- 通过 SFTP 操作文件，通过 SSH exec / Shell 执行命令，通过 SSH PTY 提供交互终端。
- 保留官方 `glob / grep`，自动处理并缓存远端 Linux 所需的 ripgrep。
- 支持 SSH Agent、私钥文件和临时密码认证。
- 首次连接核对 SSH Host Key 指纹，指纹变化时拒绝连接。
- DSH Host 维护并复用服务器连接，不会为每条消息重新登录。

## 安装

在 DSH Desktop 的「设置 → 插件」中安装本地插件并指向本目录（等价于
`dsh plugin --profile <profile> add <本目录>`），安装后重启 DSH。插件不修改 DSH 源码。

支持 DSH `0.2.2-rc.1`（Web/Desktop）。从 GitHub 克隆后安装：

```bat
git clone https://github.com/Ruiwang66/dsh-remote-ssh.git
dsh plugin --profile desktop add ./dsh-remote-ssh
dsh web
```

仓库已包含自包含的 `dist/` 和 Linux ripgrep 资产，安装无需构建或运行
`npm install`。二次开发需要 Node.js 24 及匹配版本的 DSH 参考包，详见
[HANDOFF.md](./HANDOFF.md) 和 [TESTING.md](./TESTING.md)。

## 使用

1. 启动 DSH Web。
2. 打开输入框左侧的执行环境选择器。
3. 选择“添加服务器”。
4. 填写连接信息、认证方式和默认工作目录。
5. 按页面引导核对服务器指纹并点击“信任并保存”。
6. 在输入框左侧选择该服务器。

以后只需选择已保存的服务器。切换后模型仍然使用 DSH 官方工具，变化的只是工具背后的执行位置。

## 架构

```text
模型
  │
DSH 官方工具 read · write · edit · apply_patch · glob · grep · bash · terminal
  │
DSH 官方执行接口 ctx.fs · ctx.subprocess · ctx.shell · ctx.terminals
  │
每个 Agent 独立的执行世界（Cordis 隔离作用域）
  ├─ 本地：DSH 原生 Provider
  └─ 远程：SFTP 文件系统 · SSH exec 进程 · SSH PTY 终端 · 远端 ripgrep
```

## 认证

| 方式 | 说明 |
| --- | --- |
| SSH Agent | 只请求 Agent 签名，不读取私钥正文，也不启用 Agent Forwarding |
| 私钥文件 | 只保存密钥路径，连接时读取文件 |
| 临时密码 | 只保存在当前 DSH Host 进程内存，重启后需要重新输入 |

## 远端要求与安全边界

- 目标为提供 SSH / SFTP 和 POSIX Shell 的 Linux / Unix 主机。
- 每台服务器可设置默认工作目录；它是默认 `cwd`，不是路径沙箱。
- 实际访问能力等同于远端 SSH 账号权限；Remote Provider 不会向远端暴露 DSH Host 的本地文件系统。
- 模型 API Key、Base URL 等仍由 DSH 管理，本插件不读取或保存。

## 状态文件

服务器列表与每个会话选择的执行环境保存在 `$DSH_HOME/remote-ssh/state.json`（默认 `~/.dsh/remote-ssh/state.json`），权限为 0600。密码不写入该文件。

## 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 保存时提示 `HTTP 404/405` 或“Host 插件未激活” | Host 半部没有激活，`/api/dsh-remote-ssh` 端点未注册，请求被静态页面接管。重启 DSH Desktop（确保托盘进程也退出）后重试；`npm test` 可验证接口本身。 |
| 首次保存要求核对指纹 | 正常行为。确认指纹与服务器 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` 一致后点“信任并保存”。 |
| `AUTH_FAILED` | 用户名、密码或私钥不匹配；密码只保存在 Host 进程内存，重启后需要重新输入。 |
| `NETWORK_REFUSED` / `NETWORK_TIMEOUT` | 地址、端口或防火墙问题，与插件无关。 |

## 测试

见 [TESTING.md](./TESTING.md)。`npm test` 会用本机 ssh2 服务器跑完整的接口与保存流程。

## License

MIT
