# LANDING-H · WO-M5-ORGAN-BROWSER 落地记录

- 执行：Kevin（root），2026-09-03 00:09（v1，§6 FATAL）与 00:21（v2，完成），服务器 CST。
- 治理侧：主治理 Agent。脚本 `wo/WO-M5-ORGAN-BROWSER/landing-h-m5-browser.sh`（v2，sha256 600485a3…39b6）；bundle sha256 d918b215…82300。
- 产线：main@481e6d2 → **main@482d644**（合并提交，代码树 = 分支 tip 0006e75）。

## 回执

| 项 | 读数 |
|---|---|
| 前验 | bundle/persona sha OK；HEAD 481e6d2；schema 17；状态行 17；autonomy_runs 2561；Chrome 148.0.7778.96 |
| 出网闸探针 | 带 Deny rc=28（超时=SYN 被丢），无 Deny rc=0 → 本机 cgroup BPF 过滤生效 |
| 供给 | lykoi-browser uid 996 / gid 988；lykoi 入组 |
| 沙箱探针 | 以 lykoi-browser + no_new_privs 起 Chrome 出 DOM：OK |
| 停机 | `systemctl stop`，enabled 保持 |
| 备份 | `/root/backup-pre-m5browser-20260903T002123.tar.gz` 10,386,114 B，sha256 1a01c3bc…4626（v1 那份 T000913 同 sha） |
| 树 | 钉 482d644 干净；npm ci（Node 24）+43 包；playwright-core 1.60.0 |
| manifest | 113 条；gate OK |
| 宿主 | unit enabled+active；IPAddressAllow=127.0.0.1/32 127.0.0.53/32；Deny 22 段全在；NoNewPrivileges=yes；socket `srw-rw---- lykoi-browser lykoi-browser`；health alive pid 582352 |
| 大脑 | assembly up；watchdog/备份 timer 回位；审计 `browser_organ_wired` 三动作 |
| deploy_event | head 482d644，**downtime "12 分钟"** —— G 修的重启线索首次给出非空 downtime（`stop` 形态实证） |
| NRestarts | 0 |
| smoke（服务器 Chrome 148） | 1/1 pass，6.8 s；含 R-2 倒挂断言 → Chrome 148 同样不为 302 hop 回调 |
| 10b 302 → 私网 | `{"ok":false,"error":"timeout"}`（见下） |
| budget | 09-02 370,482 tokens |

## v1 → v2

v1 在 §6 `npm ci` 后 FATAL「树不净」：`packages/lykoi-memory/src/init-state.ts` 盘上 755、索引 644，内容零差异，mtime 2026-09-02 20:24（G 落地时已如此）；此前 `git status` 因 stat 缓存命中一直报干净，chown 刷新缓存后才暴露。同时 `sudo -u lykoi npm` 的 shebang 落到 /usr/bin/node（系统 Node 18）。v2：npm 显式 Node 24 PATH 并断言；属主重整后按钉点 `git checkout -f -- .` 恢复模式，仍不净才 FATAL。两次跑之间产线停机，deploy_event 记 12 分钟。

## 10b 的解读（待补两条探针）

预期写的是 `navigation_failed`（内核拒连），实得 `timeout`。systemd 的 `IPAddressDeny=` 是 cgroup skb 过滤，**丢包而非拒绝**：connect() 不返回 EPERM，SYN 被丢到超时 —— §1 探针 curl rc=28 就是同一签名。所以 `timeout` 与「出网闸拦住了」一致，但单凭这一条分不清「httpbin 慢」与「302 目标被丢」。补两条：直连 `https://httpbin.org/get` 应 ok:true（证 DNS 与出网在 unit 内可用），再跑一次 302 探针应仍 timeout。docs §4.1 / §2 的预期措辞要按「timeout = 丢包签名」改。

## 遗留

- docs §4.1、§2 前验二与 review §6 的「navigation_failed」预期改为 timeout（文档 commit，不落地）。
- 第 13 项备份（profile）手工项；root 定时器另立。
- init-state.ts 模式漂移根因未查（G 时谁把它 chmod 成 755）：下次落地前看 `git ls-files -s` 与盘上模式。
- 次日读数：`browser_action` 计数与 status 分布、`capability_gap{not_wired}` 是否不再含三项。
