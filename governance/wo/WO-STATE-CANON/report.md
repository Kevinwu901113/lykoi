# WO-STATE-CANON · 落地报告

> 执行：Mac 本地 Opus 子 Agent，工作副本 `~/Documents/lykoi/lykoi-cordis`。
> 分支 `wo/state-canon`，基 = main `acee28b`（签单 commit；order.md 头部写的
> `27dd4f3` 是签单的父）。**未 push、未合并、未碰 m4-switch、未动 order.md。**
> 交卷时分支尖 = 本报告所在的判据③ commit。

---

## 0 · 判据 → commit 对照

| 判据 | commit | 变更面 |
|---|---|---|
| ① 门检查项 | `af5a023` | `lykoi-gate` src ×3 + test ×3（新增 1）+ README/package.json 计数订正 |
| ② 部署材料 | `272bce4` | `docs/deploy.md`、`WO-M4-W2/paste-1-prepare.sh`、`profile/cordis.prod.yml`（**只加注释**）、README |
| ③ 全量收口 | 本 commit（分支尖） | 本报告 |

判据①②合计 diffstat：

```
 README.md                                    |   4 +-
 docs/deploy.md                               |  50 +++++++++-
 governance/wo/WO-M4-W2/paste-1-prepare.sh    |  13 +++
 packages/lykoi-gate/package.json             |   2 +-
 packages/lykoi-gate/src/index.ts             |   2 +-
 packages/lykoi-gate/src/surface.ts           |  23 ++++-
 packages/lykoi-gate/src/verify.ts            |  83 +++++++++++++++-
 packages/lykoi-gate/test/fixture.ts          |  20 +++-
 packages/lykoi-gate/test/gate-checks.test.ts |   4 +-
 packages/lykoi-gate/test/state-canon.test.ts | 141 +++++++++++++++++++++++++++
 profile/cordis.prod.yml                      |  11 +++
 11 files changed, 337 insertions(+), 16 deletions(-)
```

---

## 1 · 侦查结论（判据①要求，动手前做）

### 1.1 检查项怎么组织、怎么编号、怎么注册

`verify.ts` 的结构是**一个检查项 = 一个导出的纯副作用函数**
`(env: GateEnv, problems: string[]) => void`，往 `problems` 里 push 人话字符串；
零抛出、零 exit、零日志。注册面是文件末尾的 `CHECKS` 常量：

```ts
export const CHECKS = Object.freeze([
  ['gate_ownership', checkGateOwnership],
  ...
  ['audit_sink', checkAuditSink],
] as const satisfies readonly (readonly [string, (env: GateEnv, problems: string[]) => void])[])

export function verify(env: GateEnv): string[] {
  const problems: string[] = []
  for (const [, check] of CHECKS) check(env, problems)
  return problems
}
```

编号是**注释与测试名里的圈码**（①…⑦，⑥b 是事件词汇分流这个附挂项），
`CHECKS` 里配一个稳定的 snake_case 名（报告与红测按名索引）。所以 `CHECKS`
有 8 个条目而文档口径是「七检查项」—— 事件词汇是⑥的 b 面。
**本单新增的是第八条**（`state_canon`），文档口径随之七→八。

### 1.2 生产判定是怎么做的（关键结论：**没有"生产模式"开关**）

侦查前的猜想是「有个 isProduction 之类的判定」。实勘结论是**没有，也不需要**：

- `verify()` 全仓**只有一个非测试调用点** —— `cli.ts:50`，即 systemd
  `ExecStartPre` 那个进程（`grep -rn "verify(" --include='*.ts'` 全仓核过）。
  门**不是插件**（`index.ts` 顶注逐字：不 apply 进 cordis 树、不 export
  Service），`profile/index.ts` / `index.prod.ts` 都不加载它。
- 于是「生产 gate 运行形态」这个激活条件是**由拓扑保证的**，不是由一个运行期
  判定保证的：跑 `verify()` 的只有两种情形 —— 生产 ExecStartPre（吃
  `productionEnv()`），和测试（吃夹具注入的 `GateEnv`）。
- 「dev 装配不误伤」因此是**天然成立**的：dev 跑的是 `npm start` →
  `profile/index.ts`，那条路径上根本没有门。README:86 早就写明「完整性门在开发机
  上必然红，这是设计如此」—— 检查项①④⑦在开发机上本来就全红。

⇒ **新检查项不需要、也不该带一个 skip 开关。** 加一个「非生产就跳过」的旋钮，
等于给这条检查项开一个不需要存在的绕行门；拓扑已经把激活条件解决干净了。

### 1.3 测试怎么注入路径（对齐的同形接入点）

`GateEnv` 是「门跑一次所需的全部外部事实」的注入面，顶注写明这是
**可测性的唯一让步**：活体把 `uid 0` 写死，新体把它做成 `rootUid` 入参。
既有的四条外部事实全是同一形态 —— `personaToml` / `rulesPath` / `auditPath`
是路径，`isProtectedPath` / `appendOnlyProbe` 是探针；`productionEnv(repoRoot)`
填生产缺省，`test/fixture.ts` 的 `makeFixture()` 在 tmpdir 合成树上填替身。

**新检查项的接入点因此确定为：**

| 决定 | 选择 | 理由 |
|---|---|---|
| canonical 目标 | 进 `GateEnv.stateCanonical`（缺省 `STATE_CANONICAL`） | 与 `personaToml`/`auditPath` 同一条让步：`/home/lykoi` 在开发机上不存在，不注入就没法在 tmpdir 上跑**真** `lstat`/`realpath` |
| canonical 是否读 env | **不读**（`productionEnv` 直接取常量） | D-SC-1 明写「不加 unit env」。对比同一函数里 `rulesPath`/`auditPath` 是 `environ.X ?? canonical` —— 能被 env 换掉的 canonical 等于没有 canonical |
| 链接落址 `var/state` | **不参数化**，由 `repoRoot + STATE_LINK_REL` 推出 | 那正是运行期真会被写到的位置。把它做成入参 = 测了个别的地方 |
| 常量落处 | `surface.ts`（原私有 `STATE_DIR` 提升为导出 `STATE_CANONICAL`，新增 `STATE_LINK_REL`） | `surface.ts` 是受保护面与钉面的唯一声明处；`ENV_PINS` 的 `at()` 本来就用这个常量，提升后钉面全表**零变化** |
| 失败语义同形对象 | 检查项②b `checkResolutionLink` | 那一条也是「必须是 symlink 且 realpath 等于某处」，且守的是同一类失败面：**文件内容一字节没变，落点整个改道，manifest 全绿**。新检查项逐条照抄它的分支形状（不是链接 / 解析不出来 / 指到别处） |

---

## 2 · 判据① · commit `af5a023`

### 2.1 diff 摘要

- **`src/surface.ts`**：私有 `const STATE_DIR` → 导出 `STATE_CANONICAL`
  （`at()` 仍用它，`ENV_PINS` 13 条 path 类 canonical 值逐字不变）；
  新增 `STATE_LINK_REL = 'var/state'`，注释写明它**刻意不做成入参**。
- **`src/verify.ts`**：
  - `GateEnv` 增 `stateCanonical: string`（带让步理由注释）；
  - `productionEnv` 填 `STATE_CANONICAL`，**不经 env 解析**（带理由注释）；
  - 新增 `checkStateCanon`（含活体无对应物的说明：活体 state 路径在源码里就是
    绝对的，没有两个落点可分叉，这条检查项是新体形态独有的）；
  - `CHECKS` 追加 `['state_canon', checkStateCanon]`。
- **`test/fixture.ts`**：合成树立 `repo/var/state -> <tmp>/state` 这条链接
  （合成的 `/home/lykoi/state` 就是活规则住的那个目录），`Fixture` 暴露
  `stateCanonical` / `stateLink`，`GateEnv` 填 `stateCanonical`。
- **`test/state-canon.test.ts`**（新，8 条测试）。
- 计数订正七→八：`verify.ts` / `index.ts` / `package.json` / `fixture.ts` /
  `gate-checks.test.ts` / `README.md`。

### 2.2 检查项语义（三态 + 两条 fail closed 分支）

| `<repo>/var/state` 的形态 | 判定 | 讯息 |
|---|---|---|
| symlink 且 `realpath` = canonical | **OK** | — |
| **真实目录** | **FAIL** | `state landing is not a symlink (forked state): … is a real directory, expected a symlink to /home/lykoi/state` |
| 普通文件 | FAIL | 同上，`regular file` |
| **不存在** | **FAIL** | `state landing missing: … (expected a symlink to /home/lykoi/state) — runtime writeJsonAtomic would mkdir a real directory here and fork her state` |
| 悬空 symlink | FAIL | `state landing unresolvable: …` |
| symlink 指到别处 | FAIL | `state landing points outside the canonical state dir: … -> … (canonical: …)` |

「缺失也算失败」的理由写进了讯息本身：运行期 `writeJsonAtomic` 会自己
`mkdir -p`，所以**缺失 = 未来分叉**，与已分叉同罪。

### 2.3 三态测试的红 → 绿自证

**负例先行**：先写测试文件（断言全部走 `verify()`，即 `cli.ts` 真正调的那个
入口，不是只走单检查项），此时 `checkStateCanon` 尚不存在。

红（实现前，`node --test test/state-canon.test.ts`）：

```
✔ ⑧态一（正确）：var/state 是指向 canonical state 目录的符号链接 → verify() 全绿 (8.314458ms)
✖ ⑧态二（真实目录）：var/state 是真实目录 → FAIL（分叉已经发生） (6.785875ms)
✖ ⑧态二变体：var/state 是个普通文件 → 同样 FAIL (6.384458ms)
✖ ⑧态三（缺失）：var/state 不存在 → 同样 FAIL（缺失 = 未来分叉，不是"没什么可查"） (6.271166ms)
✖ ⑧态三变体：连 var/ 父目录都不在 → 同样 FAIL（全新树落地后的形态） (7.845541ms)
✖ ⑧：symlink 指到 canonical 之外 → FAIL（"是条链接"不等于"调和对了"） (6.224667ms)
ℹ tests 6
ℹ pass 1
ℹ fail 5
```

五条负例的失败断言逐条都是 `actual: 0, expected: 1` —— 即
**`verify()` 对这五种形态全部返回 0 problems，一条都没逮住**。这正是本单要
消灭的那个缺口的可执行证据（真实目录态就是 2026-09-01 01:18 生产机上的现场形态）。

绿（实现 `checkStateCanon` + 挂进 `CHECKS` 之后，同一批断言）：

```
✔ ⑧态一（正确）：var/state 是指向 canonical state 目录的符号链接 → verify() 全绿
✔ ⑧态二（真实目录）：var/state 是真实目录 → FAIL（分叉已经发生）
✔ ⑧态二变体：var/state 是个普通文件 → 同样 FAIL
✔ ⑧态三（缺失）：var/state 不存在 → 同样 FAIL（缺失 = 未来分叉，不是"没什么可查"）
✔ ⑧态三变体：连 var/ 父目录都不在 → 同样 FAIL（全新树落地后的形态）
✔ ⑧：symlink 指到 canonical 之外 → FAIL（"是条链接"不等于"调和对了"）
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

随后补两条接入面测试（共 8 条）：

- `⑧：检查项挂在 CHECKS 里（= ExecStartPre 那一次 verify() 真的会跑到它）` ——
  断言 `CHECKS` 含 `state_canon`，且单检查项直调与走 `verify()` 给同一个答案
  （没有第二条被绕开的路径）。
- `⑧：生产缺省 —— canonical = /home/lykoi/state，落址 = var/state，且 env 改不动它`。

不依赖真实 `/home/lykoi`：全部在 `mkdtemp` 的合成树上跑**真** `lstat` /
`realpath` / `symlink`，与既有夹具同一条数据纪律（零真 state 触碰、零时间语义）。

`lykoi-gate` 全包：**tests 71 / pass 71 / fail 0 / skipped 0**。

---

## 3 · 判据② · commit `272bce4`

### 3.1 `docs/deploy.md`

- **§2 规范路径表**增一行：`<repo>/var/state` = 符号链接 → `/home/lykoi/state`，
  `lykoi:lykoi`，父目录 `var/` 同；出处行补 `STATE_CANONICAL` / `STATE_LINK_REL`。
- **新增 §4b「state 落点调和（🔒 D-SC-1；完整性门检查项⑧）」**，位置在
  §4 落树装依赖之后、§5 audit sink 之前 —— 必须早于 §9 签 manifest + 门试跑，
  因为检查项⑧ 在那一步就会核它。内容：
  - 开头一句后果先行（漏了这一步 = 她的审批记忆在错误落点新开副本，附 01:18 实证）；
  - `sudo -u lykoi mkdir -p "$REPO/var"` + `ln -sfn /home/lykoi/state
    "$REPO/var/state"` + `readlink -f` 自检；
  - 「为什么需要这条链接」：源码相对缺省 vs 钉面绝对 canonical，定案不改源码、
    不加 unit env 是本体；
  - 「`var/` 在 `.gitignore` 里 → 链接不随树落地，每台机器供给一次；开发机维持
    真实目录形态」；
  - 检查项⑧ 三态。
- **§9** 检查项清单七→八，补⑧。
- **§附「常见的门红与它的意思」**补三行，各带处置口径；真实目录那条明写
  「分叉**已经发生**：先核对该目录里有哪些文件，再决定弃/并，然后重建链接」
  —— 即 D-SC-2 的口径，不诱导值班的人直接覆盖。

### 3.2 `governance/wo/WO-M4-W2/paste-1-prepare.sh`

新增 **§3b**，插在 §3 依赖与 §4 audit sink 之间（不动既有步骤编号）：

```sh
echo '== 3b · state 落点调和（D-SC-1；检查项⑧ 的供给面） =='
sudo -u lykoi mkdir -p "$REPO/var"
sudo -u lykoi ln -sfn /home/lykoi/state "$REPO/var/state"
[ -L "$REPO/var/state" ] || { echo 'FAIL: var/state 不是符号链接（真实目录？先核对里面有什么再决定弃/并）'; exit 1; }
[ "$(readlink -f "$REPO/var/state")" = /home/lykoi/state ] \
  || { echo 'FAIL: var/state 没指向 /home/lykoi/state'; exit 1; }
echo 'STATE LANDING OK'
```

三点留痕：

1. **硬断言**（`if/exit`）而非软断言 —— 沿用 WO-M4-FIX-WAKE 那次「软断言→硬断言」
   的修正，整稿 `set -euo pipefail` 下不合即停。
2. `ln -sfn` 幂等；但**撞上既存真实目录时 `ln` 会建出 `var/state/state`**
   （这是 `ln` 的既知行为，`-n` 只对「指向目录的符号链接」生效）。紧随其后的
   `[ -L ]` 正好逮住这一态并要求人工核对 —— **不静默覆盖已分叉的目录**，与
   D-SC-2「先核实再决定弃/并」同口径。
3. `bash -n` 语法检查通过。

### 3.3 `profile/cordis.prod.yml`（**只加注释**）

尾表「生产 state 路径全表」之后补一段注释：调和机制（靠符号链接）、供给步出处
（`deploy.md §4b` / `paste-1 §3b`）、检查项⑧ 三态、dev 维持真实目录。

**实体配置零变化，已验**：改动前后两份文件经 `js-yaml` 解析后
`JSON.stringify(a) === JSON.stringify(b)` → `true`（12 个顶层条目）。

### 3.4 runbook 面

`governance/wo/INIT-NODE-2026-08/runbook.md` 是**旧体**初始化的骨架文档，
无 Cordis 的对应步骤面（全文零 `/home/lykoi/state` 供给步）。Cordis 的 runbook
就是 `docs/deploy.md` 本身，已在 §3.1 同步。

`README.md` dev 段补一句：检查项⑧ 在开发机上同样必红（dev 用真实目录），
指向 `deploy.md §4b`。

---

## 4 · 判据③ · 全量收口

仓库根，**前台串行**跑完。

### 4.1 `npm test`（全 workspaces，17 个）

退出码 `0`。原样末尾输出（最后一个 workspace `lykoi-wake` 的汇总）：

```
✔ SA-171：失败拍不驱动整合/专注 (22.476625ms)
✔ rest 拍端到端：安静合法、demote 不发生、计数为零 (20.100334ms)
✔ 推演零写入（SA-47）+ 对照组（SA-48）：read→candidates→messages→evaluate 全程零写 (58.01675ms)
✔ 同一时刻两次 read 逐字段相同 + 均零写（分发给 N 个分支的前提，DA-10 唯一前提） (24.100583ms)
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 902.310875
```

`npm --workspaces` 逐包出汇总、不出总账，故按 `ℹ` 行逐包求和：

```
tests 808  pass 797  fail 0  skipped 11  todo 0  cancelled 0
```

全日志 `^✖` 行数 = **0**。

**与基线的对账**：工单给的基线「800 通过 / 0 失败 / 11 skipped」在
`WO-M4-FIX-WAKE/report.md:276,282` 记的原样是
**800 tests = 789 pass + 11 skipped + 0 fail** —— 那个 800 是 `tests` 总数，
不是 `pass`。故：

| | tests | pass | fail | skipped |
|---|---|---|---|---|
| 基线（`27dd4f3`） | 800 | 789 | 0 | 11 |
| 本单（`wo/state-canon` 尖） | **808** | **797** | **0** | **11** |
| 差 | **+8** | **+8** | 0 | 0 |

`+8` 逐条可归因 = `state-canon.test.ts` 的 8 条（`grep -c '^test('` = 8，
且 8 条全部出现在全量日志里）。**无其他数字漂移。**

11 个 skip 的分布（属正常，`LYKOI_DEVSTATE_DB` 环境闸；
`lykoi-memory/test/fixture.ts:19-22` 逐字「devstate 副本缺席时 skip 不 fail」）：

```
lykoi-converse@0.1.0 ℹ skipped 1
lykoi-learn@0.1.0    ℹ skipped 1
lykoi-memory@0.1.0   ℹ skipped 9
```

与基线的 11 条同数同分布，未新增亦未减少。

### 4.2 `npx tsc --noEmit`

退出码 `0`，**输出 0 行**（`wc -l` = 0）。原样末尾输出即空 —— tsc 干净时不打印
任何东西。

### 4.3 无单点无常失败

本次全量跑零失败，无需归因。新增测试**零时间语义**（不播种钟、不读钟、无夹具
日期），与既有 gate 夹具同一条纪律，不构成新的定时炸弹面。

---

## 5 · forbidden 逐条自查

| 条 | 自查 |
|---|---|
| 不改源码相对缺省路径 | ✅ `git diff main..HEAD` 未触 `lykoi-kernel` / `lykoi-adapter-telegram` 任何文件；11 处 `var/state/…` 字符串逐字未动 |
| 不动 prod yml 实体配置 | ✅ 只加注释；js-yaml 解析结果前后全等（§3.3 实证） |
| 不动 kernel / heart / converse / wake / decide / memory 等邻接包 | ✅ 变更面只有 `packages/lykoi-gate`、`profile/cordis.prod.yml`（注释）、`docs/`、`governance/`、`README.md` |
| 不新增依赖、不改 package-lock | ✅ `package-lock.json` 不在 diffstat 里；新代码只 import `node:*` 与本包模块 |
| 不碰 m4-switch、不 push | ✅ 全程只在 `wo/state-canon` 上操作，零 push |
| 测试前台串行跑完再交卷 | ✅ §4 |

---

## 6 · 留给治理侧的两条

1. **`docs/m4_handoff.md:180`** 仍写「七检查项全绿」。该文件在 `PINNED_DOCS`
   （治理常数文档，哈希钉面），改它属治理常数变更 + root 重签，**不在本单授权
   范围**，故留原样。建议随下一次 handoff 更新一并订正。
2. **D-SC-2（分叉游标处置）与 D-SC-3（旧体 notify_push 退役）**按单自留，
   本单未触。落地时 `paste-1 §3b` 的 `[ -L ]` 硬断言会在服务器上那个已存在的
   真实 `var/state/` 上**当场停手**（不静默覆盖），正好把 D-SC-2 的核实动作
   逼到台面上 —— 这是刻意的，不是遗漏。
