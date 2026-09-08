# WO-CHANNEL-NEUTRAL-01 · 接续报告

状态：实现及本地验证完成，基线 A3 `9c4fa24`，分支 `wo/channel-neutral-01`。未合并 main、未部署；本地自检不替代独立治理复核。

## 行为与落实

- D-1/D-3：旧事件在基线已为零；A2 的 ingress、parts/turn/run ID 继续原样使用，不新造重复事件或倒退合并 ID。
- D-2：adapter 提供 `messenger`，converse/continuation 及实际接线测试改用它。公开 `MessengerAdapterService`；旧 `TelegramAdapterService` 保留为一版类型别名，adapter 内 poll helper、transport bridge 及既有测试仍引用别名。`telegramTransport` 保留平台名称。
- D-4/D-5：ReadWriteMemory.ownerBinding 只查 active owner，按 channel/channel_key 排序取首条。converse/outbox、continuation、suggestion 都使用这一绑定。kernel scope 的默认通道通过读点注入，converse/wake 接同一 store；没有绑定且 params 未指定 channel 时抛错，resolveScopeKey 沿原 fail-soft 返回 null，不获得范围授权。
- 多通道 owner 与当前单 messenger 传输之间新增装配检查。adapter 声明自己的 channel；不匹配时 converse 启动失败，避免 ID 被误投到另一个平台。仍是单传输装配，本单不实现多 adapter 路由。
- D-6：真实 SQLite 测试覆盖无绑定、多绑定排序、archived owner；scope 覆盖无绑定拒绝、显式 irc、owner matrix；实际 Context + SQLite 验证错通道装配拒绝。既有真实 adapter/converse 测试均改用新服务键。

## 验证

`npm run typecheck`、`git diff --check` 通过。最终完整 `npm test` 退出0：**1197 tests / 1186 pass / 0 fail / 11 skipped**。新增2个测试，修改scope已有测试覆盖拒绝方向。

所有 packages/*/src/*.ts 执行耦合扫描（基线→本单）：

| 表达式 | 前 | 后 |
|---|---:|---:|
| get('telegram') | 4 | 0 |
| lykoi/telegram/inbound | 0 | 0 |
| ownerChannelKey('telegram') | 2 | 0 |
| DEFAULT_CHANNEL / MESSENGER_CHANNEL | 4 | 0 |

不能使用“全仓 telegram 为零”作为本单验收：真实 Telegram 实现、类型兼容、平台绑定 CLI、测试夹具与历史注释应保留各自身份。

## 剩余耦合与交付

| 位置 | 留存类别 |
|---|---|
| converse/src/index.ts、continuation.ts | 从 adapter 包导入器官/类型，搬包留后继 |
| wake/src/index.ts | outboundOrganResources、messenger/transport 遥测值导入 |
| organ-browser/src/index.ts | adapter/resources 的 handler 注册 |
| gate/src/surface.ts | LYKOI_TELEGRAM_* 钉面、状态文件名 |
| adapter/src/* | 平台传输、平台审计、outbox/undelivered 仍在原包 |
| memory/src/init-state.ts | Telegram 绑定 CLI |

改动源码为 adapter/index、converse/index/continuation、kernel/scope/suggestion-conversation、memory/rw、wake/index，共7个 manifest 源文件；其余是对应测试及本单文档。无 schema/依赖/env 变更，prompt与policy-core不改。生产仍需重新签署 manifest。升级时全部消费者必须一起切换服务键，旧类型别名不提供旧运行时服务。修改 owner 绑定/更换传输需重新核对装配通道；本单没有改生产绑定或部署。
