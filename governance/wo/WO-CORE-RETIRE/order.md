# WO-CORE-RETIRE · 旧体退役（归档封存，零删除）

> 签发：2026-09-01（治理侧，WAVE-OBS-PREP 第二单；Kevin 口头批准「旧体清理」）。
> 执行形态：**纯服务器粘贴稿**（root 一次粘贴，无代码改动）；本单材料 =
> 本 order + `paste-retire.sh` + 粘贴输出（= report）。
> 原定名 CORE-RETIRE 收尾窗（M4 计划「窗后 48h 观察 → CORE-RETIRE 另呈批」），
> Kevin 2026-09-01 提前批准，且定序**先于** WO-STATE-CANON 落地（D-SC-3）。

## 背景（2026-09-01 治理侧实勘，全部只读证据）

M4 切换后旧体残存四类：

1. **无主浏览器栈仍 active**：lykoi-chrome / xvfb / fluxbox / vnc / novnc
   五服务（00:49 起立，驱动它们的旧自主循环已死）。M5 browser 章程已定案
   「旧 browser-profile 封存不迁移，她自己账号重新登录」。
2. **僵尸通知轮询器**：某 lykoi 定时任务以精确 2 分钟节律（:01 对齐）写
   `~/state/notify_push.cursor`（02:04/02:06/02:08 实测）；用户级 systemd
   单元不存在 → 指向 lykoi crontab（治理账号无权读，root 核）。危害链：
   WO-STATE-CANON 落地后新体重写 canonical `notifications.json`，僵尸会把
   她的新通知推去旧通道——违 GK-8（通知推送维持关）。**必须先退役**。
3. **旧核心五单元** disabled 未 mask（core/server/autonomy/watchdog/telegram）
   + 已撤销的 lykoi-gate-readout service/timer；17 个 M2→R3a apply 控制器
   与 lykoi-admin 仍在 /usr/local/sbin(bin)。
4. **~/state 新旧混居**：GK-6 canonical 表内文件 = 她的活身份（**一个不动**）；
   表外旧体遗物（core_facts.db 7MB、events.jsonl 10MB、watchdog.jsonl、
   continuations、messenger_inbound、旧 memory.db.pre_* 快照、percept_buffer、
   permission_evidence_shadow、下划线 restart_marker/telegram_cursor 等）
   逐文件核对过新体代码面零引用。

## 治理定案

- **D-RET-1 归档不删除**：一切遗物 mv 进封存区（`/home/lykoi/archive/
  old-body-20260901/` + root 域 `/root/archive-old-body-20260901/`），顶层
  root:root 700 封印。回滚 = mv 回来。**全稿零 rm**（唯一例外：crontab -r，
  且删除前全文存档）。
- **D-RET-2 单元一律 mask**：旧体单元（含浏览器栈五件）disable + mask，
  「不可误启」优先于「便于重启」；M5 重建时显式 unmask 或另立新单元。
- **D-RET-3 state 只出不进**：canonical 表内文件与 memory.db / budget /
  heart-state / restart-marker（连字符）/salience_shadow.db* 绝对不动；
  归档走显式白名单逐文件 mv，无任何通配移动（唯一字面量例外：名为
  `*.sqlite3` 的垃圾文件，引号护住按字面处理）。
- **D-RET-4 lykoi crontab 整表退役**：新体零 cron（watchdog 是 root systemd
  timer），lykoi 名下任何 cron 条目皆旧体机件；全文存档后 `crontab -r`。
  root crontab 与 /etc/cron* 只取证不动，如有 lykoi 相关行打印待治理跟单。

## 判据（= paste-retire.sh 步骤，断言全部显式 if/exit）

① 前验：root 身份；新体 active；封存区就位。
② crontab：存档 → 取证打印 → `crontab -r -u lykoi`；记录 t0 与
   notify_push.cursor mtime，稿末（间隔 >130s）复核 mtime 冻结，未冻结 FATAL。
③ 旧单元 mask：core/server/autonomy/watchdog/telegram + gate-readout ×2。
④ 浏览器栈：停（chrome 先停）→ disable → mask 五件；browser-profile 整目录
   封存（M5 章程）。
⑤ 控制器归档：`lykoi-core-v1-*`、`lykoi-deepseek-v4-compat-apply`、
   `lykoi-gate-readout`、`lykoi-admin` → root 封存区；`lykoi-cordis-watchdog.sh`
   保留。
⑥ 旧仓库封存：`~/projects/lykoi`、`~/projects/lykoi-ui`（Mac 侧有
  2026-08-31 全量 bundle 兜底）。
⑦ state 外科归档：白名单 27 项（见粘贴稿 OLD_STATE 数组）逐文件 mv；
   完毕打印剩余清单对照 keep 白名单，意外项 WARN 记录不 FATAL。
⑧ 收尾：新体 restart 冷启核验（active + assembly up 硬断言）+ journal 读数
   + 封存区清单存档 + governance-ops.jsonl 记账（root 追加）。

## forbidden

- 不碰 `/home/lykoi/secrets/`（永不读不动）。
- 不碰 canonical 表内任何文件与 memory.db（含 -wal/-shm）、budget.json、
  heart-state.json、restart-marker.json、salience_shadow.db*、
  telegram-cursor.json / telegram-inbound.json（连字符，新体面）。
- 不碰 `/home/lykoi/projects/lykoi-cordis`（新体树属 WO-STATE-CANON 落地稿管）。
- 不删除任何文件（D-RET-1；crontab -r 除外，先存档）。
- 不动 root crontab 与 /etc/cron*。

## required_evidence

粘贴输出全文（= 本单 report）：crontab 存档内容、mtime 冻结核验、
mask/停用清单、state 归档前后清单、新体冷启读数。
