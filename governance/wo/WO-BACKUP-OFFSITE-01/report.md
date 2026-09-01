# WO-BACKUP-OFFSITE-01 · 收单记录（2026-09-01，治理侧主笔自执行单）

执行形态：治理侧写安装粘贴稿，Kevin root 执行，治理侧独立验证每一环。

## 经过（含 v1 翻车，如实记）

1. **v1 首跑（20:20）假绿**：产物 20KB，`tar -tvzf` 开包证实**不含
   memory.db/salience_shadow.db**。双缺陷均在治理侧脚本：
   - `--exclude='./memory.db'` 为 GNU tar 全局模式，波及第二棵 `-C` 树，
     把暂存区快照一并排掉（原库按设计排除、快照被误伤，两头落空）；
   - 安装稿验证段 `N_DB=$(…|grep -c…)` 计数 0 时 grep 退出码 1 被
     `set -e` 在命令替换处击杀，FAIL 行未达——Kevin 只见 sha 对账 OK，
     误读为完成。v1 首跑输出（Kevin 事后回贴）证实：建符号链接、
     sha OK 后静默断头，与推断死法逐行吻合。
   - 另：v1 投放时忘 `chmod +x`（Kevin 首次执行 Permission denied）。
2. **v2（sha `914f49d5…` 两侧对账）修法**：两步 tar（先建 state 包带
   exclude，再无 exclude 追加 `snap/` 快照）；包内容自检（两库计数
   ==1 + 元数据在位）下沉进每日脚本，装完不等于装对；安装稿全部
   grep 计数后置 `|| true`；产物字节数下限闸（<1MB 即 v1 症状复现判 FAIL）。
3. **v2 首跑（20:30）ALL GREEN**：产物 3,447,919 字节，服务器侧
   sha256 自检 OK，timer 排定明晨 01:30（Persistent=true）。

## 端到端验证（治理侧独立，全绿）

| 环 | 证据 |
|---|---|
| 服务器产物 | 3.4MB，首跑 service exit 0，timer NEXT=09-02 01:30 |
| Mac 拉取腿 | `pull_server_backups.sh` rc=0（09-01 18:02 的 rc=23 消失），产物落 `~/lykoi/backups/server-state/` |
| 哈希对账 | Mac 侧 `shasum -c` 对服务器所写 .sha256 = OK |
| 内容 | `./memory.db`、`./salience_shadow.db`、`./deployment-meta.txt` 三者在包 |
| 装配指纹 | `repo_head=acb814f`（与生产钉位 m4-switch=acb814f 互证）、persona sha256 已录、旧体单元全 masked / lykoi-cordis.service + backup timer enabled |
| **可恢复性** | Mac 侧解包两库 `PRAGMA integrity_check` 均 ok；memory.db 读出 6443 条 experiences |

## forbidden 核对

备份不含 secrets（deployment-meta 仅 head/hash/单元表）；未重启任何
lykoi 服务（仅新增 oneshot 单元）；Mac 拉取脚本零改动（产物路径按单
落回 `state/backups/`）。

## 结论

**关单**。新体异地备份链恢复：服务器每日 01:30 快照打包 → Mac 拉取。
遗留观察项：明晨定时首跑后核对一次 NEXT/LAST 与新产物日期（09-02）。

## 教训（入库）

- 命令替换内的 `grep -c` 在 `set -e` 下是静默死亡点，必须 `|| true`；
  "显式 if/exit 纪律"覆盖不到命令替换里的失败，此为纪律盲区补丁。
- GNU tar `--exclude` 对全部 `-C` 树生效；多树打包需分步 tar。
- 验证要下沉进日常路径（每日自检），装机时查一次不算数。
- 备份验收的金标准是**恢复演练**，不是文件存在性。
