# WO-E4-1 · report —— 合成测试实例包与七份夹具收敛

- 分支 `wo/e4-1`（基线 main@0272583）。代码提交 0242a43；本 report 为分支尾提交。
- 执行方：主治理 Agent 自执行（Kevin 令：不派 GPT）。
- 结论：**零运行时改动**（`packages/*/src` 零文件），七份 persona 夹具收敛为一份合成 TOML，四个 TS 常量全部由它派生；全量 1159/1148/0/11，typecheck 净；验收 grep 93 → 60，persona 派生的 33 处归零，剩余 60 处全在本单 D 项之外（分类见 §4）。

## 1 · 交付

| 文件 | 动作 | 说明 |
|---|---|---|
| `packages/lykoi-decide/test/fixtures/instance/persona.toml` | 新增（由 `fixtures/lykoi_base.toml` git mv 后改写） | 唯一一份 persona 夹具，全合成值（name=Fixture / partner=Owner / address_owner=Owner / embodiment="test VM" / 自述"合成测试人格"）；sha256 `2fa95624bc9071f4…` |
| `packages/lykoi-decide/test/fixtures/lykoi_base.toml` | 删除 | 旧路径不再存在（见 §6 ①） |
| `packages/lykoi-converse/test/fixtures/persona.toml` | 删除 | 目录随之消失 |
| `packages/lykoi-wake/test/fixtures/persona.toml` | 删除 | 目录随之消失 |
| `packages/lykoi-decide/test/persona-fixture.ts` | 改 | `FIXTURE_PERSONA_TOML`（`import.meta.url` 相对）+ `FIXTURE_PERSONA = loadPersona(FIXTURE_PERSONA_TOML)`；`FIXTURE_PERSONA_DATA` 仍由它派生 |
| `packages/lykoi-converse/test/fixture.ts` | 改 | `FIXTURE_PERSONA_TOML = ../../lykoi-decide/test/fixtures/instance/persona.toml`；`FIXTURE_PERSONA = loadPersona(...)`；删手写常量 |
| `packages/lykoi-wake/test/fixture.ts` | 改 | `TEST_PERSONA_TOML` 同上；`TEST_PERSONA = loadPersona(...)`；删手写小型形状件 |
| `packages/lykoi-learn/test/fixture.ts` | 改 | `INSTANCE_PERSONA_TOML` 同上；`PERSONA` 的 name/partner 由 TOML 正文标量读出（§5 ①） |
| converse 6 测试（wire / e2e / kernel-e2e / w3-organs / approval-e2e / llm-finish） | 改 | `PERSONA_TOML = FIXTURE_PERSONA_TOML`（原各自 `new URL('./fixtures/persona.toml')`） |
| wake 3 测试（kernel-e2e / plugin / persona-toml） | 改 | `PERSONA_TOML = TEST_PERSONA_TOML`；plugin.test.ts:93 断言改读 `TEST_PERSONA.identity.name`；persona-toml 等价钉改为"路径落在 instance 包 + 装载结果 === TEST_PERSONA" |
| `packages/lykoi-decide/test/persona-toml.test.ts` | 改 | 首条改为**合成值守卫**（§2 D-2）；sha 钉重算；:128/157/159/169 改读 `FIXTURE_PERSONA.identity.name` / `+ '_other'` |
| `packages/lykoi-decide/test/prompt.test.ts` | 改 | SA-154 钉面重算（§3），embodiment 断言改读夹具；`DECIDE_SYSTEM_PROMPT` 钉未动 |
| `packages/lykoi-converse/test/assemble.test.ts` | 改 | :65 `startsWith('我是 Lykoi，')` → 模板读 `FIXTURE_PERSONA.identity.name`；标题去掉旧 sha 前缀；无 persona 渲染 sha 钉（核过） |
| `packages/lykoi-learn/test/prompt.test.ts` | 改 | 两条身份守卫钉面重算（§3） |
| `packages/lykoi-learn/test/l2.test.ts` | 改 | :163 伴侣名断言改读 `PERSONA.relationship.partner` |

22 文件，+155 / −260。`packages/*/src`、`docs/`、`profile/`、`deploy/`、`package.json` 零改动。

## 2 · D 项落实

| D | 落实 |
|---|---|
| D-1 一份 TOML | `fixtures/instance/persona.toml` 一份；converse / wake 副本删除。跨包读取**未被 workspace 布局阻碍**：各包 test 与 lykoi-decide 同为 `packages/` 下兄弟目录，`new URL('../../lykoi-decide/test/fixtures/instance/persona.toml', import.meta.url)` 直接可达，故**不留逐字节副本**，也不需要三份 sha 对拍测试 |
| D-2 TS 常量派生 | decide / converse / wake 三处 = `loadPersona(<夹具路径>)`（`loadPersona` 是 lykoi-decide 公开导出，三包都已依赖它）；learn 的 `PERSONA` 只需 name/partner，从同一 TOML 正文读标量（§5 ①）。手写第二份真相归零。附加：persona-toml.test.ts 首条改为合成值守卫——去注释正文里出现的英文专名集合 **恰等于** `['Fixture','Owner','VM']`，且**不含任何数字**（挡主机号 / vmid / 日期回流） |
| D-3 字符串断言 | :128 `text.replace(\`name = "${name}"\`, \`name = "${name}_other"\`)`；:157 `FIXTURE_PERSONA.identity.name + '_other'`；:159 / :169 `FIXTURE_PERSONA.identity.name` |
| D-4 sha 变更表 | §3 |
| D-5 目录 | `packages/lykoi-decide/test/fixtures/instance/` 建立，文件头注明 E4-2 加 `seeds.toml`、E4-4 加 `deploy.toml` |

## 3 · sha 变更表（G-2）

装配函数 / 模板一字未动；变的只是输入（夹具）。

| 钉面 | 位置 | 旧 | 新 |
|---|---|---|---|
| persona 内核九段（SA-154，输入 `buildPersonaKernel(FIXTURE_PERSONA)`） | `packages/lykoi-decide/test/prompt.test.ts` + `persona-toml.test.ts` 文件侧对拍 | chars=401 sha256=`1f5960b79d5e5251ba9be96922806879cd7d434e7ae0e52a6bc57fec1b5bec71` | chars=367 sha256=`72b48e63ea01e3e214f6bcae7a17ae6c34fff815e603697a01ca63842814f43f` |
| integration 身份守卫（`integrationIdentityGuard(PERSONA)`，吃 name/partner） | `packages/lykoi-learn/test/prompt.test.ts` | 40 字符 `ce69ae2ae060645af4ee593f0e8d57d04da077675227bb81442ac07a49c0ae2a` | 42 字符 `c813d5ec8543754db0e7fa0cd54e6caf9e7afdaa57db1a799e62a3edd1db27a0` |
| focus 身份守卫（`focusIdentityGuard(PERSONA)`） | 同上 | 43 字符 `79577116796a009c3841724b3691f3a65f7dbb05f828e808e2d0e2d14d2635ae` | 45 字符 `4d0c8df6b2c3c60177bb7a80d8fe2fac438a19f2a78c23f66b1bbe3cf8505d36` |

后两行不在 order 点名范围内，但与内核钉同性质（钉的是"模板 × 夹具"的渲染结果，夹具一换必变）；按 order §0 的原则——吃夹具的钉允许变、不吃夹具的不得变——一并重算。**未动**：`DECIDE_SYSTEM_PROMPT`（1601 / `d54726e3…`）、converse `prompts.test.ts` 15 条常量钉、learn 三条系统提示词钉（INTEGRATION / FOCUS / STAGED）。

## 4 · 验收读数

| 项 | 基线（main@0272583） | 本分支 |
|---|---|---|
| `npm test`（tests/pass/fail/skipped） | 1159 / 1148 / 0 / 11 | 1159 / 1148 / 0 / 11（用例数不变：改写而非新增） |
| `npm run typecheck` | 净 | 净 |
| `grep -rn "Kevin\|lapwing\|vmid" packages/*/test` | 93 行 / 35 文件 | **60 行 / 29 文件** |
| 其中 persona 夹具派生（A3 七份 + 吃夹具的断言） | 33 | **0** |
| 夹具副本数 | 7（TOML 3 + 手写 TS 4） | **1**（TOML 1；TS 4 处皆为派生值，非副本） |
| 触及 manifest 域 | — | **否**（src 零改动，root 域零改动；117 不变） |

中途读数：首轮全量 2 失败（learn 两条身份守卫钉，§3 后两行），重算后归零。

**验收 1 部分达成**：persona 派生的命中归零；剩余 60 处均在本单 §1 事实表之外，按性质分三类：

| 类 | 数 | 位置 | 为什么本单不动 |
|---|---|---|---|
| A · src 字面量镜像（断言期望值由 `packages/*/src` 里含 Kevin 的模板/常量产出） | 20 | outbound:258；assemble:68；candidates:52,57,64,162；prompt(decide):92,95；seed:81；organs:54,55；l5:212；untrusted:26；cheap-tick:39,118；conversation-turn:35；reflow:263；snapshot read:183；restart:67,75 | 改断言必先改 src（order §3 不动 src）；正是 E4-SPEC §3.1 / E4-3 的 15 处运行时字面量 |
| B · 自由测试数据（绑定 display_name、经验/叙事正文、`--owner-name`、入站文本） | 29 | adapter:228；assemble:53,213,220,350,356,373；schema-registry:56,177；organs:28,44,83；l4-overlay:134,232,277,308；l2:68,177,190,243,359,372,385；l4:100；l1:50；init-state:138,191,208；learn-e2e:50 | 不是 persona 副本，不在 §1 表；可单独一次小单机械替换为 "Owner"（无钉面牵连，估 29 行 / 12 文件） |
| C · 注释 / 用例标题 / 断言说明文字 | 11 | outbound:74,679；wire:112；kernel-e2e:216,220；approval-e2e:169；bootstrap-preauth:94；grants-pending:39；notifications-queue:179；delegation:243；l5:82 | 与第一实例的关系是"讲历史"，验收允许 |

## 5 · 偏离与执行方选择

1. **learn 的 `PERSONA` 不经 `loadPersona`**：lykoi-learn 的 package.json 不依赖 lykoi-decide（依赖方向是 decide 不依赖 learn，learn 只依赖 regulation/memory），加依赖越界（不改 package.json），走根 node_modules 的未声明 import 是暗道。改为 `instanceScalar(section, key)`：读 TOML 正文，按 `\n[section]\n` 切段、`^key = "…"$` 取值，缺则抛。只取 name/partner 两个基本字符串，够用且零依赖。
2. **兴趣种子未改**：`[interests] seeds = ["穿搭","摄影","游戏","影视"]` 保留——`seed.test.ts:36/63/67` 按标题断言这四个，且它们是泛化爱好词，不指向个体；E4-2 做 `seeds.toml` 时一并合成化更顺（§6 ④）。
3. **超出四个点名字段的合成化**：`voice.register` 去掉"像一个普通女性那样说话"（性别是实例事实）；`relationship.stance` 改为"Owner 是我的所有者，也是我最常打交道的人…"（"伴侣"是第一实例的关系定性）；traits 中"和 Kevin 意见不合时"→"和 Owner"。其余 traits 为泛化人格短语，保留以维持内核多行 traits 的形状。
4. **wake 的 TEST_PERSONA 由"独立小型形状件"变为完整合成人格**：小型件存在的唯一理由是"第二份副本必须小到能手抄"，副本消失后理由不成立。wake 全部用例不改即绿（仅 plugin.test.ts:93 的名字断言改读夹具）。
5. **persona-toml.test.ts 首条改为合成值守卫**：原"TOML 装载 === persona-fixture 数据（同一数据两形态）"在常量派生自文件后成为恒真式，换成有约束力的守卫（§2 D-2）。
6. 两条 learn 身份守卫钉重算（§3 说明）。

## 6 · 发现与候选

1. **`profile/cordis.yml:55`（dev profile，converse 条目，`disabled: true`）仍指向已删除的 `packages/lykoi-decide/test/fixtures/lykoi_base.toml`**。order §3 不动 `profile/`，本单未改。影响：dev 入口若把 converse 条目打开，`loadPersona` 抛 `persona TOML not found`（fail-fast，不静默）；默认 dev 启动该条目是关的，不受影响；生产 `cordis.prod.yml` 指 `/home/lykoi/runtime/persona/lykoi_base.toml`，无关。修法一行：`personaToml: packages/lykoi-decide/test/fixtures/instance/persona.toml`。注意 `profile/cordis.yml` 属 gate root 域（manifest.test.ts `domainOf` = root），改它要重签 manifest——建议 Kevin 合并本单时顺手改，或并入 E4-4（deploy.toml 单）。
2. `docs/deploy.md:257-258` 自认 `lykoi_base.toml` 是"仓库里唯一一份完整 persona TOML"，路径已失效；docs 边界，归 E4 文档批（E4-SPEC §3.5）。
3. 剩余 60 处 grep 命中的三类归属见 §4：A 类 20 处随 E4-3 的 src 字面量投影一起走；B 类 29 处可开一次机械替换小单；C 类 11 处不动。
4. persona 兴趣种子四词与 `seed.ts:75-77` 记忆种子一起在 E4-2 合成化。
5. `packages/lykoi-gate/test/fixture.ts:119-120` 有一份名为 `persona/lykoi_base.toml`、内容 `name = "lykoi"` 的**门面夹具**（模拟生产规范路径 `PERSONA_TOML_CANONICAL` 的属主/权限），不是 persona 副本，本单未动、也不该动（gate 特权层）。
6. 服务器侧 `npm test`（落地 7a 步）会走同一相对路径；服务器 checkout 与本地布局相同（`packages/` 兄弟目录），无需额外处理。

## 7 · 落地要点

- 零 src、零 root 域、零迁移、零依赖变更：本单**不需要单独落地**，随下一次 landing（LANDING-S，EXPECT_OLD = 257a72e）顺带上线；manifest 117 不因本单变化。
- 合并后请把 §6 ① 的一行 profile 修正列入 Kevin 决断。
