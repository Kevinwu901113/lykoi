# 生产只读前检（Kevin）

本段只读，不停服务、不签署、不改权限。输出只需HEAD/状态/数字，不包含消息、persona、凭证。任一步报错时保留输出并停止该步，不用旧值填空。

```bash
cd /home/lykoi/projects/lykoi-cordis
git rev-parse HEAD
git status --porcelain
systemctl show lykoi-cordis.service -p ActiveState -p SubState -p NRestarts -p MainPID
systemctl is-active lykoi-cordis-watchdog.timer lykoi-cordis-backup.timer
sqlite3 -readonly /home/lykoi/state/memory.db 'SELECT max(version) FROM mind_schema; PRAGMA journal_mode;'
sqlite3 -readonly /home/lykoi/state/memory.db 'SELECT state,terminal_reason,count(*) FROM pending_continuations GROUP BY 1,2;'
stat -c '%n %U:%G %a' /home/lykoi/runtime/persona /home/lykoi/runtime/persona/lykoi_base.toml
for file in seeds.toml deploy.toml; do
  if test -e "/home/lykoi/runtime/persona/$file"; then
    stat -c '%n %U:%G %a' "/home/lykoi/runtime/persona/$file"
  else
    echo "$file absent"
  fi
done
if test -e /home/lykoi/state/inbound-spool.db; then
  sqlite3 -readonly /home/lykoi/state/inbound-spool.db 'PRAGMA user_version;'
else
  echo 'inbound-spool absent'
fi
```

预期：服务active/running、NRestarts稳定、mind_schema18；journal_mode现值作为事实记录，任何值不自动授权切WAL。首次部署A2时独立spool可不存在，不要手工在认知库迁移spool。实例目录/文件属主权限应与gate要求一致；deploy缺失时需将真实Telegram代理在服务器本地写入[telegram].proxy，不把值贴回任务。

下一阶段必须先记录旧HEAD与单元原状态，停watchdog/备份timer/认知进程并证实单写者停稳，完整备份state与实例文件，再切获批提交、安装依赖、修复新root域源文件权限、重签并验证gate。验收前不自动恢复watchdog，以免重启循环掩盖错误。这里没有提供可直接执行的写入步骤，因为生产当前HEAD/文件状态尚未回传。
