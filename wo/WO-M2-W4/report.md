# WO-M2-W4 · 学习环 · 执行报告（治理侧存档）

- 执行：Mac 本地 Agent 单波单次过；产物 commit：lykoi-cordis `24a9dd0`（基 5ae64f5）
- 复核：独立复跑 **358/358 全绿 + tsc 净**（逐包与自报逐位一致：learn 68 新增/memory 78/
  wake 16）；golden devstate mtime 全等 1787510320（只读纪律成立）；lockfile 仅 learn
  workspace link 且依赖面与 boundary 声明一致（learn 生产依赖唯 lykoi-regulation）；
  prompt sha 三条=测试内 createHash 实算钉规格正本原值（INTEGRATION `b130d647…`/FOCUS
  `c278a1ca…`/STAGED_TEMPLATE `c4d946b5…` 旧=新）；L5 铁律抽查=l5.ts import 面唯
  ./shared、SuggestStore 类型面唯 enqueue+lineage 两写口；SA-130 周期序号例外+逐字理由
  注释在位；L2 墙钟锚 `INTEGRATION_EVERY_HOURS=24`+锚缺席→到期；wake 仅 completed 驱动；
  **PERMISSION_MARKERS 21 项与 refsrc 逐序全等（脚本比对）**；early 闸走
  cognitiveEffects 从 THRESHOLDS.load_high_integration 派生零硬写副本——**PASS**

## 交付

1. **packages/lykoi-learn 单包五模块**（治理缺省布局采纳；铁律隔离用类型面+import 面
   静态钉死+动态写集三层替代包边界，理由入报告）：L1 classify 纯函数（SA-83..88，分类
   写入挂 rw 经验写入点同事务）；L2 integrator（SA-89..108：触发闸三路/pending>0 红线#1
   前置/七步周期/叙事双门+有界重试一次/SA-99 物理闸在 store）；L3 relevance（SA-109..116：
   检索域全 experiences/bigram+相邻链 2c−1/字段权重逐字/LIKE ESCAPE 双保险/零写入）；
   L4 focus（SA-117..140 全套门：派生锚不硬写 24/priorityCompare 三级/owner 轴/冷却/
   反刍/影子门/血缘/contested 两段式/SA-137 快乐路负断言）；L5 suggestions 入队侧
   （SA-141..147/152：dedup UNIQUE/三 kind _V14 同源/21 项词表往宽判/血缘失败不回滚/
   STAGED_TEMPLATE 逐字/状态机全节）。
2. **G-4 墙钟锚**：L2 scheduled=last_integration_at 距今≥24h（锚缺席→到期=DA-08 同向
   读法，反向=死锁）；L4 锚=MAX(focus_cycles.started_at)（openFocusCycle 每种周期开头写
   =活体无条件清零的墙钟对应物）；**只迁触发锚**——SA-130 影子期结算（cycle_id 差≥2，
   红测=墙钟走 21 天无周期不放行）、SA-127 冷却、SA-121 owner 轴、SA-148 TTL 保持周期
   算术；bumpWakesSince 双计数器降格账面列（G-2 先例）。integrator 无影子期故 SA-130
   例外不适用于 L2，如实说明。
3. **SA-171 接线**：wake 的 integrate/focus 钩子接真（仅 completed、串行、异常吞成
   autonomy_*_failed 遥测）；钩子签名扩 ({runId})=三 origin 同拍分账（SA-172）；端到端
   一拍 fake LLM 驱动 L2/L4 集成测试（三 origin 调用序 autonomous_wake→integrate→focus，
   第二拍两闸皆关零调用）。
4. **W3 TODO#1 定案落地=构造注入**：`new ReadWriteMemory(path,{logEvent})` 缺省 no-op
   （rw 纯库不知 audit 存在；wake 递 auditLogEvent）。决定性理由：resolveThought 三拒绝
   分支对调用方同为 false，编排层补发无法还原事件粒度。事件名与字段 Python 逐字，
   telemetry records, it does not gate。
5. 共享 DDL 补 W4 十表（STATE-CONTRACT §1 逐字含 C-14/C-17 UNIQUE）；logicalDigest 族
   提炼进 lykoi-memory/testing 单一出处。

## 归属判定与销账

- **问答侧 suggestion_conversation 未迁**（import messenger/policy_exemption/dispatch
  上下文=长在 kernel 对话面与 autonomy 编排，器官 M3 才存在）；本波只队列侧，状态机
  全备好，M3/W5 只剩 orchestration+四条 prompt（sha 已在规格）。
- 认领三条全销：W3#1（构造注入）、SA-171（接线）、rw 内 TODO(M2-W4)（SA-176 静态绊线
  =全仓 settleThought 调用点唯 l2.ts）。
- 跨语言等价档六处注释留痕（周期 now 统一/学习环 extractJson 失败返 null 与 decide 抛错
  分立/casefold/round(6) 网格量化/信封 note dict 值折空串/integration_id 31 位随机）。

## 新增 TODO（呈 W5/M3）

①问答侧四条 prompt+七状态+S3 四姿态随 M3 落，出队挂"闸开之后"（SA-153）；
②promoted_focus_insights 今日无下游，接下游必须接它而非 listFocusInsights 全集
（SA-134，W5+ 注意面）；③archive_search 归 console/W5；④L2/L4 completion 参数
（temperature/max_tokens）随 M3 配置面；⑤学习环入 cordis.yml 随 wake 同批。

## 偏离蓝图

零。
