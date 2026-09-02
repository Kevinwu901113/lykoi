<!-- 治理侧归档：执行 Agent（opus）2026-09-02 停工上报，逐字自其最终消息抄录，未改一字。
     治理裁定：D-2 走路 B（rw.ts 正本 + shared.ts 副本 + boundary.test.ts 对拍一行），
     章程 D-2 已同日修订，执行方按修订版续跑。 -->

# WO-PERS-OVERLAY-01 · 停工上报（章程 §2 D-2 与既有静态边界守卫硬冲突）

## 0. 结论先行

**已停工，零代码改动。** 依执行纪律第 8 条（"对章程任何一条有异议：停工，在最终消息里写偏离表上报，**不得先做**"）。

冲突点：章程 **D-2** 要求 `l4.ts` 从 `'lykoi-memory/rw'` **值导入** `RELATIONSHIP_INSIGHT_CATEGORY`。该导入**必然**触红既有测试 `packages/lykoi-learn/test/boundary.test.ts:44-53`（learn src import 面静态守卫），且要求把 `lykoi-memory` 从 learn 的 devDependencies 提为 dependencies，从而与 `packages/lykoi-memory/package.json:24` 构成**声明层循环包依赖**。两者都是架构级不变量，非执行方可自裁。请治理侧在 §5 三选一（见 §4）后重新派发；除 D-2 外章程其余各条我均无异议，裁定后可一次跑完。

## 1. 基线（已实测，章程 §4 要求）

在 worktree `/private/tmp/claude-501/-Users-wukevin-lykoi/e0991a0a-2b0d-4614-93b6-0e37476de6d3/scratchpad/wo-pers-overlay`，分支 `wo/pers-overlay`，HEAD `5f22e8ead4e4462fcc52fa016c1ad0f35d4b0898`（= 章程签发提交，代码面 = 89b04dd）：

- **全量测试 `npm test`：退出码 `0`**。逐包 `ℹ fail 0` 共 **16** 个包，无一例外（`ℹ cancelled 0` 同为 16）。
- 合计：`ℹ tests` 求和 = **880**（100+111+14+194+29+3+35+45+49+5+5+55+6+72+78+79）；`ℹ pass` 求和 = **869**；`fail` = **0**；`skipped` = **11**（13 包 0 + 2 包各 1 + 1 包 9）。
- **与章程基线 880/869/0/11 逐值相符。**
- **`npx tsc --noEmit`：退出码 `0`**（净）。
- 工作树 clean：`git status --porcelain` 零输出。父 sha `b6fc33e54805455fdc7b9cb2f79c1548f63619ce`。
- 无提交、无 push、无 merge；未触碰 `~/Documents/lykoi/`、未打开 `lykoi-cordis-devstate/`、无 ssh、无联网、未读任何 env/secrets。

## 2. 冲突取证（可复核，全部 文件:行）

**（a）learn src import 面是被测试静态钉死的架构不变量**

`packages/lykoi-learn/test/boundary.test.ts:44-53`：

```
test('包 import 面：learn src 只 import lykoi-regulation 与包内文件（store 全走结构化接口）', () => {
  const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.ts'))
  ...
      assert.ok(spec === 'lykoi-regulation' || spec.startsWith('./'),
        `${file}: 越界 import '${spec}'（learn 的 store 面只能是注入的结构化接口）`)
```

`SRC_DIR` 覆盖 `packages/lykoi-learn/src/` 全部 `.ts`（含 `l4.ts`）；`importSpecifiers` 为 `/from '([^']+)'/g`，对 `'lykoi-memory/rw'` 两个分支**均不成立**。故 D-2 的导入落地即为该断言的确定性红。这不是巧合而是设计：同文件 :6-7 的头注写明"包 import 面：learn src 只许 lykoi-regulation + 包内文件"与"词汇/格式副本与 lykoi-memory 导出的逐字相等（**shared 里为守 import 面持副本**）"。

**（b）现体已有一套为此而生的既定范式**

`packages/lykoi-learn/src/shared.ts:108` 一带持有 `LINEAGE_PRODUCT_*` / `LINEAGE_SOURCE_*` 的**副本**，其与 rw 导出的逐字相等由 `boundary.test.ts` 末段"副本对拍"测试断言。即：**"rw.ts 是正本 + learn 持副本 + 测试钉逐字相等"** 是本仓对"learn 要用 rw 的一个常量"这件事的现成答案，而 D-2 选的是另一条路。

**（c）D-2 的依据"learn 已依赖 lykoi-memory 包"与事实有出入**

`packages/lykoi-learn/package.json`：`dependencies`（:14-16）**只有** `lykoi-regulation`；`lykoi-memory` 在 **`devDependencies`**（:17-19）。运行期值导入要求把它提为 `dependencies`，而 `packages/lykoi-memory/package.json:24` 的 `dependencies` 含 `lykoi-learn` —— 提权后即为**声明层循环包依赖**。

补充事实（对治理侧择路有用）：**ESM 模块图不成环**。`rw.ts:38` 只 import `'lykoi-learn/l1'`，而 `packages/lykoi-learn/src/l1.ts` **零 import**（该文件 :19-21 自注"本模块零 import，是整个学习环的最底层叶子"）。故 D-2 若被裁为"照做"，**运行期不会炸**，代价纯粹是上述两项声明/守卫层的架构不变量。

## 3. 偏离表

| # | 位置 | 原文要求 | 实际做法 | 理由 |
|---|---|---|---|---|
| 1 | 章程 §2 **D-2** | "`l4.ts` 从 `'lykoi-memory/rw'` 值导入"；"（learn 已依赖 lykoi-memory 包）"；"字面量 `'relationship'` 在 src 只出现一次" | **未做，停工上报** | 与 `boundary.test.ts:44-53` 硬冲突（确定性红，违 §4"新增只增不减、全绿"）；且要求 learn 的 `lykoi-memory` 由 devDependencies 提为 dependencies，与 `lykoi-memory/package.json:24` 构成循环包依赖。两项均为架构级不变量，超出执行方裁量；依纪律 8 不得先做 |
| 2 | 全单（D-1/D-3..D-9、§3 交付项 1-4） | 各项交付 | **未做** | 交付项 2（l4.ts 类别选择）以 D-2 的常量导入为前置；§3.4 判据 ①-⑧ 全部经 `runFocusCycle` 断言，同样以 l4 落地为前置。只交付 rw/converse 会留下一支端到端不成立、判据无法钉死的分支，故整单停在裁定前 |

**除上述外无偏离**：章程 §2 其余定案、§5 forbidden 全部条目均未触碰（零文件改动即为证明）。

## 4. 请治理侧裁定（三条路，执行方不自选）

- **路 A（D-2 字面照做）**：改 `boundary.test.ts:49` 的白名单放行 `'lykoi-memory/rw'`，并把 learn 的 `lykoi-memory` 提为 `dependencies`。代价：放宽"learn 的 store 面只能是注入的结构化接口"这条守卫的**静态**保证（结构化接口本身不受影响——只是常量导入开了口），并落一条声明层循环包依赖。收益：D-2 的"字面量只出现一次"成立。
- **路 B（走现体既定范式）**：`RELATIONSHIP_INSIGHT_CATEGORY` 正本仍定义在 `rw.ts`（D-2 前半句不变），`l4.ts` 用 `shared.ts` 副本，`boundary.test.ts` 的"副本对拍"测试**增一行**断言副本 ≡ `rw.RELATIONSHIP_INSIGHT_CATEGORY`。代价：字面量在 src 出现两次（但由测试钉死逐字相等，漂移不可能沉默）。收益：两条架构不变量一个不动，import 面守卫保持满强度。**这是与 `LINEAGE_*` 六常量完全同构的处理，执行方倾向此路，但听裁定。**
- **路 C**：把类别常量经注入的 `FocusStore` 结构化接口下发。代价：把一个编译期常量做成运行期 store 面，语义比前两路都差；仅列出以求完备，不建议。

裁定后请回执一句（"D-2 走路 X"）即可，我按原章程其余各条一次跑完并按 §6 全项交付报告。

## 5. §6 报告项状态（逐条）

零代码改动，故：尖 sha = 父 sha 之外无新提交（HEAD 仍 `5f22e8e`，工作树 clean 已证）；`diff --stat` 空；`name-only` 滤网空。全量测试退出码 `0` / 逐包 `ℹ fail 0`×16 / 合计 880/869/0/11、tsc 退出码 `0` —— 均已在 §1 给出（此为基线值，非交付后值）。

**一项可先行交付的实测值**（章程 §6 要求，与 D-2 争议无关，供 B 表第 14 条直接使用）：`RELATIONSHIP_OVERLAY_HEADER` 按 D-5 逐字文本 `你和眼前这个人相处的方式(专注思考里得出、已经站住、只关于这个人的结论):\n`（末尾一个换行）实测 —— **chars（码点）= 38**，**sha256 = `a0553be7100bd34013ac54ac67b11e3628beb5d0b3e48c3f5f9ac2b2b674c22e`**。

五条既有提示词/守卫 sha 不变：本次零改动，`prompts.test.ts` / `prompt.test.ts` 在基线全绿中通过，逐字保持。

learn src 首次运行期导入 lykoi-memory 的说明：**即本次停工的争议本体**，取证见 §2。
