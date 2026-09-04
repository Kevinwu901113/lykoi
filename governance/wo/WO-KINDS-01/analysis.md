# WO-KINDS-01 · 自主决策 KINDS 评估与收敛方案（分析稿）

- 执行方：主治理 Agent（本窗口自执行）。日期：2026-09-05。分支：`wo/kinds-01`。
- **零代码改动。** 产物只有本稿与只读脚本 `count-kinds.sh`。
- 依据：Kevin 裁定 R-B（E1 = 评估并收敛，不废）；`governance/wo/PROBE-CAP-01/report.md` §5.2/§5.3、§6。

## 1 · 七个自主 kind 的现状表

`KINDS` 定义在 `packages/lykoi-decide/src/index.ts:61-64`，**数组序即候选表渲染序**（同文件 :56-60 注释：集合无序会让候选表非确定，不得改用集合）。

| kind | 内容必填 | reflow 分支做什么 | kernel action | 对应 `TOOL_TABLE` 行 | 产线 30 天次数 |
|---|---|---|---|---|---|
| `explore` | 否（要 `url`） | `src/index.ts:331-356`：无 `url` 即 failed（SA-58）；有则 dispatch 读正文，成功才泄 explore 饥饿（SA-59） | `research_browser.read_text` `{url}` | `research_read_text`（同一 action，`contract.ts:192`） | 待 Kevin |
| `record_note` | 是 | `:316-322`：`appendAutonomyNote(runId,'reflection',content)`，无 try/except，抛则整拍 failed | 无（只写 store） | 无 | 待 Kevin |
| `queue_notification` | 是 | `:388-410`：dispatch 入队；`queued` 才计通知配额（SA-57）；被脑干拦下算 completed（SA-62） | `autonomy.queue_notification` `{summary, run_id}` | `notify_owner` → `notify.owner`（`contract.ts:203`，**不同 action 名**） | 待 Kevin |
| `initiate_chat` | 是 | `:366-387`：dispatch 主动开口；回执只报"已交给投递"，不许诺送达（SA-61，明文不得回退） | `autonomy.initiate_chat` `{content, run_id}` | 无（对话侧没有"主动开口"，它本来就在对话里） | 待 Kevin |
| `tend_inner` | 是 | `:323-330`：`tendInner()`；只有 `ValueError` 记 failed，其余抛出 | 无（只写 store） | 无 | 待 Kevin |
| `rest` | 否 | `:308-311`：`applyRegulationCause('rested')`；**唯一不记 `action_taken` 的 kind**（:315 SA-54） | 无 | 无 | 待 Kevin |
| `contemplate` | 否（**刻意豁免**，`decide:66-73`） | `:357-365`：什么都不做，产出在 `inner` 块、由 wake 在本函数返回后 `applyInner` 落地 | 无 | 无 | 待 Kevin |

未知 kind 落 `:411-427`：`unknown_decision_kind` 审计 + `capability_gap`（`GAP_NO_EXECUTION_BRANCH`）+ failed。这条分支是 G-1 定案：活体这里曾是 `else` 兜底，把没加分支的新 kind 默默变成一条发给所有者的通知，`contemplate` 踩过（107 拍里 18 条成了真通知）。**任何收敛方案都不得让这条兜底回来。**

计数怎么来：一拍结束落一条 `autonomy_wake` 审计事件，字段 `decision` 就是 kind 名（`packages/lykoi-wake/src/index.ts:415-421`；`auditLogEvent` 把事件名放进 `type`，同文件 `:113`）。脚本见 §6。

## 2 · 两套投影的差异清单

对话侧 `CONVERSATION_KINDS = reply, silence, tool_call, promise_followup`（`packages/lykoi-converse/src/contract.ts:41`），消费点在 `conversation.ts:1055-1097` 的链式 if。两套无交集。

### 2.1 路径性质决定的差异（不该收敛掉）

1. **有没有对端。** 对话侧永远有一个"这一轮要不要出声"的对象，所以安全落点是 `silence`（`contract.ts:47`）；自主侧没有对端，安全落点是 `rest`（`decide:80`）。`silence` 是"这次不说"，`rest` 是"这一拍不动"——后者还要 `applyRegulationCause('rested')` 泄 load。**语义不同，不是同一个词的两种拼法。**
2. **候选表接地。** 自主决策必须从当拍候选表里选，且理由要引用快照里真出现过的 id：`decide:1038` `kind_not_in_candidates` → demote，`:1051` `reason_not_grounded` → demote。对话侧没有候选表，也没有接地要求。这是自主拍"不能凭空想一件事去做"的唯一约束，收敛时不能丢。
3. **失败处置的方向相反。** 自主侧**降级后继续**（`demote()` 把 kind 换成 `rest`、清空动作字段、`demoted:true` 留痕，`decide:1058-1061`）；对话侧**抛出后重试**（`FAIL_*` 六类 + `ENVELOPE_RETRY_MAX=2`，`contract.ts:504-513`、`:67`），重试用尽才落 `silence`。原因是自主拍有心跳兜底（下一拍还会来），对话轮没有。

### 2.2 只是历史的差异（可以收敛）

1. **同一件事两个名字。** 「给所有者留一条话」在自主侧叫 `queue_notification` → `autonomy.queue_notification`，在对话侧叫 `notify_owner` → `notify.owner`（`contract.ts:203-208`）。两条最终都进内核的通知配额，但 action 名不同、参数名不同（`summary` vs `content`）。
2. **同一件事两种参数名。** 读网页：自主侧 `explore` 用 `decision.url`；对话侧 `research_read_text` 用 `arguments.url`。action 名相同（`research_browser.read_text`），只是取值位置不同——自主信封把参数摊平在 decision 上，对话信封收在 `tool.arguments` 里。
3. **`promise_followup` 两处出现。** 它既是对话 kind（`contract.ts:41`），又是 `TOOL_TABLE` 里 `action: null` 的一行（`contract.ts:216`）。自主侧没有对应物。
4. **工具面不对等。** 对话侧 13 行 `TOOL_TABLE`（`contract.ts:156-234`），生产口径下 `wiredActions` 滤掉 5 行未接线的，她实际看到 8 行；自主侧只有 `explore` 一条能碰外部世界。**这是最大的一处不对称：同一个内核、同一批 handler，自主拍只开了一扇门。**

## 3 · 收敛两案

### 甲案：抽一张共同的动作表，两套枚举都从它渲染

做法：新建 `ACTION_TABLE`（内核动作的唯一真源：action 名、参数形状、用途、是否需审批、是否接线），`TOOL_TABLE` 与 `KINDS` 的候选渲染都从它派生。行为一字不改，只把两份重复的事实收成一份。

| 项 | 内容 |
|---|---|
| 改动面 | 新增一个共享模块（放 `lykoi-decide` 或新包，因为 `lykoi-converse` 依赖 `lykoi-decide` 而非反向）；`contract.ts:156-234` 改为派生；`decide` 的候选渲染改为查表 |
| 提示词 sha | **会变。** `DECIDE_SYSTEM_PROMPT`（`packages/lykoi-decide/test/prompt.test.ts:23-33`，1601 / `d54726e3…`）与 `ENVELOPE_SYSTEM_PROMPT`（`packages/lykoi-converse/test/prompts.test.ts`，1748 / `88587c8e…`）里 `notify_owner` / `queue_notification` 的措辞若统一就都要重钉。若只收编数据不改渲染出的字面，可做到 sha 不变——**这是甲案值得争取的目标** |
| 测试面 | 两处 sha 钉面、`TOOL_TO_ACTION` 投影测试、reflow 七分支测试 |
| 风险 | 低。不改行为、不改可达性 |
| 体量 | 中 |

### 乙案：自主信封改用对话信封形态

做法：自主决策也产 `{kind: tool_call|silence|…, tool:{name, arguments}}`，`KINDS` 退成候选清单的标签（"这一拍你可以考虑做这几类事"）而不再是决策字段。

| 项 | 内容 |
|---|---|
| 改动面 | `decide` 的 `evaluateMessage` 四道关重写；`reflow` 七分支改为按 tool 名路由；wake 阶段 4b 的解析改口；候选接地机制要重新挂到新形态上 |
| 提示词 sha | **必变**，两处都变，且是大改 |
| 测试面 | decide 全套、reflow 全套、wake 端到端 |
| 风险 | **高。** §2.1 的三条路径性质差异要在新形态里逐条重建：候选接地、demote 而非重试、`rest` 的泄压副作用。任一条重建不全，就是 G-1 那类静默误路由重演 |
| 体量 | 大 |

### 产线零次 kind 的处置

两案都需要 §6 的产线计数才能定。原则建议：**零次不等于该删。** `initiate_chat` 与 `queue_notification` 受内核配额闸限流（`reflow:383`、`:407` 的"被脑干拦下"分支），零次可能是闸的效果而不是她不想用；`tend_inner` 零次则更可能是候选权重（`decide:90` 0.4）在 `explore`/`rest` 的 0.5（`decide:85,91`）面前长期落选。删之前要能分清这两种零。

## 4 · 不做的事：不建 `delegate` kind

PROBE-CAP-01 §5.3 读数：产线模型在 12 次给了 `delegate` 示例的机会里**一次都没主动选**（无 persona 组 1/12）；但一旦选了，写出来的委托说明质量够用（唯一那次 10/10）。

结论：**"是否委托"不能做成一个她要选的 kind。** 她不会选它——不是不会写，是不选。把它做成 kind，得到的是一个永远零次的枚举值，以及一条没人走的 reflow 分支（正是 §3 说的"零次难判"问题的自造版本）。

正确位置是内核路由：目标超出当前工具面时由内核决定外派，她只负责把目标与限定写清楚（这正是她做得好的那部分）。验证走 37.8 的回执强制——PROBE-CAP-01 §5.4 读数说明她对需要外部知识的错误 0/8 发现，所以校验不能只靠她的判断。

## 5 · 建议

**选甲案，且以"提示词 sha 不变"为约束条件做第一版。** 理由：§2.2 的四条差异全是数据重复，抽表就能消掉；§2.1 的三条差异是路径性质，乙案要把它们逐条重建，风险与体量都不成比例。PROBE-CAP-01 §5.2 已经证明多步工具路径不需要加厚——瓶颈不在组合形态，所以乙案换来的"形态统一"买不到能力。

甲案还顺带给 §2.2.4 那处不对称一个落点：一旦有了共同动作表，"自主拍能碰哪几个 action"就变成表上的一列，而不是散在 reflow 分支里的既成事实。开不开、开哪几个，是随后的独立决策。

### 待 Kevin 裁定

1. 选甲案还是乙案（本稿建议甲案）。
2. 甲案第一版是否以"两处提示词 sha 不变"为硬约束。若允许变一次，`queue_notification` 与 `notify_owner` 的措辞可以直接统一，收编更彻底。
3. 共同动作表放哪个包：`lykoi-decide`（现有依赖方向，`converse` 依赖它）还是新建 `lykoi-actions`。
4. §3 末尾的"零次 kind"处置口径：等产线计数回来再定，还是现在就定"零次不删、只调权重"。

## 6 · 脚本用法

`governance/wo/WO-KINDS-01/count-kinds.sh`，服务器上跑：

```bash
sudo bash governance/wo/WO-KINDS-01/count-kinds.sh 30
```

参数是天数，缺省 30。审计文件 root 属主故需 sudo 读。脚本只读：`jq` / `grep` / `sort` / `uniq`，不写、不删、不改属性，输出只有事件名与计数，零正文。无 `jq` 时退回 `grep` 粗计数（不带时间窗）。

输出三段：`autonomy_wake` 的 kind × status 计数、`demoted` 计数（护栏降级到 `rest` 的次数）、相关事件总量。第二段是本稿 §3 判"零次"的关键——如果某 kind 计数低而 `demoted` 高，那是护栏在拦，不是她不选。

已在合成日志上验证过窗口过滤与三段输出（本机 2026-09-05）。
