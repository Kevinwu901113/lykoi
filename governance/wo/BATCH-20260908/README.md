# BATCH-20260908 · 合并与部署交付

状态：已按所有者 2026-09-08「合，部署」授权 --no-ff 合并并推送；部署包已上传，root 执行待办。当前 SSH 账户无无密码 root：lykoi-gov 仅只读 sudo，lykoi sudo 需密码。未停服务、未写生产树、未修改实例/状态库、未签署。

- GitHub main 合并提交：`2e152f2650d17ca34b74efbed4c0e10ccce6be7a`。
- 源码树与通过全量测试的 `09eb5bd` 完全一致；已有有效验证 1217 / 1206 pass / 0 fail / 11 skipped，typecheck 净。本次无源码变更、不重复全量。
- 本次生产只读实证：HEAD `257a72ec1f0e09e69fd28f6234ca9266996757e5`，树净；brain/browser active，NRestarts 均0；watchdog/backup timers active；schema18，journal_mode=delete；continuations completed 2；persona root:root444、目录755；seeds/deploy/spool不存在。
- 生产落后 main 的 subtraction、pulse、E4-1/2 与本批一并到目标；不是只部署最新分支差异。认知 schema 文件与旧生产零差异。
- Linux隔离副本：现有persona通过新解析器；旧代理→deploy TOML往返值相等、未输出实际值；instance_facts零命中；带deploy的新manifest预计129。bash -n及Linux数值/提交断言通过；服务器SHA256校验三文件通过。

## 执行

服务器 root 会话复制下面整段。先复制到root私有目录，再验证固定校验表及全部文件，全部通过才执行；任何前置失败不会进入部署。`review-tree` 不需要复制。

```bash
set -e
install -d -m 700 /root/lykoi-batch-20260908
cp /tmp/lykoi-batch-20260908/{deploy.sh,rollback.sh,release.bundle,SHA256SUMS} /root/lykoi-batch-20260908/
cd /root/lykoi-batch-20260908
printf '%s  %s\n' 4f7c3ec496584e595de1ef6f4cb783475f6d875e51b919cb24bbc7c6d243e7c3 SHA256SUMS | sha256sum -c -
sha256sum -c SHA256SUMS
bash deploy.sh
```

预期：`PROXY_CAPTURE_OK` → 停写与完整备份 → 固定树/npm ci/实例部署配置 → `INSTANCE_OK` → `gate: OK` → `BROWSER_HEALTH_OK` → `DONE head=2e152f2... schema=18 spool=2 manifest=129 ...`。停止条件：任何STOP或非零立即停，不跳过闸、不重签掩盖异常；出错日志路径在输出内。脚本不输出persona/代理/凭据；不迁移mind、不切WAL、不播种新记忆。

备份位于 `/root/landing-batch-20260908-<timestamp>/backup.tar.gz`，含state、persona目录、browser profile、audit和旧manifest，保持root私有。部署保留单元配置与启用状态，恢复timer在启动验证之后。

回滚：`bash /root/lykoi-batch-20260908/rollback.sh`。回滚保留state/cursor/audit/spool/实例文件，不把新状态覆盖回旧备份。若spool尚有未终局或未投影回合，脚本拒绝回滚并保持服务停止，应先修复前进/处理积压；不得删spool。

## 验收边界

DONE仅证明落地与启动检查通过；还需真实入站合并、审批消费、revision/排队、utterances逐字实收、continuation终局与outbox送达证据。C1两条缺样本、C2真实tax、Recall实测继续pending；部署不自动算这些实验完成。

部署bundle不入Git：服务器 `/tmp/lykoi-batch-20260908/release.bundle`，SHA256 `d64e8f52a601174fa94ff39a222f689bb4ca1fdbc126df9357b91e9a46227407`。本目录的治理归档提交晚于部署钉点，仅是文档/脚本，不更改运行时代码。
