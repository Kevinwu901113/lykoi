# WO-KINDS-01 · 自主决策 KINDS 评估与收敛方案（分析稿）

- 执行方：主治理 Agent（本窗口自执行）。日期：2026-09-05。分支：`wo/kinds-01`。
- **零代码改动。** 产物只有本稿与只读脚本 `count-kinds.sh`。
- 依据：Kevin 裁定 R-B（E1 = 评估并收敛，不废）；`governance/wo/PROBE-CAP-01/report.md` §5.2/§5.3、§6。

## 1 · 七个自主 kind 的现状表

`KINDS` 定义在 `packages/lykoi-decide/src/index.ts:61-64`，**数组序即候选表渲染序**（同文件 :56-60 注释：集合无序会让候选表非确定，不得改用集合）。

| kind | 内容必填 | reflow 分支做什么 | kernel action | 对应 `TOOL_TABLE` 行 | 产线 30 天（§1.1） |
|---|---|---|---|---|---|
| `explore` | 否（要 `url`） | `src/index.ts:331-356`：无 `url` 即 failed（SA-58）；有则 dispatch 读正文，成功才泄 explore 饥饿（SA-59） | `research_browser.read_text` `{url}` | `research_read_text`（同一 action，`contract.ts:192`） | **14**（8 成 6 败） |
| `record_note` | 是 | `:316-322`：`appendAutonomyNote(runId,'reflection',content)`，无 try/except，抛则整拍 failed | 无（只写 store） | 无 | **0** |
| `queue_notification` | 是 | `:388-410`：dispatch 入队；`queued` 才计通知配额（SA-57）；被脑干拦下算 completed（SA-62） | `autonomy.queue_notification` `{summary, run_id}` | `notify_owner` → `notify.owner`（`contract.ts:203`，**不同 action 名**） | **0** |
| `initiate_chat` | 是 | `:366-387`：dispatch 主动开口；回执只报"已交给投递"，不许诺送达（SA-61，明文不得回退） | `autonomy.initiate_chat` `{content, run_id}` | 无（对话侧没有"主动开口"，它本来就在对话里） | **2** |
| `tend_inner` | 是 | `:323-330`：`tendInner()`；只有 `ValueError` 记 failed，其余抛出 | 无（只写 store） | 无 | **22** |
| `rest` | 否 | `:308-311`：`applyRegulationCause('rested')`；**唯一不记 `action_taken` 的 kind**（:315 SA-54） | 无 | 无 | **89**（其中 13 是降级） |
| `contemplate` | 否（**刻意豁免**，`decide:66-73`） | `:357-365`：什么都不做，产出在 `inner` 块、由 wake 在本函数返回后 `applyInner` 落地 | 无 | 无 | **32** |

未知 kind 落 `:411-427`：`unknown_decision_kind` 审计 + `capability_gap`（`GAP_NO_EXECUTION_BRANCH`）+ failed。这条分支是 G-1 定案：活体这里曾是 `else` 兜底，把没加分支的新 kind 默默变成一条发给所有者的通知，`contemplate` 踩过（107 拍里 18 条成了真通知）。**任何收敛方案都不得让这条兜底回来。**

## 1.1 产线读数（Kevin 2026-09-05 跑，窗口 2026-08-06 → 09-05）

187 拍：159 落 `autonomy_wake`（走完 reflow），28 落 `autonomy_wake_failed`（异常路径，`wake:397`）。另有 8 条 `autonomy_wake_retried`（not_json）、3 条 `capability_gap`。

| kind | 次数 | 占 159 |
|---|---|---|
| `rest` | 89（含 13 降级） | 56.0% |
| `contemplate` | 32 | 20.1% |
| `tend_inner` | 22 | 13.8% |
| `explore` | 14（8 成 / 6 败） | 8.8% |
| `initiate_chat` | 2 | 1.3% |
| `record_note` | **0** | — |
| `queue_notification` | **0** | — |

**两个零次都不是"闸的效果"，是她真的不选。** §3 说要分清的两种零，读数分得开：

- `record_note` 0 vs `tend_inner` 22：两者**权重同为 0.4**（`decide:86,90`）、**同样内容必填**（`decide:71-73`）、同样不经 kernel。机会完全对等，她选了后者 22 次、前者 0 次。这是偏好，不是结构。
- `queue_notification` 0 vs `initiate_chat` 2：两者**权重同为 0.3**（`decide:87,89`）、同样内容必填、同样经 kernel 配额闸。关键在于**被闸拦下仍记 completed**（SA-62，`reflow:407`），所以"她试了但被拦"会照样出现在这张表里。它一次都没出现 → 她**从未尝试**。闸不是原因。

其余读数：

- **降级 13/159 = 8.2%**，全部落 `rest`。即 89 次 rest 里 76 次（85%）是她真选的。
- **异常拍 28/187 = 15.0%**。每七拍炸一拍，落 `autonomy_wake_failed`。这是本单范围外的独立问题，值得立单。
- **`explore` 失败 6/14 = 43%**。失败形态两种（`reflow:331-356`）：没有 `url` 的空探索（SA-58）与 dispatch 读失败。哪一种占多数，本次读数分不出——`autonomy_wake` 只记 status 不记 result。要分需要另一条按 `action_result` 经验文本的统计，那会碰正文，**不做**；改法是给这两种失败各自的审计事件。
- 窗口横跨 LANDING-N/O/P 三次落地，口径不完全一致；上面的比例读作量级，不读作精确基线。

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

读数已到（§1.1），两个零次都归"她不选"而非"闸在拦"，所以可以直接定：

- **`record_note`：并进 `tend_inner`，不单列。** 对等机会下 22:0，且两者产物都只写 store、都不经 kernel。甲案里它就是动作表上一行的两个别名，合并零风险。
- **`queue_notification`：保留，但要查为什么她从不选。** 它与 `initiate_chat` 唯一的实质差别是投递通道（手机通知 vs 对话消息）。她 2 次选了后者、0 次选前者，可能是候选表里两者的措辞让"通知"显得更重；这是提示词问题不是枚举问题，删掉它等于把一条能力静默去掉。**先查措辞，不删。**

一条通则留下来：`initiate_chat`/`queue_notification` 这类经 kernel 配额闸的 kind，"被拦下"仍记 `completed`（SA-62），所以计数为零只能读作"她没选"。**判零次前先确认该 kind 的失败路径会不会把自己从计数里抹掉**——`explore` 就不同，它的失败记 `failed` 但仍在表内。

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
4. §3 末尾的零次处置：`record_note` 并进 `tend_inner`（本稿建议）、`queue_notification` 保留并查措辞（本稿建议）。
5. 本单范围外但读数撞出的两件，是否各自立单：**① 异常拍 15%**（28/187 落 `autonomy_wake_failed`，每七拍炸一拍）；**② `explore` 失败 43%**（6/14，且现有审计分不出"没 url"与"读失败"两种，要分得先加事件）。
6. 审计日志里两套行形态并存（§7），是否立单查。

## 6 · 脚本用法

`governance/wo/WO-KINDS-01/count-kinds.sh`，服务器上跑：

```bash
sudo bash governance/wo/WO-KINDS-01/count-kinds.sh 30
```

参数是天数，缺省 30。审计文件 root 属主故需 sudo 读。脚本只读：`jq` / `grep` / `sort` / `uniq`，不写、不删、不改属性，输出只有事件名与计数，零正文。无 `jq` 时退回 `grep` 粗计数（不带时间窗）。

输出四段：`autonomy_wake` 的 kind × status 计数、`demoted` 计数（护栏降级到 `rest` 的次数）、相关事件总量、`type` 非字符串的行。第二段是本稿 §3 判"零次"的关键——如果某 kind 计数低而 `demoted` 高，那是护栏在拦，不是她不选。

第四段是 2026-09-05 实跑撞出来的：产线 `audit.jsonl` 里存在 `type` 不是字符串的行（第 2003 行令裸 `test()` 报 `null (null) cannot be matched`）。**audit sink 明文拒收非字符串 `type`**（`packages/lykoi-audit/src/index.ts:75-76` `event.type must be a non-empty string`），所以这类行按设计不该存在。它们的来源是一件独立的待查事项——可能是 sink 之外的写入者，也可能是历史格式。本段只列键名不列值（D-08），先给出条数与形状；查清楚另立单。前两段用 `==` 比较，本就 null 安全，不受影响。

已在合成日志上验证过窗口过滤与三段输出（本机 2026-09-05）。

**脚本未合并进 main 时用不了**（2026-09-05 实测：服务器上 `No such file or directory`，因为它只在本分支上，且服务器 cwd 不是仓库目录）。在合并之前用这条等价的自足命令，逻辑与脚本三段完全相同：

```bash
L=/var/log/lykoi-audit/audit.jsonl; S=$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%S); echo "窗口 ${S}Z 起 30 天"; echo; echo '--- kind x status ---'; jq -r --arg s "$S" 'select(.type=="autonomy_wake" and .ts>=$s)|"\(.decision)\t\(.status)"' "$L" | sort | uniq -c | sort -rn; echo; echo '--- demoted ---'; jq -r --arg s "$S" 'select(.type=="autonomy_wake" and .ts>=$s and .demoted==true)|.decision' "$L" | sort | uniq -c | sort -rn; echo; echo '--- 相关事件总量 ---'; jq -r --arg s "$S" 'select((.ts//"")>=$s)|select((.type//"")|test("^(autonomy_wake|autonomy_rest|unknown_decision_kind|capability_gap)"))|.type' "$L" | sort | uniq -c | sort -rn; echo; echo '--- type 非字符串的行：条数 + 键名（只列键不列值）---'; jq -r 'select((.type|type)!="string")|keys|join(",")' "$L" | sort | uniq -c | sort -rn
```

无 `jq` 时（`command -v jq` 为空）先 `apt-get install -y jq`，或退回粗计数：`grep -o '"type":"autonomy_wake"[^}]*"decision":"[a-z_]*"' "$L" | grep -o '"decision":"[a-z_]*"' | sort | uniq -c | sort -rn`（不带时间窗）。

## 7 · 读数撞出的一件本单外的事：审计日志里两套行形态并存

第四段本来只是给 `test()` 加空值兜底的诊断，结果计出 **2134 行没有 `type` 字段、改用 `event` 字段**：

| 条数 | 键名 |
|---|---|
| 1053 | `action_id, action_type, correlation_id, decision, error, event, origin, run_id, success, ts` |
| 917 | `action_id, action_type, correlation_id, decision, event, origin, params, pre_approved, run_id, ts` |
| 136 | 同上 + `exemption` |
| 9 + 2 | `action_type, delivered, event, outcome, question_text, …, scope_key, stage, ts` |
| 8 | `answer_text, event, interpretation, question_text, risk_level, scope_key, standing_grant_created, ts` |
| 8 | `action_type, answer_text, event, executed, outcome, pending_id, replied, …` |
| 1 | `action_type, correlation_id, error, event, executed, pending_id, success, ts` |

**代码侧的口径是只有 `type`。** `packages/lykoi-audit/src/index.ts:75-76` 明文拒收非字符串 `type`；`packages/lykoi-kernel/src/approval-interpreter.ts:755` 注释写着"形态适配：Python 事件键 `event` → 新体 sink 词汇 `type`（W1 已立同一映射）"。也就是说 `event` 是**活体（Python）的键名**，新体应当已经映射掉。

所以最可能的解释是：这些是**迁移前活体写下的历史行**，与新体行同处一个 append-only 文件——那是预期内的，不是缺陷。但这只是推断，**没有证据前不能当结论**：另一种可能是某条路径绕过了 sink 直接追加。

一条命令能分开这两种可能（看 `event` 行的时间范围是否全部早于新体上线）：

```bash
jq -r 'select((.type|type)!="string")|.ts' /var/log/lykoi-audit/audit.jsonl | sort | sed -n '1p;$p'
```

若最晚一条早于新体上线日，是历史残留，记一笔即可；若有新体上线之后的行，则是活的绕过路径，要立单。

顺带两点，无论上面哪种结论都成立：

1. **门的词汇登记只认 `type`。** 若将来真有 `event` 形态的行进来，D-08 的词汇核对会看不见它们。
2. **`question_text` / `answer_text` 是审批问答的正文，在审计行里。** 这是 SK-35 六元组的明文设计（`approval-interpreter.ts:712-723`），不是失误——审批判读要可复核就得留原话。但它与 D-08「审计行零正文」是两条不同口径管着两类不同的行，**这个区别值得在白皮书里写明**，否则下一个人会以为其中一条被违反了。本稿只记，不改。
