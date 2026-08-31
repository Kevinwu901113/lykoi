# 活体 memory.db 迁移执行程序（v9 → v10）· 待 Kevin 执行

- **为什么需要 Kevin**：需 `systemctl stop/start lykoi-autonomy`，治理账户的 sudo 是只读的
  （没有 restart 权限——这是设计使然）。
- **风险评估（低）**：
  - 迁移已在**真实备份副本**上完整验证（7 表、回填 6860 行逐表精确、幂等、逆迁移可回 v9、
    integrity ok / 0 FK 违规）——见 `wo/WO-P2-01/review.md`；
  - **新表目前无任何代码读取**（integrator 晋升作业、delegation、messenger 都还没建），
    迁移对她的行为是**惰性的**：只增表 + 回填标注，不改任何现有表与触发器；
  - 逆迁移 `downgrade_v10()` 已验证；备份体系 13 项齐备。
- **预计耗时**：迁移本身 <10 秒（Mac 上 6860 行回填是毫秒级）；停机窗口留 5 分钟足够，
  设计文档写的 10–30 分钟是保守值。

---

## 执行步骤

### 0. 先做一次新鲜备份（以 lykoi 身份，不需要 root）

```bash
ssh lapw1ng.com '/home/lykoi/projects/lykoi/scripts/offsite_backup.sh 2>&1 | tail -5'
```

### 1. 停 autonomy（root）

```bash
systemctl stop lykoi-autonomy && systemctl is-active lykoi-autonomy
```

### 2. 执行迁移（root 会话里以 lykoi 身份跑，避免产生 root 属主的 WAL 文件）

```bash
sudo -u lykoi /home/lykoi/projects/lykoi/.venv/bin/python -c "
import sqlite3
from lykoi.mind import migrations
c = sqlite3.connect('/home/lykoi/state/memory.db', isolation_level=None)
c.execute('PRAGMA foreign_keys=ON')
print('before version =', migrations.applied_version(c))
n = migrations.apply_migrations(c)
print('applied =', n, '| after version =', migrations.applied_version(c))
print('memory_scopes rows =', c.execute('select count(*) from memory_scopes').fetchone()[0])
print('users =', c.execute('select id,role from users').fetchall())
print('integrity =', c.execute('PRAGMA integrity_check').fetchone()[0])
print('fk violations =', len(c.execute('PRAGMA foreign_key_check').fetchall()))
c.close()
"
```

**期望输出**：`before version = 9` → `applied = 1 | after version = 10`；
`memory_scopes rows` 约 6900±（活体比昨天的备份新，行数会略多于 6860）；
`users = [('user_001', 'owner_primary')]`；`integrity = ok`；`fk violations = 0`。

### 3. 起 autonomy（root）

```bash
systemctl start lykoi-autonomy && sleep 5 && systemctl is-active lykoi-autonomy && systemctl show lykoi-autonomy -p NRestarts --value
```

### 4. 交回给我

告诉我第 2 步的输出，我做完整验证（四服务 / /health / 审计链连续性 / 数据抽查）并归档。

---

## 回滚（如果第 2 步报错或数字不对）

```bash
sudo -u lykoi /home/lykoi/projects/lykoi/.venv/bin/python -c "
import sqlite3
from lykoi.mind import migrations
c = sqlite3.connect('/home/lykoi/state/memory.db', isolation_level=None)
migrations.downgrade_v10(c)
print('rolled back to version =', migrations.applied_version(c))
c.close()
"
```

然后照常 `systemctl start lykoi-autonomy`。若数据库本身受损（极不可能），
从第 0 步的新鲜备份按 `reports/runbook_disaster_recovery.md` §2 第 1 项还原。
