# M4 W3 · Kevin 操作稿(三样,精确到命令)

- **写于**:2026-08-31,云端执行会话(据 `runbook.md` / `paste-1-prepare.sh` /
  `paste-2-switch.sh` / `approval-briefing.md` 四件正本推导,零新决策)。
- **本稿写作时点的钉点核验**(云端对 origin 只读取证):
  - `origin/m4-switch` = `ebaeda839dc17d5db919f9a5e6ce4ec49240fcb2`,与 runbook 钉点一致;
  - main 已比钉点基座 `27f4682a` 前进 49 个提交,但对
    `packages/ profile/ package.json package-lock.json tsconfig.json` 的 diff 为**零**
    (全是 governance/docs)——按 runbook §2 的条件,**免重钉,粘贴稿两处 sha 照用**。
  - 上窗前请在 Mac 用下面第 1 样的核对三连再确认一次(防本稿写作后 main 又动了代码)。

## 事前 5 分钟(不算三样,但是硬前置)

过目 `governance/wo/WO-M4-W2/approval-briefing.md`(A 7 条 + B 9 条)。
**否决窗口 = 切换窗前;跑 paste-2 即视为全部批准生效。** 哪条不同意,窗前说。

---

## 第 1 样 · Mac:打 bundle + scp + 填 BUNDLE_SHA(窗前任意时刻,约 5 分钟)

```bash
cd ~/Documents/lykoi/lykoi-cordis
git status -sb                    # 工作树应干净;不干净先收拾,别带脏树打包
git fetch origin
git checkout main
git merge --ff-only origin/main
git branch -f m4-switch origin/m4-switch
```

核对三连(**任一不过 → 停,回治理线,不要带旧 sha 上窗**):

```bash
git rev-parse m4-switch
# 必须 = ebaeda839dc17d5db919f9a5e6ce4ec49240fcb2

git merge-base --is-ancestor 27f4682a94dd04f0fd6ae29c9e859931e031eba3 main && echo BASE-OK
# 必须打印 BASE-OK

git diff --stat 27f4682a94dd04f0fd6ae29c9e859931e031eba3 origin/main \
  -- packages profile package.json package-lock.json tsconfig.json
# 必须零输出(= main 前进的全是文档,免重钉);有输出 = 需重钉(runbook §2),停
```

打包、传输、填 sha、连粘贴稿一起送上服务器:

```bash
git bundle create /tmp/lykoi-cordis.bundle main m4-switch
scp /tmp/lykoi-cordis.bundle lykoi-gov:/tmp/lykoi-cordis.bundle

SHA=$(shasum -a 256 /tmp/lykoi-cordis.bundle | awk '{print $1}')
sed "s|<Kevin 填：Mac 上 shasum -a 256 的输出>|$SHA|" \
  governance/wo/WO-M4-W2/paste-1-prepare.sh > /tmp/paste-1-ready.sh
grep -n '^BUNDLE_SHA=' /tmp/paste-1-ready.sh
# 眼验:引号内应是 64 位十六进制,不含文件名、不含尖括号

scp /tmp/paste-1-ready.sh                          lykoi-gov:/tmp/paste-1-ready.sh
scp governance/wo/WO-M4-W2/paste-2-switch.sh       lykoi-gov:/tmp/paste-2-switch.sh
```

---

## 第 2 样 · 服务器 root:跑 paste-1 + 填 token(窗前任意时刻,不触旧体)

root 会话里:

```bash
bash /tmp/paste-1-ready.sh
```

幂等,断了整稿重跑。走完必须**亲眼见过**这三行,缺一不算过:

| 段 | 期望输出 |
|---|---|
| §2 树落地 | `TREE PINNED OK` |
| §9 门验(lykoi 身份) | `gate: OK` |
| 末行 | `== 粘贴稿 1 完成:新体已备而未启。切换窗跑粘贴稿 2。 ==` |

已知无碍形态:§2 clone 若警告 empty working tree(bundle 无 HEAD ref,教训 17),
随后的 `checkout --detach` 会把树填上,见到 `TREE PINNED OK` 即无碍。

然后填 token(paste-1 §6 已建好 root:root 600 的空文件;**值只经你的手**):

```bash
vi /home/lykoi/secrets/telegram-cordis.env
# 只写一行:LYKOI_TELEGRAM_BOT_TOKEN=<真值>
# (非 root 会话则按 runbook 用 sudoedit,等价)

grep -cE '^LYKOI_TELEGRAM_BOT_TOKEN=.+' /home/lykoi/secrets/telegram-cordis.env
# 应输出 1
ls -l /home/lykoi/secrets/telegram-cordis.env
# 应 -rw------- 1 root root
grep -cE '^DEEPSEEK_API_KEY=' /home/lykoi/secrets/llm.env
# 应输出 1;若 0(2026-08-31 实测即为 0):同文件里已有旧体在用的
# LYKOI_DEEPSEEK_API_KEY=<值> 一行(llm_router.py:68)——那行别动别删(旧体
# 与回滚锚在用),在文件末尾新增一行,值照抄旧行等号后内容:
#   DEEPSEEK_API_KEY=<同一个值>
# (新体读 vendor 缺省名,出处 packages/lykoi-llm-deepseek/vendor/index.js:1626;
#  行首无空格、值不加引号。)补完复验:本条 grep 应 1,且
#  grep -cE '^LYKOI_DEEPSEEK_API_KEY=' 仍应 1。
```

---

## 第 3 样 · 切换窗:跑 paste-2 + E 步实弹(停机 15–30 分钟 + 实弹时间)

开窗自检,四个 yes 才动手:①paste-1 见过 `gate: OK`;②token 行数=1;
③呈批稿过目无否决;④手机在手(E 步要用)。

```bash
bash /tmp/paste-2-switch.sh
```

逐段期望与岔路:

| 段 | 期望 | 不符时 |
|---|---|---|
| §0 前验 | token 行数 1;旧体五 unit 全 active(信息性) | 行数 0 → 回第 2 样补 token |
| §1 停旧 | watchdog 最先停;`旧体进程已清` | 报「进程未清」→ 等退净或 `systemctl kill`,重跑整稿 |
| §2 备份 | `/home/lykoi/m4-backup-<TS>.tar.gz` 出现 | **记下这个文件名,回滚要用** |
| §3 GK-9 | dry-run 无异常 → 实跑 | dry-run 报错 → 停,别实跑,走回滚前半(起旧) |
| §4 门验 | 第二次 `gate: OK` | 不过 → 回滚 |
| §5 起新 | status `active (running)`;journal 25 行无 crash 循环 | crash 循环 → 回滚 |
| §6 | 打印验收八条 | 逐条做,见下 |

### E 步实弹四条链(手机 Telegram,对应验收 [3]–[6])

1. **普通消息**:发一句平常话 → 她回。服务器核:
   `grep -c action_dispatch /var/log/lykoi-audit/audit.jsonl`(计数应在涨)。
2. **批准链**:让她做一件要跑终端的事 → 她发审批问句 → **引用回复**批准
   → 收到执行回执。
3. **拒绝链**:再来一条终端类请求 → 问句 → 引用回复拒绝 → 她收手并如实说。
4. **unclear 链**:再来一条 → 问句 → 引用回复答非所问(如「呃我想想」)
   → 她按 unclear 处理:不执行,可追问。

### 验收 [7][8]

```bash
systemctl restart lykoi-cordis
```
→ 手机上问她是否知道自己刚重启过(带 HEAD/downtime 更好;采不到=省略,不许编值)。
[8] GK-14:链 2 的回执与 audit 里的 `action_dispatch` 行对得上即过。

### 任一不过 → 回滚

`paste-2-switch.sh` 文末 ROLLBACK 段(`: <<'ROLLBACK'` 与 `ROLLBACK` 之间)整段
复制出来跑;其中 `tar -xzf /home/lykoi/m4-backup-*.tar.gz` 一行,**指名 §2 记下的
那份最新备份**。回滚零删除:state 现场 `mv` 保全,新体 unit 留盘 disabled,事后复盘。

---

## 窗后

- 八条全过 = 进入 **48h 观察期**:旧体保持可启动(什么都不删),
  `lykoi-cordis-watchdog.timer` 在岗。
- display 栈(chrome/xvfb/fluxbox/vnc/novnc)**刻意没停**——封存待 M5 退役审批,别顺手动。
- 48h 后:CORE-RETIRE 收尾窗**另呈批**,不在本稿范围。
