# WO-M3-W3 · 出站器官+建议问答+通知 · 执行报告（治理侧存档）

- 执行：Mac 本地 Agent（opus）单波单次过；产物 commit：lykoi-cordis `174942a`（基 563696c）
- 复核：独立复跑首轮 **652 pass / 1 fail**（自报 653/653）→ 定位为 **W2 遗留定时炸弹**
  （非 W3 回归，详见下节）→ 治理侧修复后复跑 **653/653 全绿 + tsc 净**；golden devstate
  mtime 全等 1787510320；仓内 `var/` 零 state 泄漏（出站六持久面全经 isolateOutboundState
  钉 tmpdir）；抽查——vendor 第 7 改动点已登记（文件头"共 7 处"+`[lykoi CF-B6 edit 7/7]`
  行内标记+治理理由）、E3 章在 device.ts:414 以 `upstreamBudgetedDelivery()` 盖于
  origin=autonomous、GK-8 `_outboxDelivery=false` 默认关、建议铁律 import 面静态测试
  （`./approval.ts` 不在 import 面 + 四个写面调用形态零出现）——**PASS**

## 复核发现①：W2 遗留定时炸弹（已修，教训入册）

`packages/lykoi-kernel/test/approval-interpreter.test.ts` 的 SK-40「handleAnswer 缺省
pendingQuestions 走真队列读点」用夹具固定 `T0 = 2026-08-25T10:00:00Z` 播种 pending，
而**被考的那个缺省读点按活体语义不带 now**（`approval-interpreter.ts:891` →
`pendingActions()` 用真实时钟）。pending TTL=900s，于是真实时钟一过 `T0+15min`
记录即被 `_expired` 滤掉 → 队列读空 → `ignored` ≠ `denied`。

- **性质**：测试缺陷，非生产缺陷。生产行为正确（缺省读点用当下时钟，忠实 Python
  `pending_actions()` 默认值）。
- **为何 W2 复核没抓到**：我的 W2 复跑发生在 10:15Z 之前，窗口内为绿；W3 复跑在
  10:22Z，窗口外翻红。**同一份代码同一天早晚两种结果**。
- **修法**（治理侧最小改动）：播种与读取共用同一口钟（`const seededAt = new Date()`），
  考点一字不改；原委与教训写进测试注释。
- **教训（呈 HANDOFF/工单模板）**：**夹具固定日期 + 生产真实时钟缺省读点 = 定时炸弹**。
  凡断言依赖"记录还活着"，播种钟必须与被考读点的钟同源；固定 T0 只可用于全程显式
  传 now 的路径。同类扫描：`approval-conversation.test.ts` 的同型断言全程不传 now
  （真实时钟自洽），无第二处。

## 交付

1. **出站器官**（新 adapter-telegram 五模块）：游标机 SK-79（坏游标"入站当 0/出站当
   首启"方向刻意相反、推进在结局落定之后、`approval_request` 显式跳过留痕、无 owner
   绑定不推进、消费自成 try）；**E3 投递线拉回 dispatch=D-07 本体**（活体这条线零 audit
   零 check 零章，新体每条主动发言留 intent/result 对，章=E3）；messenger 契约 SK-80
   （原子 check-and-reserve/CAP 1/6h/坏账本当空/节流不抛/单写者=设备层）；transport
   纪律 SK-81（重试仅 sendMessage、429 单路 honour retry_after、token 零外泄红测实证、
   未送达 9 字段+正文仅文件留 200 码点、经验回灌经 reflow 单写者）；**SK-77 设备侧承重**
   （四项载荷→形状校验五种畸形逐一红测→不对宁可不问→`requestApproval(replyTo=当轮
   入站 id)`、不写队列不重试、`device_side_wired` 翻 true）；E2 盖章唯一点四分支
   （排队等批≠未送达）；S-08 三级路由三格真值表。
2. **建议问答机** SK-49..55：铁律三层（import 面静态/审计自证 wrote_approval_rules:false/
   accept 路 standingGrants 前后 deepEqual）；六步驱动序（过期最前/FIFO 源码零 sort 零
   priority/owner 只认绑定——塞 env 照样发不出/先发后记/CAS 认领）；**GK-10 撤回不开
   频控后门**（残余窗口入账，另立"注释在位"测试防顺手修好）；GK-3 六态+再武装边；
   sha C 段 10 条 createHash 现算全等。
3. **通知** SK-56..60：队列真身（环 500/唯一两 handler/内容不入审计）；autonomous 三闸
   从持久队列现算（含"重启视角"红测）；缺表 origin 不节流是显式政策；markReplied 首写
   获胜+滚出 no-op；contact 链通（NotificationsView 真身→conversationTurnReflow 唯一
   写入点，`contact_answered` 恰一条）；**GK-8 并投递线默认关**（关时 sink 一次不被调）。
4. **快照三读数换真源**+D-04 横幅恒 0 假设解除（撞门后 pendingCount()===1 横幅装配得出，
   沉默路仍不加）；**interactive_lock**（DK-11 本波落法=yield 拍就此丢弃不回灌心脏，
   理由入注释：回灌会在对话刚结束炸出补偿拍串，正是让位想避免的打扰）。
5. **加派项⑥ response_format 通 wire**：vendor 第 7 改动点（与既有六点同体例、
   1–6 标 CF-B6、7 标 M3-W3 加派并写治理理由）+ options seam 透传 + converse 两处递钮
   + adapter 层 body 双断言（钮关时该键**根本不在 body 上**，非 null 非空对象）。
6. vision/describeImage 接 seam（真模型调用不做）。

## 复核发现②：E3 投递线二次计税（**呈 Kevin 决断**）

拉回 dispatch 后，出站投递线会再过一次 messenger 的 proactive 账本
（`reply_to=null` → `_reserveProactiveSlot`），即活体直调 transport 时不收的税。
执行方**刻意不顺手修好**并上呈，理由正确：SK-47 钉死"豁免免掉的是问，从来不是账"，
拿 E3 跳账本＝把审计概念改写成额度概念。现状=**收紧**（宁可她少说一条，不凭空开额度）。
三候选：①投递线专用动作名；②按 exemption 类别扩 handler 契约；③维持现状。
取舍说明已入 `device.ts:398-408` 注释。**治理建议：维持现状（③）**——她今天本就静默，
额度不是瓶颈；等真出现"该说的话被自家账本挡住"的实例再改，那时也有真数据判量级。

## 新增 TODO（呈 W4/M4/M5）

①建议问答机的周期驱动位接 wake 拍→M5 autonomy 编排；②`messenger.read` 后端随
BotApiTransport 生产接线；③BotApiTransport 的 HTTP seam（真 fetch/代理/超时/
trust_env=false）→M4 cordis.yml；④**GK-13 受保护面须判两新文件归属**：
`kernel/proactive-chat.ts`（脑干层事实=root 属主域正当住户）与 `kernel/interactive-lock.ts`
（单进程协调件）→W4；⑤出站六个新 `LYKOI_*` 路径并入 GK-6 统一 env 钉面→W4；
⑥vision 路由与真模型→M4；⑦D-08 与 SK-05 口径分界已立断言，随 W4 事件词汇分流入门。

## 偏离蓝图

零。形态适配就地声明：建议侧常量加 `SUGGESTION_` 前缀（两侧同名撞导出面，sha 钉值
不钉名）；模块级 import→工厂注入（kernel 是 CF-B1 库模块，**反向 import lykoi-learn
一次都不许**）；file_lock→单进程 RMW（GK-4 同源）；HTTP 那一跳=注入 seam（零真网）；
落位（interactive-lock/proactive-chat 住 kernel；chat_outbox+未送达账本住出站器官包，
converse 经注入 UndeliveredView 读——源码上一次 cognition→resources import 都不发生）。
