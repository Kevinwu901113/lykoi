# WO-COMPOSER-CLEANUP-04 执行报告

状态：实现与自验通过。所有者已明确选择整体退役旧个人 Agent 运行时，仓库收敛到 Composer。没有声称完成独立复核或服务器部署。

## 结果

删除 25 个旧包、27 个旧 profile 文件、8 个部署模板、16 个旧使用文档，共 371 个文件、66,309 行。旧包原本由旧入口真实使用，属于产品退役，而非从未使用的死代码。删除旧 Kernel/Gate 整个包，不移植或修改其权限语义；删除范围已在 order.md 明确记录。

当前只保留 packages/lykoi-composer 和 profile/composer.ts。Composer 源码为 13 个文件、2,734 行；其 12 个节点、执行策略、实例隔离、持久回执、人工等待和恢复行为保留。源码仅删除一项未使用的 AgentDefinition 类型导入；WebUI 未改动。

npm start 与 npm run composer 统一启动 Composer。锁文件从 113 条记录收敛到 6 条；保留 TypeScript、Node 类型及其 undici-types 类型依赖，没有第三方运行依赖。npm ls --all 无缺失或 extraneous；没有旧包或 Cordis 引用。类型检查启用 noUnusedLocals/noUnusedParameters。

README、CLAUDE.md、当前使用文档和 CI 已对齐新入口。governance 全部历史证据保留；历史交接、CURRENT_VERSION 和治理入口增加明确的历史适用范围声明，避免把旧生产装配和旧架构当成当前要求。

## 验证

- 清理前 Composer 31/31；清理后 npm test 31/31，测试名称逐项一致，未删除或修改 Composer 测试。
- npm ci、npm run typecheck 与 git diff --check 通过。
- 实际 npm start -- <临时部署文件> 返回 HTTP 200，建立 SQLite/进程锁，SIGTERM 正常释放锁。
- DOM 页面+真实本机 API 操作通过。
- 实际 Chromium：既有画布操作、拖动、缩放、撤销重做、保存、等待恢复、主题和响应式通过；语义路由的条件端口、配置、原始输入引用、跳过分支、人工审核及 JEV 资源句柄保存通过。两份浏览器报告均零 page errors。
- 所有可执行源码无旧包导入；删除清单保留每个旧文件的 blob SHA，便于历史追溯。

**测试口径**：旧全仓基线 1,329 项中的 1,298 项属于被退役的旧范围（187 个旧测试/验收辅助文件随产品删除），不是被修复或迁移。此前的 14 个旧环境失败未被本次修复；当前 31/31 是同一套保留 Composer 测试的前后对照。

浏览器验收工具安装在仓库外。首次 Chromium 解压遇到本环境 chown EINVAL，修正测试工具临时目录的 tar 解压选项并顺序解压后重新验收通过；没有修改产品依赖或代码以规避验收。

## 历史与部署边界

完整旧实现仍在 Git 基线 01afb64f3859ef46cd0e9a903ef3c085f3e56c2a，可在 detached worktree 查阅恢复，不创建永久远程分支。历史并未重写。

本次没有连接服务器、停服、读取/迁移/删除真实旧状态或部署新版。仍运行旧个人 Agent 的服务器必须固定旧提交，不能拉当前 main 沿用旧部署模板。真实 JEV 线上联调仍未执行；删除旧代码不会增加 Composer 的沙箱、多人权限、长期记忆或心跳能力。

证据：audit.json、removed-files.json、before-composer-tests.txt、composer-tests.txt、clean-install.txt、dependencies.txt、typecheck.txt、startup-result.json、dom-result.json、ui-browser-result.json、routing-browser-result.json。
