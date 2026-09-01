# WO-BACKUP-OFFSITE-01 · 新体异地备份链重建

- 签发：治理侧，2026-09-01（观察周砍除后第一批风险销账单）
- 承接：**治理侧主笔**（产物主体是 root 安装粘贴稿 + 服务器侧核对，非仓库业务代码）
- 优先级：最高。事实链：旧 offsite_backup 随 lykoi crontab 于 09-01 整表退役；
  Mac 拉取腿 2026-09-01T18:02 起 `pull FAILED rc=23`（服务器
  `/home/lykoi/state/backups` 已不存在）。**新体自 09-01 起零异地备份**，
  memory.db = 她的身份（CF 迁移三不解除之一：数据即身份）。

## goal

恢复"服务器每日打包 → Mac 拉取"的异地备份链，覆盖新体全部持久态。

## scope

1. **服务器侧（root 安装件）**：systemd 定时器（root 签名，不再用 lykoi
   crontab——旧表已退役不复活），每日打包：
   - `/home/lykoi/state` 全量（45M 量级；含 memory.db、budget.json、
     heart-state、telegram 游标等）。memory.db 用 `sqlite3 ".backup"`
     在线一致性快照，不裸 cp（服务在跑）。
   - 生产装配指纹：生产树钉 sha（git rev-parse）+ persona TOML sha256 +
     units 清单（重建用元数据，非 secrets）。
   - 产物落 `/home/lykoi/state/backups/lykoi-state-YYYYMMDD.tar.gz` + 同名
     `.sha256`；保留 14 份，超期轮转删除。
   - **路径必须是 `/home/lykoi/state/backups/`**——Mac 拉取脚本
     （`pull_server_backups.sh`，源 `lykoi@lapw1ng.com:state/backups/`）
     零改动即恢复绿。
2. **Mac 侧核对**：安装件落地后一次手动触发拉取，确认 rc=0 且产物到达
   `~/lykoi/backups/server-state/`，哈希与服务器侧一致。
3. 粘贴稿纪律：显式 if/exit，禁 `[ … ] && echo`（set -e AND-OR 豁免教训）；
   命令带前验（目录/服务存在性）。

## forbidden

- 不碰 secrets 内容（备份包不含 `/home/lykoi/secrets`；重建时凭据自备，
  与 deploy.md §13 口径一致）。
- 不动 lykoi-cordis 服务与业务代码；不重启服务。
- 不改 Mac 拉取脚本（源路径按 scope-1 对齐后应零改动；若实测必须改，
  停工上报）。

## success_criteria

① 服务器手动触发一次备份作业：产物 + `.sha256` 生成，`tar -t` 可列且含
memory.db 快照；② sqlite 快照可 `PRAGMA integrity_check`=ok；③ 轮转逻辑
实测（放置伪造过期文件被清）；④ Mac 拉取一次 rc=0、哈希对账一致；
⑤ 定时器 `systemctl list-timers` 在位、下次触发时间合理。

## required_evidence

安装粘贴稿全文、服务器侧执行输出（①②③⑤）、Mac 侧 pull.log 尾部与哈希
对账（④）、governance-ops 记录。
