# M3 治理移植蓝图 · 2026-08-25

M3 目标（总案 §4）：三层门/审批对话/豁免/HARD_ASK/回执背书结构层/图式注册机制；
插件树完整性门+DR 修订。验收：审批环端到端（含终端硬门实弹）；完整性门红绿双验。
规格正本：治理仓库 `wo/WO-M3-SPEC-KERNEL/report.md`（SK-01..84 + DK-01..15 + sha 表
+ 写集全表）+ SPEC-CONV S-54..S-86 + STATE-CONTRACT。**guardian 逐字正本 =
治理仓库 `wo/WO-M3-SPEC-KERNEL/guardian-live-20260825/`**（活体五文件+manifest 113，
哈希对账在案；core-v1-repo 镜像作废）。构建纪律沿 m1/m2（报告一次性输出）。

## 治理定案（预授权批复，构建 Agent 照此执行）

| # | 事项 | 定案 |
|---|---|---|
| GK-1 | DK-03 通知 id=max+1 复用 | 新体持久 next_id（chat_outbox 同法）；mark_replied 错绑面随之消灭；列追认 |
| GK-2 | DK-04 pending 坏文件 | **照抄**（可见崩溃）；R-14 纪律：四个无保护文件不许顺手 try/catch |
| GK-3 | DK-06 建议状态机口径 | **6 态**+迁移表为正本（含 pending←declined/expired 再武装边）；unclear 是 outcome 刻意不是状态 |
| GK-4 | DK-08 clarify 计数域 | 新体插件树单进程，计数域自然合一；进程内不持久化语义保留（重启方向朝问句） |
| GK-5 | DK-09 dead question 文案 | 照抄不加宽（"过期"单一说法） |
| GK-6 | DK-10 env 钉面 | 新体完整性门统一钉**全部**治理 state 路径（收紧无害）；列追认 |
| GK-7 | DK-11 delegated 地板 | 新体为 delegated origin 立显式 capability 地板=**空集 frozenset**（M5 器官上线经治理扩表；比活体"无地板"收紧）；列追认 |
| GK-8 | DK-12 通知到达面 | M3 落队列真身+读面；「kind=notification 并入投递线」做成**默认关**配置，开启=Kevin 决断项（不自作主张改变到达行为） |
| GK-9 | DK-13 bootstrap 预授权 | M4 切换清单预置条目（本蓝图 §M4 交接节）；M3 不执行 |
| GK-10 | DK-14 撤回不开频控后门 | 刻意语义，规格条文入代码注释防"顺手修好" |
| GK-11 | DK-15 图式注册=新建面 | W4 先出设计小节再实现首版；验收四条=注册即感知/可逆副作用登记/卸载即消失/认知可读不可写 |
| GK-12 | DK-02 承重路径 | AUTONOMOUS_ALLOWED **8 项逐字**入新体 policy core（取证实录为准）；建议问答机对 `messenger.send ∈ ALLOWED` 的依赖写成显式结构测试 |
| GK-13 | DK-05 受保护面重划 | root 属主域=lykoi-kernel 包+policy core+完整性门自身+persona TOML+rules 文件；hash-pin 域=其余全部 packages/*/src；清单生成器纯函数（W4 细化） |
| GK-14 | DK-07 基线冻结 | M3 全程 refsrc 基线钉 4463ae8 不追活体修复单（新体 G-10 已消灭该缺陷出生面）；W2 必立 e2e 断言「信封自称 dispatched ⟺ audit 有 action_dispatch 行」 |

## 验证方法（贯穿全部波次）

1. **逐字对拍**：SK 条目锚点逐条；kernel 侧 prompt/模板 sha256 对拍 SPEC-KERNEL §2
   表（30 条）；guardian 语义对拍 guardian-live-20260825/ 正本。
2. **写集对拍**：13 路 state 文件/表逐路（SPEC-KERNEL §3B），坏文件语义四档三处
   刻意相反逐文件复刻。
3. **golden 审批环**：问→答→执行→回执全链 fake 化红测；归属判定信号序逐支；
   解释器五失败路全落 unclear。
4. **数据纪律**：golden devstate 永远只读；她的行内容零输出；写测试 tmpdir 副本。

## 波次划分（基线 433 测试，串行）

**W1 · 特权层骨架**：`packages/lykoi-kernel`（CF-B1：**非插件库模块**，插件 import 它，
不入插件树）——KNOWN_ACTIONS 18 项+`_resolve` 拒绝面（SK-01/02）、DispatchContext
五 origin（SK-03）、DelegationRef 前置拒绝（SK-04）、redaction 门（SK-05）、
pre/post 不可变审计门+degraded 状态机（SK-06..12，sink=lykoi-audit 注入）、三层门
check 全 10 步（SK-15..21，含 GK-7 delegated 空集地板）、policy core TS 对应物
（HARD_ASK/HARD_DENY/AUTONOMOUS_ALLOWED 8 项/SCHEDULER 地板，GK-12）、scope key
全表（SK-69）、scoped grants/standing/denial（SK-22..25）、rules 读面+schema 孪生
（SK-18/19）、pending 队列全生命周期（SK-27..29）、委托台账七态+审计先行（SK-61..66，
资源薄壳 SK-67 留接口位）。接线：`unwiredActionCatalog`→真 catalog；reflow/wake/
converse 三处 DispatchFn→真 dispatch（origin 由接线方盖章）。出口判据：自主拍三路
经真门落 audit；E1/E2/E3 covers 在 check 末位承重的结构测试；硬 deny 胜过批准红测。

**W2 · 审批器官**：approval_conversation 四道闸+先发后排+回执（SK-30..35）、
interpreter 全套（SK-36..46 快通道/六元组/回滚）、ASK_FALLBACK 迁移（sha 66b17e24）、
converse 的 `cycle_approval_gate_unwired` 换真身（`_delegated_ask` 四项载荷协议
SK-77 认知侧）、tool_calls wire 原生映射、LLM adapter 面（interpreter 判读 T=0/400
+ response_format wire + 超时容纳 D-01 重试；vision 可后置 W3）。出口判据：审批环
端到端含**终端硬门实弹**（dev 全链：terminal.exec→ask→引用回复批→执行→回执）+
GK-14 e2e。

**W3 · 出站器官+建议问答+通知**：telegram outbox 游标机（SK-79..81 坏游标方向刻意
相反/结局落定后推进）+**E3 投递线拉回 dispatch**（D-07 本体）+undelivered 生产侧+
经验回灌+打扰预算 reply_to 判定+审批问句设备层发承重（SK-77/78 设备侧）+S-08 三级
路由（SK-82）+suggestion_conversation 全套（SK-49..55，GK-3/GK-10）+kernel
notifications+markReplied+contact 链（SK-56..60，GK-1/GK-8）+interactive_lock
（markActive/shouldYieldToChat 接 wake 仲裁）+快照三读数权威源。出口判据：问句
设备层发承重+预算边界回归（名额耗尽仍拒）。

**W4 · 完整性门+生产收口**：完整性门等价重建（SK-70..76：manifest 生成/三向核对+
反向核对/rules 硬门核对/audit sink 供给六断言/env 钉面 GK-6；受保护面 GK-13）+
**红绿双验**（篡改一字节必红=期末验收）+图式注册设计小节+首版（GK-11）+restart
生产采集器+生产配置入 cordis.yml（wake/learn/converse 同批）+DR 修订素材。
DA-11（活体 persona TOML sha）已具备取证通道，W4 收尾做。

## M4 交接预置（本蓝图立此存照）

①bootstrap_owner_preauthorization 重放或确认 rules 行（GK-9，否则 S1B 死锁复活）；
②core 退役与 startup_verify 解耦必须同窗（CORE-RETIRE 正本）；③self-state 维持
活体缺省 disabled；④切换窗新旧体绝不同时写 state（R-01 硬规则）。

## 追认清单（攒批，M3 收口时呈 Kevin）

GK-1（通知持久 id）、GK-6（env 钉面收紧）、GK-7（delegated 空集地板）、
GK-8 决断项（通知并投递线开关默认关，开启待 Kevin）、W2 起新增 sha 变更表（如有）。
