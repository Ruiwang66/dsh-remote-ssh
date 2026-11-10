# 测试说明

所有测试都在本目录内运行，不需要改动 DSH Profile，也不需要真实服务器。
`scripts/` 下的 harness 会从 `../ref/dsh-0.2.2` 读取与本机 DSH 安装一致的
0.2.2-rc.1 官方包；升级 DSH 后需要重新导出该参考目录。

## 端到端接口测试

```bat
npm test
```

`scripts/test-rpc.mjs` 会：

- 用 `ssh2` 在本机启动一个真实 SSH 服务器（密码 + 公钥认证、exec、SFTP REALPATH）；
- 按真实 Desktop 组合搭建 Context：`webServer` 来自同级插件 fiber，Connection 服务位于自己的 fiber（`inject: ['credentials']`）；
- 通过真实的 `createSharedFetchHandler('/api')` 调用本插件的 `POST /api/dsh-remote-ssh`；
- 覆盖：`state`、非 POST 拒绝、未信任指纹、错误密码、正确密码保存、记住/取消记住密码、**模拟 Host 重启后从凭据库自动重连**、私钥登录、连接拒绝、`target.set`、删除、保存后重新读取。

当前结果：**48 passed, 0 failed**。

`scripts/harness-connection-context.mjs` 单独证明 0.2.2 的组合约束：在该布局下
`ctx.connection.rpc.handle()` 必然抛 `cannot get property "webServer" without inject`，
而 `ctx.connection.fetch.register()` 正常，这就是插件改用 `/api` 精确路由的原因。

## 组件 harness

```bat
node scripts/harness-realm.mjs      # 隔离执行世界注册 13 个官方工具
node scripts/harness-fs.mjs         # SFTP 文件系统全契约（含 patch/move/delete）
node scripts/harness-subprocess.mjs # SSH 进程与 PTY
node scripts/harness-client.mjs     # 浏览器半部加载与 slot 注册
node scripts/harness-plugin-rpc.mjs # 在真实 Connection 服务上注册 RPC 路由
```

## 构建与语法检查

```bat
npm run check
```
