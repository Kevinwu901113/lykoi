# WO-M4-FIX-WAKE · 执行报告

> 执行：2026-09-01，Mac 本地 Opus 子 Agent，工作副本 `~/Documents/lykoi/lykoi-cordis`。
> 分支 `wo/m4-fix-wake`，基 = main `0db2183`。**未 push**（推送归治理侧）。
> 开工时工作树干净（唯一未跟踪文件 = 本单 order.md，已单独落签发 commit）。

## commit 序列

| commit | 判据 | 内容 | diffstat |
|---|---|---|---|
| `cf573cd` | — | 签发：工单入库 | `governance/wo/WO-M4-FIX-WAKE/order.md` +84 |
| `5a4195b` | ① | wake 配置面 persona → personaToml（D-FIX-1） | `packages/lykoi-wake/src/index.ts` +19 −8 |
| `383b656` | ② | 测试迁移 + fixtures/persona.toml + 两条负例 | 5 files, +147 −24 |
| `14c317a` | ③ | prod profile：wake 补 personaToml；learn 条目退役（D-FIX-2） | `profile/cordis.prod.yml` +13 −4 |
| （本 commit） | ④ | 全量收口 + 本报告 | `governance/wo/WO-M4-FIX-WAKE/report.md` |

---

## 判据① · wake 配置面（`5a4195b`）

`packages/lykoi-wake/src/index.ts`，三处实体改动 + 两处注释定案化：

**Config 接口**

```diff
-  /**
-   * persona 数据（parsePersonaData 的输入面）。TOML 装载器已在 lykoi-decide
-   * （loadPersona/getPersona，W5）；wake 入 cordis.yml 时（M3，W3 TODO⑤）由
-   * 治理配置面决定改配 personaToml 路径 —— 本插件当前不进 profile，不擅自改
-   * 配置形状。
-   */
-  persona: Record<string, unknown>
+  /**
+   * persona TOML 路径（owner 域；装载失败 = 启动即炸，SA-156 fail-fast）。
+   * 与 lykoi-converse 的同名配置项**同形同源** —— D-FIX-1（WO-M4-FIX-WAKE）：
+   * 装配面只给路径，persona 数据本身永远只有 owner 域 TOML 一个事实源。
+   */
+  personaToml: string
```

**Schema**

```diff
   dbPath: Schema.string().required(),
-  persona: Schema.any().required(),
+  personaToml: Schema.string().required(),
```

**apply**

```diff
-  const persona = parsePersonaData(config.persona)
+  // D-FIX-1：先天内核从 owner 域 TOML 装载（converse 镜像；SA-156 fail-fast ——
+  // 文件缺失/坏 TOML 抛 PersonaConfigError，不包不吞，病内核在启动时炸）。
+  const persona = loadPersona(resolve(config.personaToml))
```

**import 面**：`parsePersonaData` 在本包已无使用点（全仓核实：`grep -rn parsePersonaData
packages/` 命中只剩 lykoi-decide 自身与它的测试），从 `lykoi-decide` 导入清单去除，
换入 `loadPersona`。`resolve` 已在（dbPath 用），不新增 import。

**注释定案化**：文件头新增 D-FIX-1 段（记事故根因 + 单一出处理由 + 「与 converse
同装载器同姿态」），Config 接口注释整段重写。全文件已无「W3 TODO⑤ / 悬案 / 待定」
字样（`grep -n "TODO⑤\|悬案\|待定" packages/lykoi-wake/src/index.ts` 零命中）。

装载失败姿态**未包未改**：直接用 loadPersona 既有姿态 —— 文件缺失 →
`persona TOML not found: {path}`，坏 TOML → `persona TOML is not valid TOML: {exc}`，
字段不合格 → parsePersonaData 的逐条文案；一律 `PersonaConfigError`，启动即炸。

**该 commit 时点的 typecheck**（预期的、判据②迁移前的三处红）：

```
packages/lykoi-wake/test/kernel-e2e.test.ts(102,5): error TS2353: Object literal may only specify known properties, and 'persona' does not exist in type 'Config'.
packages/lykoi-wake/test/plugin.test.ts(76,5): error TS2353: Object literal may only specify known properties, and 'persona' does not exist in type 'Config'.
packages/lykoi-wake/test/plugin.test.ts(183,5): error TS2353: Object literal may only specify known properties, and 'persona' does not exist in type 'Config'.
```

src 自身零错 —— 三条全部落在测试调用点，由判据②收掉。

---

## 判据② · 测试迁移与负例（`383b656`）

### 新建 `packages/lykoi-wake/test/fixtures/persona.toml`

与 `test/fixture.ts` 的 `TEST_PERSONA` **逐字段等价、零省略**（五 section 全 16 个字段
全部落地）：

| section.字段 | TEST_PERSONA 值 | persona.toml 行 | TOML 构造 |
|---|---|---|---|
| `identity.name` | `'Lykoi'` | `name = "Lykoi"` | 基本字符串 |
| `identity.self` | `'我是 Lykoi（wake 测试形状件）。'` | 同值 | 基本字符串（含全角标点，子集内） |
| `identity.nature_known` | `true` | `nature_known = true` | 布尔 |
| `identity.embodiment` | `'test VM'` | `embodiment = "test VM"` | 基本字符串 |
| `voice.language` | `'zh'` | `language = "zh"` | 基本字符串 |
| `voice.register` | `'自然'` | `register = "自然"` | 基本字符串 |
| `voice.emoji` | `'克制'` | `emoji = "克制"` | 基本字符串 |
| `voice.address_owner` | `'Kevin'` | `address_owner = "Kevin"` | 基本字符串 |
| `voice.profile_ref` | `'default'` | `profile_ref = "default"` | 基本字符串 |
| `relationship.partner` | `'Kevin'` | `partner = "Kevin"` | 基本字符串 |
| `relationship.stance` | `'测试形状件。'` | 同值 | 基本字符串 |
| `relationship.evolution_anchor` | `'deepen'` | `evolution_anchor = "deepen"` | 基本字符串 |
| `relationship.owner_authority` | `'审批归 Kevin。'` | 同值 | 基本字符串 |
| `personality.traits` | `['直接']` | `traits = ["直接"]` | 字符串数组 |
| `personality.evolves` | `true` | `evolves = true` | 布尔 |
| `interests.seeds` | `['测试']` | `seeds = ["测试"]` | 字符串数组 |

**有意省略的字段：无。** `PersonaConfig` 的五 section 全部必填（`parsePersonaData`
逐条校验，缺一即 `PersonaConfigError`），所以「省略」在这里根本不是一个可选项 ——
少写一个字段，装载就炸。

**子集合规**：全文件只用了 `[section]` 表头、bare key、基本字符串、布尔、字符串数组、
`#` 注释 —— 全部在 `lykoi-decide/src/persona-toml.ts` 的严格子集内。零内联表、零点号键、
零日期、零多行字符串（那些会被 `parseTomlSubset` 大声拒绝进 "not valid TOML" 姿态）。
等价性不是靠肉眼，由下面的「等价钉」测试守住。

### 经 Config/apply 的三处调用点改喂路径

| 文件 | 处 | 改法 |
|---|---|---|
| `test/plugin.test.ts` | 2（六阶段一拍；W5 restart + G-7 器官清单） | 内联 persona 5 行表 → `personaToml: PERSONA_TOML` |
| `test/kernel-e2e.test.ts` | 1（三路自主动作经真门） | 同上 |

路径常量镜像 converse 侧既有写法：
`const PERSONA_TOML = new URL('./fixtures/persona.toml', import.meta.url).pathname`。
两个文件里 `TEST_PERSONA` 随之成为未使用 import，一并从 import 清单去除。

**不动的**：`test/learn-e2e.test.ts`（直接喂 `TEST_PERSONA` 对象给纯函数
`maybeRunIntegration` / `maybeRunFocusCycle`，不经 Config）、`test/wake.test.ts` /
`test/w3-wiring.test.ts` / `test/zero-write.test.ts`（走 `makeWakeDeps`，
persona 经 `stubMessageDeps()` 注入，同样不经 Config）。

`test/fixture.ts` 只加了 `TEST_PERSONA` 头上的一段注释（说明「两个入口、一份数据」
与等价钉的位置），常量本身**未动**。

### 新建 `packages/lykoi-wake/test/persona-toml.test.ts`（3 条）

1. **等价钉**：`loadPersona(fixtures/persona.toml)` `deepEqual` `TEST_PERSONA`
   —— 两份形状件不许漂（漂了，「经 Config 的测试」和「直接喂对象的测试」就在测两个
   不同的她）。
2. **负例①**：`wake.Config({ dbPath })` 抛 `ValidationError:
   $.personaToml missing required value`；反向再证给了路径就过校验、其余项缺省接得住
   （`route` 回落 `AUTONOMOUS_COGNITION`）。
3. **负例②**：`ctx.plugin(wake, { personaToml: '/nonexistent/lykoi/persona.toml', … })`
   拒绝，错误**是** `PersonaConfigError` 实例、message 逐字
   `persona TOML not found: /nonexistent/lykoi/persona.toml`；并断言炸完之后
   `ctx.get('wake') === undefined`（半个自我不许开机）。

实现注记：`ctx.plugin()` 返回 `Fiber`（thenable 而非 `Promise` 实例），
`assert.rejects` 会以 `ERR_INVALID_RETURN_VALUE` 拒收，故包一层 `async () => await …`。

### 负例红 → 绿自证

**红**（把 `src/index.ts` 用 `git checkout 0db2183 --` 退回判据①之前，其余不动，
重跑本文件）：

```
✔ 等价钉：fixtures/persona.toml 装载结果 === TEST_PERSONA（两份形状件不许漂） (0.941208ms)
✖ 负例①：缺 personaToml → Config 校验拒（ValidationError，装配面就炸） (0.387709ms)
✖ 负例②：personaToml 指向不存在的文件 → apply 抛 PersonaConfigError（不包不吞） (19.377583ms)
ℹ tests 3
ℹ pass 1
ℹ fail 2
```

两条失败的**实得值**正是事故那一句：

```
负例①  actual: ValidationError: $.persona missing required value
       expected: /\$\.personaToml missing required value/
负例②  AssertionError: 期望 PersonaConfigError，实得 ValidationError: invalid config:
         - $.persona missing required value (at persona)
```

也就是说：修改前，wake 的必填项是 `persona`，`personaToml` 连一个被校验的名字都不是；
把不存在的 TOML 路径喂进去，插件根本走不到装载那一步 —— 先被 `$.persona missing
required value` 拦在校验期。这正是 2026-09-01 00:54 切换窗 loader 阶段
AggregateError 的第一条根因，被本测试逐字复现。

**绿**（恢复判据①的 src 后，同一文件同一命令）：

```
✔ 等价钉：fixtures/persona.toml 装载结果 === TEST_PERSONA（两份形状件不许漂） (0.835833ms)
✔ 负例①：缺 personaToml → Config 校验拒（ValidationError，装配面就炸） (0.272792ms)
✔ 负例②：personaToml 指向不存在的文件 → apply 抛 PersonaConfigError（不包不吞） (22.94075ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

单包 `npm test -w lykoi-wake`：**26 过 / 0 挂**（基 23 + 本单 3）。

---

## 判据③ · prod profile（`14c317a`）

```diff
-# ---- 自主侧（wake / learn）---------------------------------------------------
+# ---- 自主侧（wake）-----------------------------------------------------------
 # 同样受 R-01 约束（写同一个 state 库）。
+#
+# **这里没有 learn 条目，是定案不是缺件**（D-FIX-2，WO-M4-FIX-WAKE）：
+# `lykoi-learn` 是**纯库**（整合/专注的 re-export 桶，没有 apply），它的驱动位在
+# wake —— SA-171：一拍 completed 之后由 wake 串行驱动整合与专注，各自吞掉异常。
+# 曾经这里挂过一条 `- id: learn / name: lykoi-learn`，那条从第一天起就是错的：
+# 一被翻开 loader 就 `invalid plugin, expect function or object with an "apply"
+# method`（2026-09-01 00:54 切换窗事故的两条根因之一）。修法是删掉条目，
+# 不是给一个库套插件壳。
 - id: wake
   name: lykoi-wake
   disabled: true
   config:
     dbPath: /home/lykoi/state/memory.db
+    # 人格 TOML：与 converse 段**同一个文件**（D-FIX-1）—— 醒着的她和聊天的她
+    # 读同一份先天内核，装配面只给路径，数据本身只有 owner 域 TOML 一个事实源。
+    # root 属主 444、父目录 root；完整性门检查项②③⑤三处核它。
+    personaToml: /home/lykoi/runtime/persona/lykoi_base.toml
     route: deepseek
     model: deepseek-chat
     checkIntervalMs: 5000
-- id: learn
-  name: lykoi-learn
-  disabled: true
```

- `disabled: true` **保持**（翻位永远只在 m4-switch —— 本单不碰翻位，D-FIX-3 归治理侧）。
- 路径与同文件 converse 段的 `personaToml` **逐字相同**
  （`/home/lykoi/runtime/persona/lykoi_base.toml`，第 101 行），即同一个 root 属主文件。
- `profile/cordis.yml`（dev）**未动** —— dev 本来就没有 wake 条目，维持。

---

## 判据④ · 全量收口

工作树干净（`14c317a`），前台串行跑完。

**`npm test`（workspaces 全量）原样末尾输出**：

```
✔ SA-171：失败拍不驱动整合/专注 (17.310917ms)
✔ rest 拍端到端：安静合法、demote 不发生、计数为零 (18.826166ms)
✔ 推演零写入（SA-47）+ 对照组（SA-48）：read→candidates→messages→evaluate 全程零写 (88.987334ms)
✔ 同一时刻两次 read 逐字段相同 + 均零写（分发给 N 个分支的前提，DA-10 唯一前提） (178.353833ms)
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 731.921875
```

（`npm test` 逐 workspace 串行，末尾块是最后一个包 lykoi-wake；退出码 0。）

**十六个包合计**：

| 包 | tests | pass | fail | skipped |
|---|---|---|---|---|
| lykoi-adapter-telegram | 55 | 55 | 0 | 0 |
| lykoi-audit | 3 | 3 | 0 | 0 |
| lykoi-budget | 5 | 5 | 0 | 0 |
| lykoi-converse | 94 | 93 | 0 | 1 |
| lykoi-decide | 66 | 66 | 0 | 0 |
| lykoi-gate | 63 | 63 | 0 | 0 |
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
| **合计** | **800** | **789** | **0** | **11** |

**`npx tsc --noEmit`**：退出码 0，**输出 0 字节**（全绿；tsc 全绿时不打印任何东西）。

### 与 797 基线的归因

- 本机（Mac）跑到的是 **800 tests = 789 pass + 11 skipped + 0 fail**。
- 11 条 skip **全部是环境闸**，与本单无关：`LYKOI_DEVSTATE_DB` 未注入 → devstate 副本
  缺席时 skip 不 fail（lykoi-memory 9 条、lykoi-converse 1 条、lykoi-learn 1 条；
  skip 理由字符串逐条自带 `# LYKOI_DEVSTATE_DB 未注入`）。有 devstate 副本的机器上
  这 11 条会跑并通过。
- 本单只增不减：`packages/lykoi-wake/test` 基（`0db2183`）**23 条** → 现 **26 条**
  （逐文件核对：clock 2 / kernel-e2e 1 / learn-e2e 2 / plugin 2 / w3-wiring 5 /
  wake 9 / zero-write 2 = 23；新增 persona-toml 3 条 = 26）。其余 15 个包一行未动。
- 故基线总数 = 800 − 3 = **797**，与工单记的 W1 基线 **797 过 / 0 挂**逐数吻合。
  本单交付后：**800 / 0 挂**。
- **零失败，故无失败需归因**；[[lykoi-test-clock-timebomb]] 的定时炸弹型无常失败本次
  未出现（跑于 2026-09-01 01:22 CST，wake 夹具日期 `T0 = 2026-08-24T10:00:00Z`，
  未触边界）。

---

## 侦查发现（工单范围外，不擅自改，留治理侧裁决）

1. **文档三处仍写着 learn 条目 / 七个位**（D-FIX-2 落地后已成陈述性错误）：
   - `docs/deploy.md:28`「七个器官位（deepseek / memory / converse / wake / learn /
     telegram×2）」→ 现为六个位。
   - `docs/deploy.md:349`「`profile/cordis.prod.yml` 里七个位默认 `disabled: true`」
     → 现为六个。
   - `docs/deploy.md:358` 表格行「`wake` / `learn` | 同 memory（写同一个 state 库…）」
     → learn 不再是 loader 条目。
   - `docs/m4_handoff.md:51`「`memory` / `converse` / `wake` / `learn` 四条全部…」
     → 现为三条。
   注意 `docs/m4_handoff.md` 在 `lykoi-gate/src/surface.ts` 的 `PINNED_DOCS` 内
   （治理常数 hash-pin 面），改它按 WO-P5-PREREG-01 纪律要走「出新版本文件 + root
   重签」。**本单一字未动这两个文件。**
2. **`profile/cordis.prod.yml` 在 GK-13 受保护面内**
   （`lykoi-gate/src/surface.ts` 的 `PROFILE_ROOT_OWNED_FILES`）。判据③改了它 ⇒
   生产侧需 **root 重签清单**，否则完整性门会以哈希不符拦下。这是本单落地的运维前置，
   与 D-FIX-3（m4-switch 重钉）同一波处理为宜。
3. **wake 与 converse 现在共用同一份 persona TOML 的进程级读法不同**：converse 与 wake
   都调 `loadPersona`（每次真读文件），而 `getPersona`（进程级缓存，SA-156 的
   「改 TOML 需重启」契约）**两个插件都没用**。同进程装两个插件 = 同一文件读两遍。
   行为上无差（同文件同结果、fail-fast 姿态相同），但「每进程恰一份内核」这条契约
   目前靠的是文件不变而不是缓存。**本单不动**（改它会同时碰 converse，越 forbidden）
   —— 记在这里供治理侧决定要不要单开一条收口。

## forbidden 自查

| 条 | 状态 |
|---|---|
| 不动 `packages/lykoi-learn/` 任何文件 | 通过：零改动（`git diff 0db2183..HEAD --stat` 无该目录） |
| 不动 kernel / gate / heart / converse / decide 等邻接包 | 通过：零改动；decide 只 import（`loadPersona`），未改 |
| 不动 `profile/cordis.yml` 与 `profile/index*.ts` | 通过：零改动 |
| 不新增依赖、不改 package-lock | 通过：`package.json` / `package-lock.json` 均未动 |
| 不碰 m4-switch 分支 | 通过：全程未 checkout、未 merge、未改 |
| 不 push | 通过：未 push（本地分支领先 main 4 个 commit，无 upstream） |
| 测试前台串行跑完再交卷 | 通过：全量 `npm test`（退出码 0）+ `npx tsc --noEmit`（退出码 0）跑完后才写本报告 |
