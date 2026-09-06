# WO-SUBTRACTION-01 发布记录

2026-09-06：main 已合并 `8e74285a06bc4186927bbefb0902792976db0a97`。
所有者明确选择仅部署本轮减法，保留当前生产功能，不上线 main 中此前未部署的 PULSE、E4-1、E4-2。

发布分支 `release/subtraction-01` 从生产 `257a72ec1f0e09e69fd28f6234ca9266996757e5` cherry-pick 本轮实现，目标为 `20ad4c3160a66691f3478fef87b1ff842e1e944e`。不要直接部署 main。

- 发布分支 typecheck 通过；1149 tests / 1138 pass / 0 fail / 11 skipped。
- [发布 CI](https://github.com/Kevinwu901113/lykoi/actions/runs/33967773554) success，head 与发布目标一致。
- 最近只读复核：生产仍为 257a72e，工作树干净；cordis、browser、watchdog timer、backup timer 均 active。
- 无依赖、配置或数据库迁移；schema 保持 18，manifest 从 117 变为 119（新增两个源码辅助文件）。

## 材料与当前阻塞

本地 bundle：`/private/tmp/lykoi-subtraction-01.bundle`，已通过 git bundle verify。
同目录 deploy.sh、rollback.sh 已通过本地 bash -n。
目标暂存目录为 `lykoi-gov:/tmp/lykoi-subtraction-01/`；上传被自动审批拒绝，要求所有者明确授权向该主机传输包含私有源码的包。当前尚未上传，也未执行生产切换。

| 远端文件名 | SHA256 |
|---|---|
| release.bundle | b59ae12392294479cf078b8687d534571da82cbe8fb68aa065ce5ec1a6b915b2 |
| deploy.sh | f9eb2c25039d4849465b05439fcfa63db1b27bf39796bfbdbf8885a21fb3d3f0 |
| rollback.sh | 265fa55b8918b85feda37fe64285931295ca240f8f8caee98cded402e6bb4cba |

上传获准后，先校对远端三份文件的 SHA256 并运行 bash -n，再由所有者在 root 会话运行：

```bash
bash /tmp/lykoi-subtraction-01/deploy.sh
```

预期末行 `DONE head=20ad4c3160a66691f3478fef87b1ff842e1e944e schema=18 manifest=119 ...`。
脚本包含停止服务、备份、版本切换、重新签署、gate、browser RPC 与服务检查。任何 STOP 都应停止后续操作并保留日志。需要撤回本次代码时，由 root 执行 `bash /tmp/lykoi-subtraction-01/rollback.sh`；不回滚数据库。

当前 SSH 账号没有生产写入、签署及服务重启权限。待 root 返回日志后复核版本、gate、服务和真实使用结果，方可记录部署完成。
