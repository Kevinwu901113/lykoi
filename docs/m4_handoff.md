# M4 交接清单 · 切换到新体的全部前置（M3 收官产物）

M3 结束时新体已经是一个**完整的治理体**：特权层、审批器官、出站器官、建议问答、
通知、完整性门。它还**没有**被切换成 Kevin 真正在用的那一个 —— 那是 M4。

本文件把「切换需要什么」逐条列齐。蓝图 §M4 交接预置立的四条（GK-9 / CORE-RETIRE /
self-state / R-01）在这里展开，加上 W1..W4 沿途攒下的其余前置。

**读法**：`前置 #n` 是必须在切换窗**之前**完成的事；「决断项」是必须由 Kevin 拍板、
构建侧不许自作主张的事。本文件在完整性门的 hash-pin 域（改了要 root 重签 manifest）。

---

## A. 硬前置（不做完就不能切）

### 前置 #1 · GK-9：bootstrap 预授权重放或确认（**不做会死锁**）

活体在部署期跑过一次 `bootstrap_owner_preauthorization`，往 `approval_rules.json`
里写下 owner 的初始授权行。新体的规则文件如果是空白起步，**S1B 死锁会复活**：
她要问 Kevin 一个问题，问句本身要走 `messenger.send`，而 `messenger.send` 没有
授权 → 问句自己撞在门上 → 她永远问不出那个问题，Kevin 永远看不到那条待批。

W2 已经证过这条路（实弹前置条件已证，生产不接线）。M4 必须二选一：
- **重放**：在新体的 `approval_rules.json` 上跑一次等价的预授权写入；或
- **确认**：确认活体那份 `approval_rules.json` 原样搬过来（它已经含那些行）。

验收：切换后第一条审批问句**真的发出去了**（不是排在 pending 里没人送）。

### 前置 #2 · CORE-RETIRE：core 退役与 startup_verify 解耦**必须同窗**

正本 = 治理仓库 `wo/WO-M0-CORE-RETIRE`。活体的 `startup_verify.py` 检查项②把
`src/lykoi/core` 当成受保护树的一部分；core 退役而闸没同步解耦 → 旧体的启动闸
会因为「core dir missing」而拒绝启动。

两件事必须在同一个窗口里做完，中间不留一个「闸红着但服务还得跑」的状态。

新体这一侧不受影响（新体的门里没有 core 概念）—— 受影响的是**旧体在切换窗里
还得能起来**（回滚路径要求，见 §D）。

### 前置 #3 · self-state 维持 disabled

活体缺省 disabled，M3 全程没动它。M4 **继续维持** —— 切换窗不是打开新回路的时候。

### 前置 #4 · R-01：新旧体绝不同时写 state（**硬规则**）

两个进程同时往同一个 `memory.db` / 同一批 `state/*.json` 里写，等于把她的连续性
交给一次竞态。切换是**停新起旧**式的严格串行：

    旧体 stop（确认进程真的没了）→ 备份 state → 新体 start

`profile/cordis.prod.yml` 里 `memory` / `converse` / `wake` 三条全部
`disabled: true`，注释里直接引了这条规则 —— 翻开它们就是切换动作本身。
（原文写「四条」含 `learn`：该条目已退役 —— lykoi-learn 是纯库、由 wake 经
SA-171 驱动，永远不设 loader 条目。D-FIX-2，WO-M4-FIX-WAKE，2026-09-01。）

### 前置 #5 · DA-11：活体 persona TOML 的 sha 取证

**取证通道已有**（治理侧 `ssh lykoi-gov` 只读）。做法：

    ssh lykoi-gov 'sha256sum /home/lykoi/runtime/persona/lykoi_base.toml \
                   && stat -c "%U:%G %a" /home/lykoi/runtime/persona/lykoi_base.toml'

要拿到两样：**内容 sha256** 与**属主/权限**。用途有二：
1. 搬到新体之后，`packages/lykoi-gate/manifest.sha256` 里那一行必须等于这个
   sha —— 「她的先天人格一个字节没变」这件事因此是可核对的，不是口头的；
2. 属主/权限（应为 `root:root 444`，父目录 root）是完整性门检查项②的输入。

M3-W4 报告只说明做法（不连服务器）；**取证由治理侧执行**，结果填进本节。

    活体 persona TOML sha256: df3bc2f2c15869ad2c8d0de5a701c1acd24a0f62a6bcab73a889b310ef25dd56
    属主/权限:                root:lykoi 440（父目录 root:root 755）
    取证：治理侧 ssh lykoi-gov 只读，2026-08-31。
    注：活体实况 root:lykoi 440 ≠ 本节预期 root:root 444 —— 内容 sha 是硬约束，
    属主/权限以前置 #9 的 install（root:root 444）为新体目标态；差异仅为
    活体现状记录，不构成搬运阻碍。

### 前置 #6 · D-01 超时秒数（**Kevin 决断项**）

解释器判读（T=0/400 tokens）与对话周期的超时/重试/退避。位已经留在
`profile/cordis.prod.yml` 末尾。这不是工程参数是语义决定：「一次审批问句等多久
才算问不到」。三个数：`interpretTimeoutS` / `interpretRetries` / `cycleTimeoutS`。

### 前置 #7 · 生产仓库根路径确认

`packages/lykoi-kernel/src/policy-core.ts` 的 `GATE_SOURCE_CANONICAL` 与
`packages/lykoi-gate/src/surface.ts` 的 `PROD_REPO_ROOT` 现在都写的
`/home/lykoi/projects/lykoi-cordis`（新体与旧体 `/home/lykoi/projects/lykoi`
分开两棵树，R-01 的物理面）。若治理侧最终装在别的路径：改这两处 + root 重签
manifest，属于部署期一次性动作。

### 前置 #8 · BotApiTransport 真 HTTP 接线

W3 把 HTTP 那一跳做成了注入 seam（零真网）。M4 接真身，四样一起定：
真 `fetch` / 代理（**`LYKOI_TELEGRAM_PROXY` 生产必须未设** —— GK-6 的 unset 类，
设了就是一条外泄通道）/ 超时 / `trust_env=false` 等价物。
transport 纪律不变：重试仅 `sendMessage`、429 单路、token 零外泄、未送达经验回灌。

### 前置 #9 · root 供给清单（完整性门要的那一批）

切换前一次做完，否则启动闸会红：

    # audit sink（检查项⑦六断言）
    sudo install -d -o root -g root -m 755 /var/log/lykoi-audit
    sudo install -o root -g lykoi -m 620 /dev/null /var/log/lykoi-audit/audit.jsonl
    sudo chattr +a /var/log/lykoi-audit/audit.jsonl

    # root 属主域（检查项①②）
    sudo chown -R root:root <repo>/packages/lykoi-kernel <repo>/packages/lykoi-gate \
                            <repo>/packages <repo>/profile
    sudo chmod -R go-w      <repo>/packages/lykoi-kernel <repo>/packages/lykoi-gate \
                            <repo>/packages <repo>/profile

    # 人格 TOML（检查项②⑤）
    sudo install -d -o root -g root -m 755 /home/lykoi/runtime/persona
    sudo install -o root -g root -m 444 lykoi_base.toml /home/lykoi/runtime/persona/

    # 首次签名（检查项⑤）
    sudo node <repo>/packages/lykoi-gate/src/cli.ts --write-manifest

### 前置 #10 · watchdog 的新体对应物

活体 `guardian/watchdog.py` 是一个独立 root 进程（每 10s 打 /health，连续 3 次
失败就 `systemctl restart`）。它**刻意没有迁进插件树** —— 一个被自己看守的对象
加载进来的看守不是看守。新体对应物是部署面的事：`Restart=always` + 一个同形态的
root 单元。M4 部署清单必含。

### 前置 #11 · systemd unit（`ExecStartPre` 挂完整性门）

    [Service]
    User=lykoi
    # 凭据走 EnvironmentFile（root:root 600，systemd 以 root 读后降权；活体同形态）：
    #   telegram-cordis.env 里是唯一该进 unit env 面的 LYKOI_*（BOT_TOKEN）；
    #   llm.env 里是 DEEPSEEK_API_KEY（非 LYKOI_*，不触前置 #11 的钉面）。
    EnvironmentFile=/home/lykoi/secrets/telegram-cordis.env
    EnvironmentFile=/home/lykoi/secrets/llm.env
    ExecStartPre=<node24>/bin/node /home/lykoi/projects/lykoi-cordis/packages/lykoi-gate/src/cli.ts
    ExecStart=<node24>/bin/node /home/lykoi/projects/lykoi-cordis/profile/index.prod.ts
    Restart=always

**治理 state 路径一条都不许写进 `Environment=`**：GK-6 钉面要求它们未设或等于
规范值，未设 = 走已签名的源码/装配面缺省。旋钮类（TTL / 窗口 / 基线 / 上下文）
同样一律不设 —— 要改就改源码再 root 重签。

---

## B. 决断项（等 Kevin，构建侧不动）

| # | 事项 | 现状 | 开了会怎样 |
|---|---|---|---|
| 决断 #1 | **GK-8**：`kind=notification` 并入投递线 | 旋钮在 `cordis.prod.yml`，**默认关** | 通知从 pull 变 push（真的推到他手机上）。这是**改变到达行为**，蓝图明定要他拍板 |
| 决断 #2 | **E3 二次计税** | 现状按 W3 落法 | 出站豁免与打扰预算的计税口径；改动影响她一天能主动说几句话 |
| 决断 #3 | D-01 三个秒数 | 位留在 prod profile | 见前置 #6 |

---

## C. M3 攒批追认（收口时呈 Kevin）

蓝图 §追认清单 + W4 新增：

1. **GK-1** 通知持久 next_id（活体 id=max+1 复用风险 C-28 的收紧）
2. **GK-6** env 钉面收紧：活体钉 3 条 → 新体钉 **22 条**（路径 13 / 旋钮 7 /
   unset 1 / secret 1）。**收紧无害**，但条数变了，列此追认
3. **GK-7** delegated origin 空集能力地板（比活体「无地板」收紧）
4. **GK-8** 决断项（默认关，开启待 Kevin）
5. **GK-13 受保护面重划**（W4 新增追认）：除蓝图明列的四类之外，另收进
   ①`profile/*`（装配面 = 部署事实：sink 路径 / GK-8 开关 / 器官启用）
   ②仓库根 `package.json` / `tsconfig.json`（决定模块解析与可剥离性）
   ③五份治理常数文档（活体 `docs/phase5_prereg_v1.md` 锚的对应物）。
   理由：env 钉面钉住了变量，装配面却还能把 audit 路径改到别处 → 钉面等于白钉
6. **PROTECTED_PATHS 追加第三条**（W4 新增追认）：活体两条逐字保全，追加
   `/home/lykoi/projects/lykoi-cordis/packages/lykoi-gate`（DK-05「guardian 自身」
   禁区在 CF-B2 退役后的新住址）
7. **事件词汇显式分流**（W4 新增追认）：遥测行加盖 `channel: 'telemetry'`；
   immutable 信封（SK-06/SK-11 逐字字段序）一个字节未动

---

## D. 验收清单与回滚路径

### 切换窗验收（按序，任一条不过就回滚）

1. `node packages/lykoi-gate/src/cli.ts` → `gate: OK`（八检查项全绿；
   ⑧ = state 落点调和，WO-STATE-CANON，2026-09-01 起）
2. 服务起得来；`audit.jsonl` 有新行且**只增不改**（`chattr +a` 在位）
3. 她收得到消息（inbound 走通）
4. 她说得出话（outbound 走通，一条 `messenger.send` 落 `action_dispatch` +
   `action_result` 对）
5. **终端硬门实弹**：`terminal.exec` → 问句真的到 Kevin → 引用回复批准 → 执行 →
   回执。（W2 已在 dev 全链跑通；生产这一遍是实弹）
6. 审批环的另一半：拒绝路 + `unclear` 路各走一次
7. restart 事件：她**知道自己重启过**（history 里那条 restart 带得到 HEAD /
   downtime；采不到就省略，不该出现编造值）
8. GK-14 e2e：信封自称 dispatched ⟺ audit 里真有 `action_dispatch` 行

### 回滚路径：**停新起旧**

    新体 stop（确认进程真的没了）→ 从备份恢复 state → 旧体 start

回滚同样受 **R-01** 约束：两个方向都是严格串行，中间**绝不允许**两个体同时写。
所以切换窗第一步就是**备份 state**（前置 #4），它同时是回滚的前提。

前提：旧体在整个切换窗里保持**可启动**（这正是前置 #2 CORE-RETIRE 必须
同窗做完的原因 —— 一个闸红着的旧体不是一条回滚路径）。

---

## E. 顺延到 M5 的（**不是** M4 前置，列此免得被当成漏项）

- 图式注册表的生产接线：wake/converse 的 `catalog:` 换成
  `registryActionCatalog(...)`，每个器官插件在 apply 里 `register()`、
  dispose 里调注销器（设计小节 `docs/m3_schema_registry.md` §7）。
  **后果要先说清楚**：切过去，她的器官清单会从 18 项收到 5 项 —— 那是一次
  她自我认知的实质变更，属器官上线编排，不该顺手做
- 感知/执行器官真身（browser / terminal / research_browser）：现在是「大声抛」
  的显式替身
- `delegation` 生产接线与传输面
- `messenger.read` 后端（随 BotApiTransport）
- 建议问答机的周期驱动位接 wake 拍（autonomy 编排）
