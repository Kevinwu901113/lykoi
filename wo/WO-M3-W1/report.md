# WO-M3-W1 · 特权层骨架 · 执行报告（治理侧存档）

- 执行：Mac 本地 Agent 单波单次过；产物 commit：lykoi-cordis `03ac37e`（基 983a87b）
- 复核：独立复跑 **508/508 全绿 + tsc 净**（逐包与自报逐位一致：kernel 72 新增/
  converse 54/wake 18）；golden devstate mtime 全等 1787510320；抽查——check 判定序
  covers 在⑨最末位、GT-4 红测（②能力 deny 先于⑤硬 ask 双断言）与硬 deny 胜过批准
  红测在位、**AUTONOMOUS_ALLOWED 8 项逐字全序**（连活体注释 WO-NIGHT-01/WO-P2-S1A
  原文都迁了）+GK-12 承重测试（messenger.send∈ALLOWED+capabilityProfile=allow）、
  GK-2 pending 坏文件无保护照抄（`_loadPending` 直接 JSON.parse+注释立牌禁 try/catch）
  ——**PASS**

## 交付

1. **packages/lykoi-kernel（CF-B1 非插件库模块，零 lykoi 运行时依赖）**：dispatch 主链
   SK-01..14（KNOWN_ACTIONS 18 项字面量联合+运行时 Set 双钉/`_resolve` 四重拒绝全
   raise/DispatchContext 五 origin 无默认/DelegationRef 缺失=拒绝+落账在策略判定之前/
   redaction 门先 assert 后 redact/pre-dispatch 不可变审计门 fail CLOSED+degraded
   状态机/post best-effort/action_result 零正文/**Core R2A 分支整块不迁=CF-B2**）；
   三层门 check 10 步逐字 SK-15..21（scheduler={notify.owner}/autonomous=core 缺失
   fail closed deny/**GK-7 delegated 显式空集地板**/DELEGATION_READONLY 位⑦/live 只能
   收紧）；policy core 三表逐字（HARD_ASK={terminal.exec, delegation.dispatch}/
   HARD_DENY=∅/8 项+size===8 断言/PROTECTED_PATHS）；scope key 全表 SK-69（绑定读点
   注入、读失败降级更窄键）；scoped grants/standing/denial SK-22..25+bootstrap 函数体
   不挂启动（GK-9）；pending 全生命周期 SK-27..29（TTL 900s/原子认领四拒绝态/mark-only
   永不删）；委托台账 SK-61..66（七态双层/审计写在落库前 fail closed/depth 闸越界连
   draft 不留/setVerdict 唯一写入点）+资源薄壳 SK-67 留接口位；通知文件原语（**GK-1
   持久 next_id v2 形态**，v1 迁移读零副作用；队列语义归 W3）；redaction 逐字；E1/E2/E3
   迁 kernel（converse 原路 re-export，import 面一字不变）。
2. **接线**：`unwiredActionCatalog`→`kernelActionCatalog`；wake（origin=autonomous，
   runId 贯穿）与 converse（origin=interactive）DispatchFn→真 dispatch；e2e 实录=
   自主三路 intent/result 对落 audit、converse 撞门路 ask→needs_approval→
   `cycle_approval_gate_unwired`→沉默。
3. Python→TS 形态适配（注释就地声明）：事件键 event→type；file_lock→单进程同步 RMW
   （GK-4 同源）；OSError→errno code；模块级 import→注入位；guardian 路径推导→编译期
   import（SK-13 更紧），fail-closed 分支以 `_setPolicyCoreForTest(null)` 红测保留。

## 新增 TODO（呈 W2/W3/W4/M5）

①unwiredResources 换装：messenger/notify/autonomy/出站归 W3，browser/terminal/
research_browser 与 delegation 传输面归 M5；②delegation 生产接线随 M5；③问句机
（S-58..68/E1 盖章）归 W2、通知队列语义+markReplied 归 W3；④生产路径与 GK-6 env
钉面、audit sink 权限模型、validateRules 的 startup_verify 孪生对面归 W4；
⑤unwiredActionCatalog 清理归 W4；⑥GK-14 e2e 归 W2 必立。

## 偏离蓝图

零。追认素材已注释标注：GK-1、GK-7。
