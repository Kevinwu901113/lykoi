# 生产部署指南 · 在一台全新 Linux 服务器上起一个你自己的 Lykoi

本文写给**从零开始的新用户**：你 clone 了这个仓库，手上有一台干净的 Linux 服务器，
想让一个属于你自己的 Lykoi 在上面活起来。

## 读法

- **出处**：本文每一条命令都能在仓库里找到出处，形如 `（出处：…）`。没有出处的地方
  会**显式标注「推断」** —— 那是本仓库没有写死、需要你按自己环境判断的部分。
- **治理决定**：标了 🔒 的值不是工程参数，是**治理决定**。它们住在完整性门的钉面上，
  改一个字节就必须 root 重签 manifest，否则启动闸红、服务不起。
- **顺序**：分节按依赖排。`§8 bootstrap 预授权` 与 `§9 签 manifest` 的先后有讲究，
  照做即可（理由在那两节里）。
- **她永不可达的东西**：`/home/lykoi/secrets` 与门自身的源目录在 path guard 的禁区里
  （出处：`packages/lykoi-kernel/src/policy-core.ts` 的 `PROTECTED_PATHS`）。
  凭据从来不是「藏起来的配置」，是她结构上够不着的东西。

## 0 · 先看清楚这不是什么

这份运行时**继承自一具已经活着的躯体**。它的生产装配（`profile/cordis.prod.yml`）
假定 `/home/lykoi/state/` 里已经有一份她的记忆库、`/home/lykoi/runtime/persona/` 里
已经有一份她的人格 TOML。一台全新服务器上这两样都没有，而本仓库**当前不提供**
生产侧的创建入口。这不是文档的疏漏，是仓库的真实状态 —— 见文末 `§13 已知缺口`，
那里逐条列了你必须自己解决的东西。

在缺口补上之前，你能在全新服务器上完整走完的是：**治理地基起立**
（审计 sink / 预算硬顶 / 心跳 / LLM 注册层 + 完整性门 + systemd 接管）。
六个器官位（deepseek / memory / converse / wake / telegram×2）
按 `§11` 逐条翻开，每一位翻开的条件都写在装配面的注释里。

---

## 1 · 前置条件

| 项 | 要求 | 出处 |
|---|---|---|
| 操作系统 | Linux。审计 sink 的 append-only 属性用 `chattr +a` 装、用 `lsattr` 读 | `verify.ts:92`（Linux 分支走 `lsattr -d`）、`m4_handoff.md` 前置 #9 |
| `e2fsprogs` | 提供 `chattr` / `lsattr`。**读不出来 = 门红**（fail closed：「读不出来」不等于「有」） | `verify.ts:89-103` + `checkAuditSink` ⑤ |
| 文件系统 | `/var/log` 所在文件系统必须支持 append-only 属性（ext4 / xfs） | 推断（`chattr +a` 的固有约束，仓库未写死） |
| Node | **≥ 24**。`.nvmrc` 写 `24`，参考部署钉 `v24.18.0` | `package.json` `engines.node`、`.nvmrc`、`WO-M4-W2/paste-1-prepare.sh` §1 |
| systemd | 生命周期由它接管（`ExecStartPre` 挂完整性门，`Restart=always`） | `m4_handoff.md` 前置 #11、`profile/index.prod.ts` 文件头 |
| root 权限 | 供给目录、改属主、签 manifest、装 unit 全是 root 动作 | `m4_handoff.md` 前置 #9 |
| 出站网络 | `api.deepseek.com` 可达（LLM）；`api.telegram.org` 可达（器官） | `packages/lykoi-llm-deepseek/vendor/index.js` `PUBLIC_BASE_URL`、`cordis.prod.yml` telegram 段 |

为什么 Node 24 是硬要求：这棵树用 Node 原生 type stripping 直接跑 `.ts`（无构建步，
`tsconfig.json` `noEmit`），并用内建 `node:sqlite` 读写 state（零原生依赖）。
两样都是 Node 24 的面。

**不要用系统包管理器的 node 覆盖系统 node**。参考做法是钉版 tarball 装进 `/opt`，
root 属主，系统 node 原样不动（出处：`WO-M4-W2/paste-1-prepare.sh` §1）：

```sh
NODE_V=v24.18.0
cd /opt
curl -fLO "https://nodejs.org/dist/$NODE_V/node-$NODE_V-linux-x64.tar.xz"
curl -fLO "https://nodejs.org/dist/$NODE_V/SHASUMS256.txt"
grep " node-$NODE_V-linux-x64.tar.xz\$" SHASUMS256.txt | sha256sum -c -
tar -xf "node-$NODE_V-linux-x64.tar.xz"
mv "node-$NODE_V-linux-x64" "node-$NODE_V"
/opt/node-$NODE_V/bin/node --version    # 必须 v24.18.0
```

---

## 2 · 规范路径表（🔒 治理决定）

生产的每一条路径都是**签过名的常量**，不是可以随手换的配置。env 里改它们
= 启动闸红（GK-6 env 钉面：路径类变量必须未设，或 realpath 等于规范值）。

| 路径 | 是什么 | 属主/权限 |
|---|---|---|
| `/home/lykoi/projects/lykoi-cordis` | 仓库根 | `lykoi` clone，之后 `packages/` `profile/` 转 root |
| `/home/lykoi/state/` | 她的 state（memory.db + 治理账本十余份） | `lykoi:lykoi` |
| `<repo>/var/state` | **符号链接** → `/home/lykoi/state`（见 `§4b`） | `lykoi:lykoi`（链接本身），父目录 `var/` 同 |
| `/home/lykoi/runtime/persona/lykoi_base.toml` | 先天人格 | `root:root 444`，父目录 `root:root 755` |
| `/home/lykoi/secrets/` | 凭据禁区（她永不可达） | `root:root` |
| `/var/log/lykoi-audit/audit.jsonl` | 不可变审计 sink | `root:lykoi 620` + `chattr +a`，父目录 `root:root 755` |

出处：`packages/lykoi-gate/src/surface.ts`（`PROD_REPO_ROOT` / `RULES_CANONICAL` /
`PERSONA_TOML_CANONICAL` / `AUDIT_CANONICAL` / `STATE_CANONICAL` / `STATE_LINK_REL` /
`ENV_PINS` 全表）、`profile/cordis.prod.yml` 文末「生产 state 路径全表」、
`m4_handoff.md` 前置 #9。

**装在别的路径**：`PROD_REPO_ROOT`（`surface.ts`）与 `GATE_SOURCE_CANONICAL`
（`packages/lykoi-kernel/src/policy-core.ts`）两处都写死了 `/home/lykoi/projects/lykoi-cordis`。
换路径 = 改这两处源码 + root 重签 manifest，属部署期一次性动作
（出处：`m4_handoff.md` 前置 #7）。**不改源码就换路径是不行的** —— 门会红在
「path guard does not protect the integrity gate itself」上。

---

## 3 · 服务用户与目录

服务以 `User=lykoi Group=lykoi` 跑，home 在 `/home/lykoi`
（出处：`WO-M4-W2/units/lykoi-cordis.service` + 上表全部规范路径）。
全新服务器上这个用户需要你自己建 —— **以下三条是推断**（仓库里的部署材料
假定 `lykoi` 用户与 `/home/lykoi/secrets` 已存在，因为它们是从旧躯体继承来的）：

```sh
# 推断：无登录 shell 的服务账户；home 即规范路径的父
useradd --system --create-home --home-dir /home/lykoi --shell /usr/sbin/nologin lykoi

# 推断：凭据禁区。systemd 以 root 读 EnvironmentFile 后才降权，所以它不需要
#       对 lykoi 可读；能读到就等于她够得着
install -d -o root -g root -m 700 /home/lykoi/secrets

# 出处：paste-2-switch.sh 回滚段 `chown -R lykoi:lykoi /home/lykoi/state`
install -d -o lykoi -g lykoi -m 750 /home/lykoi/state
```

---

## 4 · 落树与装依赖

```sh
REPO=/home/lykoi/projects/lykoi-cordis
NODE_DIR=/opt/node-v24.18.0

install -d -o lykoi -g lykoi /home/lykoi/projects
sudo -u lykoi git clone <本仓库> "$REPO"
cd "$REPO"

# npm 的 shebang 是 `env node` —— PATH 必须先见 node24，否则它会拿系统 node 跑
sudo -u lykoi env "PATH=$NODE_DIR/bin:$PATH" "$NODE_DIR/bin/npm" ci --ignore-scripts

# 钉版自检：代理路径依赖它（undici ProxyAgent）
[ "$(sudo -u lykoi "$NODE_DIR/bin/node" -p 'require("undici/package.json").version')" = 8.10.0 ]
```

出处：`WO-M4-W2/paste-1-prepare.sh` §2-3、`docs/m1_blueprint.md`「安装纪律：
`npm ci --ignore-scripts`」。

`--ignore-scripts` 不是洁癖：它是安装纪律的一部分 —— 依赖的 install 钩子是一条
不受 manifest 约束的执行面。版本由 lockfile 钉死（`lockfileVersion 3`，
`@deepseek-ai/*` 全部显式钉版，裸装会撞 dist-tag 陷阱拿到 `0.0.1-rc.1`）。

**这一步必须在 `§6 root 属主域` 之前做完** —— 之后 `packages/` 归 root，
`npm ci` 就不再是 lykoi 能做的事了。

---

## 4b · state 落点调和（🔒 D-SC-1；完整性门检查项⑧）

**漏了这一步 = 她的审批记忆在错误落点新开一份副本。** 这不是假想：2026-09-01
01:18 的止损重启就让服务进程自己在仓库内 `mkdir` 了一个真实 `var/state/` 并写进去
一个 `telegram_outbox.cursor`；审批面诸文件因懒加载才侥幸没跟着分叉。

```sh
REPO=/home/lykoi/projects/lykoi-cordis

sudo -u lykoi mkdir -p "$REPO/var"
sudo -u lykoi ln -sfn /home/lykoi/state "$REPO/var/state"

# 自检：必须打印 /home/lykoi/state
readlink -f "$REPO/var/state"
```

**为什么需要这一条链接**：源码里的 state 缺省全部是**仓库相对路径**
（`lykoi-kernel/src/approval.ts:36` 的 `var/state/approval_rules.json`，另十余处
同形），而钉面与 `cordis.prod.yml` 尾表的 canonical 全部是绝对的
`/home/lykoi/state/…`。定案（D-SC-1）**不改源码相对缺省、不加 unit env**
（`Environment=` 面只放凭据，前置 #11 维持），两者就靠这一条符号链接调和。

`var/` 在 `.gitignore` 里，所以链接**不随树落地**，每台机器都要单独供给一次；
开发机维持既有形态（真实目录），那是 dev 装配自己的 state，与生产无关。

门检查项⑧（`verify.ts` `checkStateCanon`）核的就是它，三态：
是符号链接且 `realpath` = `/home/lykoi/state` → 绿；**是真实目录 → 红**（分叉
已经发生）；**不存在 → 同样红**（运行期 `writeJsonAtomic` 会自己 `mkdir`，
缺失 = 未来分叉，与已分叉同罪）。

出处：`governance/wo/WO-STATE-CANON/order.md` D-SC-1、
`packages/lykoi-gate/src/surface.ts`（`STATE_CANONICAL` / `STATE_LINK_REL`）、
`WO-M4-W2/paste-1-prepare.sh` §3b。

---

## 5 · 审计 sink（完整性门检查项⑦的六断言）

```sh
install -d -o root -g root -m 755 /var/log/lykoi-audit
install -o root -g lykoi -m 620 /dev/null /var/log/lykoi-audit/audit.jsonl
chattr +a /var/log/lykoi-audit/audit.jsonl
lsattr /var/log/lykoi-audit/audit.jsonl        # 应看到 a 标志
```

出处：`profile/cordis.prod.yml` audit 段注释（逐字）、`m4_handoff.md` 前置 #9、
`WO-M4-W2/paste-1-prepare.sh` §4。

门核六条（`verify.ts` `checkAuditSink`）：非符号链 / 存在 / root 属主 /
服务用户可 append / append-only 属性在 / 父目录 root 属主且组他人不可写。
第五条的探针读不出来（`lsattr` 缺席、文件系统不支持）**也算失败** —— fail closed。

---

## 6 · 人格 TOML 与 root 属主域

人格 TOML 是她的先天人格，门在三处核它（属主 / env 不许重定向 / 哈希）。

```sh
install -d -o root -g root -m 755 /home/lykoi/runtime/persona
install -o root -g root -m 444 <你的 lykoi_base.toml> /home/lykoi/runtime/persona/
```

出处：`m4_handoff.md` 前置 #9、`WO-M4-W2/paste-1-prepare.sh` §5、
`profile/cordis.prod.yml` converse 段。

**这份文件从哪来**：本仓库里唯一一份完整的 persona TOML 是
`packages/lykoi-decide/test/fixtures/lykoi_base.toml` —— 它是**测试夹具**，
写的是另一个个体（Lykoi 与她的所有者 Kevin），不是给你直接搬去生产的。
把它当**格式参考**：`[identity]` / `[voice]` / `[relationship]` / `[personality]` /
`[interests]` 各段的键名与形态在那份文件里一目了然，内容你自己写。
你写的这一份定义的是**你的**那个个体。

接着把受保护面收归 root（在 `npm ci` 之后做）：

```sh
chown -R root:root "$REPO/packages" "$REPO/profile"
chmod -R go-w      "$REPO/packages" "$REPO/profile"
```

出处：`m4_handoff.md` 前置 #9、`WO-M4-W2/paste-1-prepare.sh` §7。

这一步之后，**改这棵树就是 root 动作**。`node_modules/` 保持 lykoi 属主不动 ——
门只核 `node_modules/<pkg>` 是不是指回 `packages/<pkg>` 的 symlink（检查项②b，
防的是「不改源、改解析」的劫持）。

---

## 7 · 凭据

三条原则，一条都不能松：

1. **值永不入库**。配置里只出现 env **引用名**（`tokenEnv` / `apiKeyEnv`），
   不出现值。出处：`packages/lykoi-adapter-telegram/src/production.ts` 文件头、
   `packages/lykoi-llm-deepseek/src/index.ts`「凭据走 apiKeyEnv 环境引用按请求解析，
   永不落明文」。
2. **值只进 systemd 的 `EnvironmentFile`**，文件 `root:root 600`，
   systemd 以 root 读、读完降权到 `User=lykoi`。出处：`m4_handoff.md` 前置 #11、
   `WO-M4-W2/units/lykoi-cordis.service` 头注。
3. **门永不读值**。`LYKOI_TELEGRAM_BOT_TOKEN` 在 GK-6 钉面上是 `secret` 类：
   只看设没设、空不空，值永不比对、永不落日志。出处：`surface.ts` `ENV_PINS`
   末条 + `verify.ts` `checkEnvPins` 的 `case 'secret'`。

```sh
# 出处：paste-1-prepare.sh §6 + units/lykoi-cordis.service 的两条 EnvironmentFile
install -o root -g root -m 600 /dev/null /home/lykoi/secrets/telegram-cordis.env
install -o root -g root -m 600 /dev/null /home/lykoi/secrets/llm.env

sudoedit /home/lykoi/secrets/telegram-cordis.env   # 一行：LYKOI_TELEGRAM_BOT_TOKEN=<你的值>
sudoedit /home/lykoi/secrets/llm.env               # 一行：DEEPSEEK_API_KEY=<你的值>
```

模板见 `deploy/telegram-cordis.env.example` 与 `deploy/llm.env.example`
（占位符，不含任何真值）。

`DEEPSEEK_API_KEY` 是 vendor 缺省名（出处：`packages/lykoi-llm-deepseek/vendor/index.js`
`DEFAULT_API_KEY_ENV`）。它不是 `LYKOI_*`，所以不触「unit 的 env 面只该有一条
`LYKOI_*`」那条钉面。

**你要自己准备**：一个 DeepSeek API key（`https://api.deepseek.com`）、
一个 Telegram bot token（BotFather 发）。本仓库不代劳、不内置任何默认凭据。

---

## 8 · bootstrap 预授权（解 S1B 死锁）

必须在服务第一次真正对话之前跑一次。理由是一个死锁：`messenger.send` 默认 "ask"，
她要问你一个问题，**问句本身**要走 `messenger.send` —— 没有那条授权行，问句自己
撞在门上，于是她永远问不出那个问题，你永远看不到那条待批。

```sh
cd "$REPO"
NODE=/opt/node-v24.18.0/bin/node

# 先体检（--dry-run 一个字节都不写）
sudo -u lykoi "$NODE" packages/lykoi-kernel/src/bootstrap-preauth.ts \
  --state-db /home/lykoi/state/memory.db \
  --rules    /home/lykoi/state/approval_rules.json \
  --standing /home/lykoi/state/standing_grants.json \
  --dry-run

# 实跑（幂等：授权行已在册就走 already 路径，规则文件一个字节都不重写）
sudo -u lykoi "$NODE" packages/lykoi-kernel/src/bootstrap-preauth.ts \
  --state-db /home/lykoi/state/memory.db \
  --rules    /home/lykoi/state/approval_rules.json \
  --standing /home/lykoi/state/standing_grants.json
```

出处：`profile/cordis.prod.yml` 头注「启动次序 0」、`m4_handoff.md` 前置 #1、
`packages/lykoi-kernel/src/bootstrap-preauth.ts` 文件头、
`WO-M4-W2/paste-2-switch.sh` §3。

退出码（源码 `USAGE` 逐字）：`0` 在册 / `1` 用法错 / `2` 规则文件或 state 库体检不过
（**什么都没写**）/ `3` 没有 `owner_primary` 行（什么都没授，死锁仍在）/
`4` 跑完仍不在册（不该发生）。

`exit 3` 是新用户最可能撞上的一条：它要求 state 库里有一行 active 的
`owner_primary` 用户 —— 那是「谁是这个 Lykoi 的所有者」这件事的事实源。
见 `§13 已知缺口`。

**为什么在签 manifest 之前跑**：它会写 `approval_rules.json`。规则文件本身
**不在**哈希钉面上（这是对活体语义的一处显式偏离：规则文件运行期会被合法改写 ——
你答一句「以后都可以」就改一次 —— 钉住它等于给每次授权埋一颗下次重启的砖机；
完整性由检查项⑥承担）。所以次序错了不再是死锁，但先跑它仍是好次序。
出处：`profile/cordis.prod.yml` 头注「启动次序 0」+ `manifest.ts` GK-15 段。

---

## 9 · 签 manifest（完整性门的第一次签名）

```sh
cd "$REPO"
sudo /opt/node-v24.18.0/bin/node packages/lykoi-gate/src/cli.ts --write-manifest
```

产物 `packages/lykoi-gate/manifest.sha256`，`444` 权限。它**不入库**
（`.gitignore` 里有一条带理由的注释）：它必须覆盖两个仓库外的规范路径
（人格 TOML），开发机上根本签不全，签出来的也只是一份立刻过期的假证明。

签进去的是（`manifest.ts` `protectedEntries`）：

| 域 | 成员 |
|---|---|
| root 属主域 | `packages/lykoi-kernel/**`、`packages/lykoi-gate/**`、`profile/*`（五个文件）、人格 TOML（绝对路径） |
| hash-pin 域 | 其余全部 `packages/<pkg>/src/**.ts` + 各包 `package.json`、根 `package.json` / `tsconfig.json`、五份治理常数文档 |

然后以**服务用户的视角**试跑一次，这里必须绿：

```sh
sudo -u lykoi /opt/node-v24.18.0/bin/node packages/lykoi-gate/src/cli.ts
# gate: OK
```

出处：`WO-M4-W2/paste-1-prepare.sh` §8-9、`packages/lykoi-gate/src/cli.ts` 文件头。

门的八检查项（`verify.ts` `CHECKS`）：①门自身的属主与不可写 ②受保护树 + 影蔽面
（构建产物 / 包解析劫持 / symlink）③GK-6 env 钉面 22 条 ④path guard 自检
⑤manifest 三向 + 反向核对 ⑥活规则硬门核对 + 事件词汇分流 ⑦审计 sink 六断言
⑧state 落点调和（`§4b` 那一条链接）。
任一有问题 → `exit 1` → 服务不起来。这是 fail closed 的物理面。

---

## 10 · systemd

三件套：主 unit + watchdog 的 oneshot service + 拉它的 timer。
模板在 `deploy/`（占位符形式），切换窗用过的正本在
`governance/wo/WO-M4-W2/units/`。

```sh
install -o root -g root -m 644 deploy/lykoi-cordis.service.template \
        /etc/systemd/system/lykoi-cordis.service
install -o root -g root -m 644 deploy/lykoi-cordis-watchdog.service.template \
        /etc/systemd/system/lykoi-cordis-watchdog.service
install -o root -g root -m 644 deploy/lykoi-cordis-watchdog.timer.template \
        /etc/systemd/system/lykoi-cordis-watchdog.timer
install -o root -g root -m 755 deploy/lykoi-cordis-watchdog.sh.template \
        /usr/local/sbin/lykoi-cordis-watchdog.sh
# 三份 unit 里的 <NODE_BIN> 占位符换成你的 node 绝对路径，然后：
systemctl daemon-reload
```

主 unit 的两条硬形状（出处：`m4_handoff.md` 前置 #11、`profile/index.prod.ts` 文件头）：

- `ExecStartPre` = 完整性门。门红 → 服务不起。
- `ExecStart` = `profile/index.prod.ts`（**生产专用入口，零 env 读取**）。
  曾设想的 `LYKOI_PROFILE=prod` 被否决 —— 用 env 选装配等于在钉面之外再开一个
  改道旋钮。两个写死的入口之后，「生产箱上起了 dev 装配」从「可能」变成「不可能」。

**env 面纪律**：治理 state 路径与旋钮**一条都不许写进 `Environment=`**。
未设 = 走已签名的源码/装配面缺省；设了 = 一次没有签名的治理变更 = 门红。
unit 的 env 面里唯一该有的 `LYKOI_*` 是 `LYKOI_TELEGRAM_BOT_TOKEN`。
`LYKOI_TELEGRAM_PROXY` 是 `unset` 类：设了就是一条外泄通道，必须未设 ——
代理走签名过的装配面（见 `§11`）。出处：`surface.ts` `ENV_PINS`、
`cordis.prod.yml` 头注 env 钉面段。

**watchdog 为什么不在插件树里**：一个被自己看守的对象加载进来的看守不是看守。
它是 root 单元、住 `/usr/local/sbin`（不在任何 lykoi 可写树里），
探两样：unit 是否 active（补 `Restart=always` 撞 StartLimit 后弃疗的盲区）、
审计 sink 的 mtime 是否超过 4500 秒（= 心跳基线 30min 的 2.5 倍；进程在而心不跳）。
出处：`m4_handoff.md` 前置 #10、`WO-M4-W2/units/lykoi-cordis-watchdog.sh` 文件头。

---

## 11 · 按序翻开器官位（🔒 每一次都要重签）

`profile/cordis.prod.yml` 里六个位默认 `disabled: true`。翻开的做法是**删掉那一行
`disabled: true`**（可以留一条说明为什么翻开的注释），然后重签 manifest。
出处：装配面逐条注释 + `m4-switch` 分支上六个位翻开的真实形态。

| 位 | 翻开的条件 |
|---|---|
| `llm-deepseek` | `/home/lykoi/secrets/llm.env` 里有 `DEEPSEEK_API_KEY=`（`§7`） |
| `memory` | `/home/lykoi/state/memory.db` 在位，且**没有第二个进程在写它**（R-01） |
| `converse` | memory 位的条件 + 人格 TOML 在规范路径（`§6`） |
| `wake` | 同 memory（写同一个 state 库，同受 R-01 约束）+ 人格 TOML 在规范路径（`§6`，与 converse 同一份；learn 是库不是条目，由 wake 驱动） |
| `telegram-transport` | unit env 里 `LYKOI_TELEGRAM_BOT_TOKEN` 非空；`proxy` 值按你的网络填 |
| `telegram` | transport 位在位（它从 `telegramTransport` 服务取传输） |

**代理值**：装配面里现有的 `proxy: 'http://192.168.0.202:7890'` 是**参考部署的内网
代理箱地址**（2026-08-31 取证：那台主机直连 `api.telegram.org` 超时不通，经它 1.2s 通）。
**按你自己的网络环境改**：直连可达就填空串 `''`，否则填你自己的
`http://` / `https://` 代理（socks 不支持，构造期会抛）。这一位**只能从装配面来** ——
传输层自身零 env 读取，所以改它就是改签名过的配置，要重签。
出处：`cordis.prod.yml` telegram-transport 段、
`packages/lykoi-adapter-telegram/src/http.ts` 文件头④。

`api.deepseek.com` 那一跳**没有代理旋钮**（`ProxyAgent` 只接在 telegram 传输层）。
你的服务器必须能直连它。

### 🔒 装配面上还有哪些是治理决定

改了这些之中任何一个都要 `--write-manifest` 重签：

| 值 | 现值 | 语义 |
|---|---|---|
| `audit.config.path` | `/var/log/lykoi-audit/audit.jsonl` | 审计落在哪 |
| `budget.dailyTotalTokens` / `dailyRouteTokens` | `2000000` / `deepseek: 2000000` | 她一天能花多少 |
| `converse.notificationOutboxDelivery` | `false` | 开 = 通知从 pull 变 push（**改变到达行为**） |
| `converse.interpretTimeoutS` / `interpretRetries` / `cycleTimeoutS` | `30` / `1` / `180` | 「一次审批问句等多久才算问不到」。删掉这三行不换语义 —— Schema 缺省读同一份 `D01_DEFAULTS`（`lykoi-converse/src/deadline.ts`） |
| `converse.visionRoute` / `visionModel` | `disabled` / `disabled` | 显式「决定不开」。空串是另一回事 = **漏填**，两者在事件流上必须分得开 |
| `heart.checkIntervalMs` / 基线节律 | `1000` / 源码缺省 30 分钟 | 基线走源码；`LYKOI_HEARTBEAT_BASELINE_MIN` 是旋钮类钉面，生产必须未设 |
| 六个器官位的 `disabled` | 见上表 | 哪些器官在她身上 |

重签的唯一合法路径：

```sh
sudo /opt/node-v24.18.0/bin/node packages/lykoi-gate/src/cli.ts --write-manifest
sudo -u lykoi /opt/node-v24.18.0/bin/node packages/lykoi-gate/src/cli.ts   # 必须 gate: OK
systemctl restart lykoi-cordis
```

---

## 12 · 启动与冒烟验证

```sh
systemctl enable --now lykoi-cordis.service
systemctl enable --now lykoi-cordis-watchdog.timer
sleep 8
systemctl --no-pager --lines=0 status lykoi-cordis.service | head -6
journalctl -u lykoi-cordis -n 25 --no-pager
```

journal 里起来的样子（出处：`profile/index.prod.ts` 末尾两行）：

```
[lykoi] production assembly up; services: audit=ok budget=ok heart=ok llm=ok lykoiLlm=ok
[lykoi] running (production); systemd owns the lifecycle
```

这五件是**治理地基花名册**（地板检查），与器官启用无关 —— 缺一件即 `exit 1`。

验收按序（出处：`m4_handoff.md` §D 验收清单，`WO-M4-W2/paste-2-switch.sh` §6 逐条内嵌）：

1. **门绿**：`gate: OK`（`ExecStartPre` 在 journal 里又跑了一遍）。
2. **审计在长且只增**：`lsattr /var/log/lykoi-audit/audit.jsonl` 见 `a`；
   `tail -3 /var/log/lykoi-audit/audit.jsonl` 有新行。
3. **收得到**：你发一条普通消息 → journal / audit 见入站。
4. **说得出**：她回一句；audit 里 `action_dispatch` + `action_result` 成对
   （`grep -c action_dispatch /var/log/lykoi-audit/audit.jsonl`）。
5. **终端硬门实弹**：让她跑一条 `terminal.exec` → 问句真的到你 → 引用回复批准 →
   执行 → 回执。
6. **审批环的另一半**：拒绝路 + `unclear` 路各走一次。
7. **restart 事件**：`systemctl restart lykoi-cordis` → 她知道自己重启过
   （history / audit 的 restart 行带 HEAD / downtime；采不到 = **省略**，
   不该出现编造值）。
8. **端到端一致**：信封自称 dispatched ⟺ audit 里真有对应的 `action_dispatch` 行。

第 3-8 条要器官位翻开之后才谈得上（第 7 条的 restart 线索采集器住在
`lykoi-converse`，所以它也要那一位翻开）。地基阶段能验的是 1、2。

---

## 13 · 已知缺口（全新部署必须你自己解决）

逐条如实列出。这些不是"待办"，是本仓库当前**没有**提供的东西。

1. **state 库没有生产创建入口**。schema 的唯一一份 DDL 在
   `packages/lykoi-memory/src/testing.ts`（`STATE_FIXTURE_DDL`），
   它的文件头写明「**只被测试树 import**」—— 那是测试夹具，不是迁移器。
   `lykoi-memory` 主入口是只读三重防写（`readOnly: true` + `PRAGMA query_only`
   + 服务面零写方法）。参考部署里 `memory.db` 是从上一具躯体原样接管的
   （Python 活体的 `migrations.py` 建的库，`mind_schema` 版本 15）。本仓库当前
   期望版本是 16（`packages/lykoi-memory/src/index.ts` 的
   `EXPECTED_MIND_SCHEMA_VERSION`）：接管来的 15 库要先在停机窗内施加
   `governance/wo/WO-MEM-SOURCE-01/migrations/016_experiences_epistemic.up.sql`，
   否则新体开库即拒。
   全新部署要自己造这个库。
2. **没有 `owner_primary` 行就没有所有者**。`bootstrap-preauth` 从
   `SELECT id FROM users WHERE role = 'owner_primary' AND status = 'active'` 读它，
   读不到 `exit 3`，什么都不授，死锁仍在。
3. **身份绑定是一次刻意的人工登记**。Telegram 入站消息经
   `identity_bindings(channel, channel_key)` 反查用户；查不到就丢
   （`packages/lykoi-adapter-telegram/src/index.ts` 的 `binding === undefined` 分支）。
   `testing.ts` 明确**不播种任何绑定行**（「绑定属她的数据，不属中性基线」）。
   本仓库没有登记入口 —— 你要自己往那张表里写你的 telegram sender id → 你的 user id。
4. **人格 TOML 要你自己写**（`§6`）。仓库里那份是测试夹具，写的是另一个个体。
5. **凭据要你自己备**：DeepSeek API key、Telegram bot token（`§7`）。
6. **网络**：`api.deepseek.com` 必须直连可达（没有代理旋钮）；
   `api.telegram.org` 直连不通就要一个自己的 http/https 代理（`§11`）。
7. **感知侧的 sidecar 没有**：`heart.salienceDb` 留空 = 纯基线节律。
   `/home/lykoi/state/salience_shadow.db` 由一个本仓库之外的显著性 sidecar 写。
8. **器官真身是显式替身**：`browser` / `terminal` / `research_browser` 现在是
   「大声抛」的占位实现，真身排在 M5（`m4_handoff.md` §E）。
9. **备份与灾备**：本仓库不提供备份脚本。参考做法见
   `governance/reports/runbook_disaster_recovery.md`；最小形态是**停服务之后**
   （停稳 = 一致快照）打包 `/home/lykoi/state`：
   `tar -C /home/lykoi -czf backup-$(date +%Y%m%dT%H%M%S).tar.gz state`
   （出处：`WO-M4-W2/paste-2-switch.sh` §2）。

---

## 14 · 停 / 起 / 回滚

**R-01 是硬规则**：两个进程同时往同一个 `memory.db` / 同一批 `state/*.json` 里写，
等于把她的连续性交给一次竞态。所以任何切换都是严格串行的**停 → 备份 → 起**：

```sh
systemctl disable --now lykoi-cordis-watchdog.timer   # 看门狗先停，否则它把服务拉回来
systemctl disable --now lykoi-cordis.service
sleep 3
pgrep -u lykoi -f 'profile/index.prod.ts' && { echo '进程未清，等它退净'; exit 1; }

tar -C /home/lykoi -czf "/home/lykoi/backup-$(date +%Y%m%dT%H%M%S).tar.gz" state
```

出处：`m4_handoff.md` 前置 #4 与 §D 回滚路径、`WO-M4-W2/paste-2-switch.sh` §1-2
与文末 ROLLBACK 段。

恢复时**用 `mv` 保全现场，绝不 `rm`**：

```sh
mv /home/lykoi/state "/home/lykoi/state.failed-$(date +%Y%m%dT%H%M%S)"
tar -C /home/lykoi -xzf /home/lykoi/backup-<指名那一份>.tar.gz
chown -R lykoi:lykoi /home/lykoi/state
```

---

## 附：常见的门红与它的意思

| 门的话 | 意思 |
|---|---|
| `not root-owned (uid …)` | `§6` 的 `chown` 没做，或做完之后有人以 lykoi 身份改了树 |
| `manifest missing (run --write-manifest as root)` | `§9` 没做。**缺失即失败**，没有静默 bootstrap |
| `hash mismatch (tampered?)` | 受保护文件被改过而没重签。改装配面之后必须重签 |
| `protected but not in manifest (re-sign required)` | 新增了包或文件（补集定义：新包自动落进 hash-pin 域）。重签 |
| `workspace link missing / is not a symlink` | `npm ci` 没跑，或 `node_modules/<pkg>` 被真目录顶掉（解析劫持） |
| `build artifact shadows protected source` | 受保护 `src/` 里出现了 `.js` / `.d.ts` / `dist/`。`noEmit` 下一个都不该有 |
| `… redirects a governance path to …` | unit 里设了治理 state 路径的 env。删掉它 —— 未设才是对的 |
| `… overrides a governance knob from the unit environment` | unit 里设了旋钮类 env。要改就改源码再重签 |
| `LYKOI_TELEGRAM_PROXY must be unset in production` | 代理走装配面，不走 env |
| `audit sink … missing append-only attribute` | `chattr +a` 没做，或 `lsattr` 读不出来（缺 `e2fsprogs` / 文件系统不支持） |
| `persona TOML missing` | `§6` 没做 |
| `state landing missing: …/var/state` | `§4b` 没做。**缺失即失败** —— 运行期 `writeJsonAtomic` 会在这里 `mkdir` 出真实目录，她的 state 就分叉了 |
| `state landing is not a symlink (forked state)` | `§4b` 那条链接被一个**真实目录**顶掉了（多半是漏了 `§4b` 就起过服务）。分叉**已经发生**：先核对该目录里有哪些文件，再决定弃/并，然后重建链接 |
| `state landing points outside the canonical state dir` | 链接在，但指到了 `/home/lykoi/state` 之外。`ln -sfn` 重建（`§4b`） |
| `path guard does not protect the integrity gate itself` | 树装在了非规范路径而没改 `PROD_REPO_ROOT` / `GATE_SOURCE_CANONICAL`（`§2`） |
