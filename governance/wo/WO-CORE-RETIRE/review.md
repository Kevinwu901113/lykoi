# WO-CORE-RETIRE · 复核与关单记录（治理侧）

> 关单：2026-09-01。执行形态 = root 粘贴稿（Kevin 手跑），四跑收敛。
> **结论：PASS 关单。** 冷启核验按 v4 定案顺延，已由落地稿 B 步 6 兑现
> （assembly up，起立后 journal 报错计数 0）。

## 四跑实录（v1→v4，每跑修法都已入稿头修订注与 HANDOFF 教训 50/51）

1. **首跑（v1）**：步 1–2 成——lykoi crontab 存档整表退役（两行：notify_push
   每分钟轮询 + offsite_backup 每日 04:17）。步 3 中止：旧单元文件实住
   /etc/systemd/system（真文件），mask 撞真文件被拒。
2. **二跑（v2）**：步 3–6 成——12 个旧单元（核心 7 + 浏览器栈 5）disable→
   单元文件归档 $RARCH/units/→mask 占名；browser-profile 封存；控制器归档
   19 件；旧仓封存。步 7 中止：旧 audit.jsonl 带 chattr append-only，root
   rename 亦 EPERM。
3. **三跑（v3）**：步 7–8 成——state 白名单归档完毕（累计 22 项 = 二跑前
   16 + 三跑 6），canonical 面一个未动（落地后目录清单逐项属 GK-6 表 +
   新体活面）；僵尸写者 135 秒窗核验确死。步 9 中止：冷启被门检查项④拦
   ——旧仓封存使 PROTECTED_PATHS 旧 guardian base 解析失败，SK-74
   fail-closed 全封锁（**门按设计履职**；代码侧配套 = WO-GUARD-RETIRE）。
4. **四跑（v4）**：幂等全绿收尾，步 9 按 v4 定案顺延（COLDSTART=
   deferred-to-landing-b 入记账），步 10 记账完成。

## 关单核验（治理侧独立读数，落地稿 B 后）

- 服务 active；起立后 journal error/fail/refus 计数 **0**。
- `/usr/local/sbin` 仅剩 `lykoi-cordis-watchdog.sh`（新体探针，未被误收）。
- 归档区：`/home/lykoi/archive/old-body-20260901`（root:root 700：
  browser-profile / crontab 正本 / projects-lykoi / projects-lykoi-ui /
  state 22 项）+ `/root/archive-old-body-20260901`（units 12 件 + sbin
  19 件）。回滚 = mv 回原位。
- **控制器计数一笔账**：实收 19 = lykoi-core-v1-* **16** 件 +
  deepseek-v4-compat-apply + lykoi-gate-readout + lykoi-admin。旧账
  「17 个 apply 控制器」系计数误差（glob 全量移动，原位已零残留，
  以实物 19 为准；与 SPEC-CONV「9 项」误差同类）。
- 僵尸 notify_push 轮询器：根因即 lykoi crontab 首行，crontab -r 后
  135 秒窗未重现，确死。
- offsite_backup（crontab 第二行）随整表退役停转——**新体无异地备份**，
  缺口已记观察周后跟单事项。

## 定序兑现

D-SC-3（退役先于落地 B）由落地稿 B 步 0 硬闸强制执行，实跑顺序正确：
retire v4 全绿 → landing B 全绿。分叉游标 telegram_outbox.cursor 已由
落地稿 B 归档至 $ARCH/state/telegram_outbox.cursor.var-state-fork，
var/state 调和为 canonical 软链（lykoi 属主，检查项⑧自此看住）。
