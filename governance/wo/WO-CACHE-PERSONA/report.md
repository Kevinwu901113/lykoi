# WO-CACHE-PERSONA · 执行报告

> 执行：Mac 本地 Opus 子 Agent，工作副本 `~/Documents/lykoi/lykoi-cordis`。
> 分支 `wo/cache-persona`（全程未切回 main、未 merge、未 push、未碰 m4-switch）。
> 完成日：2026-09-01。

## 实际基

```
94e2b8fc2970c187b34cf6dd93a78db695caecf5 [治理][WAVE-OBS-PREP] 退役单+粘贴稿、观察周 runbook、m4_handoff 修订、HANDOFF 教训 47-49 与快照刷新、WO-CACHE-PERSONA 签单
```

即签单 commit 本身，main 尖，与签单预期一致。

## 三个 commit

| 判据 | sha | 改动 |
|---|---|---|
| ① decide 守卫 | `5f1cac20b51043c38c75ccefee9951c14bb61e32` | `packages/lykoi-decide/src/persona-toml.ts` +43/-4、`packages/lykoi-decide/test/persona-toml.test.ts` +66/-2（合计 103 插入 / 6 删除） |
| ② 调用点迁移 | `f49fbd6be24dd40bcae1bf006b024ae35a5e5305` | `packages/lykoi-converse/src/index.ts` +7/-2、`packages/lykoi-wake/src/index.ts` +16/-6（合计 15 插入 / 8 删除） |
| ③ 全量收口 | 本 commit | 本报告入库 |

---

## 判据① · decide 守卫（D-CP-2 / D-CP-3）

### diff 摘要

`packages/lykoi-decide/src/persona-toml.ts`

- 新增 `import { resolve } from 'node:path'`（Node 内建，非新依赖）。
- 模块级状态从 `cached` 一个变量扩为 `cached` + `cachedPath` 两个。
- `getPersona` 重写：入口先 `resolve(path)` 归一化；缓存为空时**先装载后落坑**
  （`loadPersona(normalized)` 抛出时 `cached` / `cachedPath` 原样为 null）；缓存已热
  且归一化 path 不同 → 抛 `PersonaConfigError`，message 逐字：

  ```
  persona TOML path conflict: process already loaded ${cachedPath}, refusing ${normalized} (one persona kernel per process, SA-156)
  ```

  守卫在装载**之前**拦截，因此撞守卫不改变进程既有内核。
- 新增 `export function resetPersonaCacheForTest(): void`（D-CP-3），置空两个变量。
- 模块头注释与 `getPersona` doc 注释同步说明守卫与「失败不占坑」。
- **`loadPersona` 的行为、签名、错误 message 一字未动。**

`packages/lykoi-decide/test/persona-toml.test.ts`

- import 补 `readFileSync`、`relative as relativePath`、`resetPersonaCacheForTest`。
- 新增辅助 `divergentToml()`：读 fixture 原文把 `name = "Lykoi"` 换成
  `name = "NotLykoi"` 写到临时目录，并断言替换确实发生（fixture 那行若漂了，
  用例前提失效会被点名，而不是静默退化成「两份一样的内核」）。
- getPersona 用例由 1 条扩为 4 条（净增 3）：

  1. 进程级缓存：同 path 两调返回**同一对象引用**（原有用例，加 reset 开头）。
  2. 相对/绝对写法指向同一文件不误炸 —— 先断言两种写法真的不同字符串，再
     绝对→相对、相对→绝对**双向**各证一次同一对象引用。
  3. 不同 path 二调 → `PersonaConfigError`，message 逐字钉（含两个 path）；
     前置断言第二份文件确实是另一个她（`loadPersona(other).identity.name ===
     'NotLykoi'`），炸后再断言进程既有内核仍是 `Lykoi`。
  4. 失败装载不占坑：坏 path 先调抛 `persona TOML not found: {path}`（与
     loadPersona 姿态逐字相同），好 path 后调走**首次装载**分支成功、且第二次
     调返回同一对象。

  四条各自开头 `resetPersonaCacheForTest()` —— 缓存是模块级状态，`node --test`
  每个测试文件一个进程、同文件用例共享它；不清就是顺序耦合，第 4 条尤其会在
  缓存已热时测到守卫而不是装载失败（测错东西且仍然是绿的）。

### 守卫负例红→绿自证

同一份探针脚本，唯一变量是 `getPersona` 的实现。`A` = decide fixture
（`identity.name = "Lykoi"`），`B` = 同形但 `identity.name = "NotLykoi"` 的
第二份合法内核。

**红（判据①动手前，基 94e2b8f 的 getPersona）**

```
B 文件真实内容 identity.name = NotLykoi
getPersona(A).identity.name = Lykoi
getPersona(B).identity.name = Lykoi    <-- 第二器官拿到的
RESULT: NO THROW（静默）；second === first ? true
```

第二个调用点明明指向 `NotLykoi` 那份文件，拿回来的却是 `Lykoi`，而且是**同一个
对象**、**零告警**。这正是签单说的「拿到错的人格且无声」。

**绿（判据① commit 后，同一脚本同一输入）**

```
B 文件真实内容 identity.name = NotLykoi
getPersona(A).identity.name = Lykoi
RESULT: THROW PersonaConfigError | persona TOML path conflict: process already loaded /Users/wukevin/Documents/lykoi/lykoi-cordis/packages/lykoi-decide/test/fixtures/lykoi_base.toml, refusing /private/tmp/.../other_persona.toml (one persona kernel per process, SA-156)
```

静默错人格 → 启动即炸，message 两个 path 都在，运维照着就能定位是哪两个装配项
分叉了。探针脚本是一次性排障件，用完即弃，未入库。

---

## 判据② · 调用点迁移（D-CP-1）

### 侦查结论（动手前做，决定 D-CP-3 在②是否需要）

**前置事实**：三个包的 `test` 脚本都是 `node --test "test/**/*.test.ts"`，Node 24
默认按文件进程隔离 —— 模块级 persona 缓存**不跨测试文件**。因此风险面 = 单个
测试文件内是否出现两个不同的合法 persona path 经插件链装载。

全仓 `loadPersona` / `getPersona` 调用点（生产 + 测试）盘完后，经 plugin `apply`
真正走到装载面的测试进程共 8 个，各自 persona path 形态：

| 测试进程（= 文件） | 经 apply 的 persona path | 形态 |
|---|---|---|
| `lykoi-converse/test/wire.test.ts` | `PERSONA_TOML` ×1 | `new URL('./fixtures/persona.toml', import.meta.url).pathname`，绝对 |
| `lykoi-converse/test/kernel-e2e.test.ts` | 同上 ×1 | 绝对 |
| `lykoi-converse/test/e2e.test.ts` | 同上 ×1 | 绝对 |
| `lykoi-converse/test/w3-organs.test.ts` | 同上 ×1 | 绝对 |
| `lykoi-converse/test/approval-e2e.test.ts` | 同上 ×1 | 绝对 |
| `lykoi-wake/test/kernel-e2e.test.ts` | 同上 ×1 | 绝对 |
| `lykoi-wake/test/plugin.test.ts` | 同一个 `PERSONA_TOML` 常量 ×2（两次 apply） | 绝对，归一化后逐字相同 → 不触守卫 |
| `lykoi-wake/test/persona-toml.test.ts` | 仅负例 `/nonexistent/lykoi/persona.toml` ×1 | 绝对，且**装载失败** → 按 D-CP-2 不占坑 |

三类**不经 apply、不碰缓存**的旁证也一并核了：
`lykoi-converse/test/deadline.test.ts` 与 `lykoi-wake/test/persona-toml.test.ts`
的 `Config({...})` 只做 schema 校验；`lykoi-wake/test/persona-toml.test.ts` 的
等价钉走 `loadPersona` 直调（本单未改）；`lykoi-gate` 的 `personaToml` 是 gate
自己的守护对象路径，与 decide 装载面无关，`lykoi-converse` / `lykoi-wake` 在
gate 测试里只作为**字符串**出现在清单/词表断言里，无 plugin apply。
`profile/cordis.yml` 里只有 converse 一条填了 `personaToml`（wake 条目未入 dev
profile），`cordis.prod.yml` 两条填的是同一个绝对路径
`/home/lykoi/runtime/persona/lykoi_base.toml`。

**结论**：无任何测试进程以两个**不同的合法** persona path 经插件链装载 ——
按签单风险注「若实勘无此形态则不加」，②本身**不需要**清缓存导出，迁移是纯粹的
`loadPersona(` → `getPersona(` 替换，零测试改动。

D-CP-3 的导出仍然加了，但理由不是②而是①：守卫的四条用例本身必须在一个进程里
走遍「空缓存 / 同 path / 同文件异写法 / 异 path / 坏 path」五种状态，共享同一份
模块级缓存，不清就只能靠书写顺序活着。生产代码路径零调用已核 ——
`grep -rn resetPersonaCacheForTest packages profile` 的全部命中只在
`packages/lykoi-decide/src/persona-toml.ts`（定义）与
`packages/lykoi-decide/test/persona-toml.test.ts`（调用与注释）。

### diff 摘要

`packages/lykoi-converse/src/index.ts`

- import 面 `loadPersona` → `getPersona`（该文件再无 `loadPersona` 使用点）。
- `:203` `loadPersona(resolve(config.personaToml))` → `getPersona(resolve(...))`，
  上方补三行 D-CP-1 理由注释。

`packages/lykoi-wake/src/index.ts`

- import 面 `loadPersona` → `getPersona`（同上，再无使用点）。
- `:414` 同样替换，D-FIX-1 原注释保留、下方补 D-CP-1 两行。
- 文件头 D-FIX-1 段里「本插件的装载面自此镜像 lykoi-converse：`loadPersona(
  resolve(config.personaToml))`」改写为 `getPersona(...)`，并注明「而且是同一份
  对象：getPersona 的进程级缓存 + path 守卫让『同一份』从偶然变成机制」——
  注释与代码不许对不上。

迁移后 `packages/*/src/` 里 `loadPersona` 的剩余命中只有 decide 自己的定义、
`getPersona` 内部那一次调用，以及两条提及它的注释。

---

## 判据③ · 全量收口

### `npm test`（仓库根，前台串行跑完）

退出码 **0**。逐包小计与汇总：

| 包 | tests | pass | fail | skipped |
|---|---|---|---|---|
| lykoi-adapter-telegram | 55 | 55 | 0 | 0 |
| lykoi-audit | 3 | 3 | 0 | 0 |
| lykoi-budget | 5 | 5 | 0 | 0 |
| lykoi-converse | 94 | 93 | 0 | 1 |
| lykoi-decide | 69 | 69 | 0 | 0 |
| lykoi-gate | 71 | 71 | 0 | 0 |
| lykoi-heart | 14 | 14 | 0 | 0 |
| lykoi-kernel | 193 | 193 | 0 | 0 |
| lykoi-learn | 68 | 67 | 0 | 1 |
| lykoi-llm | 3 | 3 | 0 | 0 |
| lykoi-llm-deepseek | 5 | 5 | 0 | 0 |
| lykoi-memory | 80 | 71 | 0 | 9 |
| lykoi-reflow | 31 | 31 | 0 | 0 |
| lykoi-regulation | 45 | 45 | 0 | 0 |
| lykoi-snapshot | 49 | 49 | 0 | 0 |
| lykoi-wake | 26 | 26 | 0 | 0 |
| **合计** | **811** | **800** | **0** | **11** |

对基线 **808 / 797 / 0 / 11** 的差：**tests +3、pass +3、fail 0（不变）、
skipped 11（不变）**。+3 全部落在 lykoi-decide，即判据①的 getPersona 用例从
1 条扩到 4 条的净增量；11 条 skipped 与基线同一批（converse 1 / learn 1 /
memory 9），本单未新增也未消除任何 skip。**零 fail，无需归因。**

原样末尾输出（`npm test` 最后一个包 lykoi-wake 的收尾）：

```
✔ SA-171：失败拍不驱动整合/专注 (48.155208ms)
✔ rest 拍端到端：安静合法、demote 不发生、计数为零 (46.322125ms)
✔ 推演零写入（SA-47）+ 对照组（SA-48）：read→candidates→messages→evaluate 全程零写 (57.840541ms)
✔ 同一时刻两次 read 逐字段相同 + 均零写（分发给 N 个分支的前提，DA-10 唯一前提） (220.756417ms)
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 739.089041
```

### `npx tsc --noEmit`（仓库根）

退出码 **0**，**标准输出与标准错误均为空**（tsc 无输出即无诊断）：

```
$ npx tsc --noEmit
$ echo $?
0
```

---

## forbidden 逐条核

| 条目 | 结果 |
|---|---|
| 不动 `loadPersona` 行为与签名（含错误 message） | 通过：函数体、签名、两条 message 模板一字未改；负例逐字钉照旧全绿 |
| 不动 gate / kernel / adapter / memory / heart 等邻接包 | 通过：本单三个 commit 只碰 decide / converse / wake 三包共 4 个文件 |
| 不动 `profile/*.yml` | 通过：零改动 |
| 不新增依赖、不改 package-lock | 通过：唯一新增 import 是 Node 内建 `node:path`；`package-lock.json` 与所有 `package.json` 零改动 |
| 不碰 m4-switch；不 push | 通过：全程只在 `wo/cache-persona`，无 checkout 其他分支、无 merge、无 push |
| 测试前台串行跑完再交卷 | 通过：decide → converse → wake 单包各跑一次，最后仓库根 `npm test` 一次，全部前台阻塞跑完读完 |

## 一处需要治理侧知悉的旁事（非本单改动）

建分支时工作副本是干净的；作业过程中
`governance/wo/WO-CORE-RETIRE/paste-retire.sh` 在工作区出现了一份**未暂存的**
修改（内容是 2026-09-01 首跑实录后的 v2 修订：mask 撞真单元文件的修法、crontab
重定向截断隐患、白名单 glob 展开）。它不属于本单范围，执行方**未 commit、未
revert、未触碰**，原样留在工作区。本单三个 commit 均以显式路径 `git add`，
未使用 `git add -A`。请治理侧确认那份改动的归属与去向。
