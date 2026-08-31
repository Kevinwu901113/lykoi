# WO-L4 复核 · 2026-08-12 · PASS(含 1 个复核者补丁)

**有效提交:`wo/l4` @ `3a29112c`**(基 `f915eaa4` = 活体 main)。

## 交付核对

八条判据的实现与测试全部落盘(13 个实质提交,棘轮策略跨五轮网络中断无损):
`_V13` 五张影子表 + store 单写者接口(a581dc1a)、focus.py 729 行编排(c99c171e)、
判据①–⑧测试 43 条(68bce35d…9cb4a448)、三个手写逆迁移梯子补级(a7f42fc8)、
manifest 重签 104→105(063649a9)。执行报告:`test_l4_focus.py` 43 passed。

## 代码审读(src 全量 1514 行)

- **单写者纪律**:focus.py 零 SQL,五张表全部经 store.py 读写。✅
- **配额物理面**:任何路径至多一次 LLM 调用,`llm_calls=1` 在发出前落账
  ("发出去就算数"),失败不重试、落 `outcome='failed'` 周期行;节律计数在
  finally 无条件清零(失败不是免费重试)。✅
- **血缘口径**:按"实际喂入 prompt 的原料"由代码入账,不采信 LLM 自陈
  (自陈进 note 侧);UNIQUE 五元组使重放幂等。✅
- **红线 #3**:建议释放只落 `release_suggested_at_cycle` 记录,本模块不存在
  释放路径;专项测试钉死(`…_produce_a_release_suggestion_only`)。✅
- **门的结构性保证**:层 2 结论用新类别 `focus`,persona 投影只取
  persona/preference 两类,影子期(S=2,按周期序号非墙钟)产物在结构上进不了
  任何 prompt;唯一对外口 `promoted_focus_insights()`。✅
- **LLM 故障与反刍隔离**:API 故障不喂反刍计数(基础设施的毛病不记在她头上)。✅
- **逆迁移**:纯删除,sqlite_master 逐字节还原有专项测试;三个既有梯子按版本名
  显式补级,无链相对写法(教训 31c 雷区)。✅

## 全量串行 pytest(54 分钟,慢机)

**15 failed / 1737 passed / 6 skipped**。逐条归因:

- 14 条 = 已知基线(11 条 rollout 控制器环境性 + 2 条 shadow 串行基线 +
  1 条 p0 manifest 读权限环境性)。✅ 与基线完全一致。
- **1 条新增**:`test_persona::test_insights_have_no_ungoverned_write_path` ——
  insights 写者白名单不含 focus.py。**这是治理测试按设计工作**:测试 docstring
  预留了"未来接写入者须有意加入白名单"。层 2 写 insights 是设计行为
  (§3.7 产物),经影子门治理。执行 Agent 的运行清单未含 test_persona.py,
  全邻接复核抓获(教训 31b)。

## 复核者补丁(3a29112c)

1. `tests/test_persona.py` 白名单加入 `mind/focus.py`,注明治理依据
   (影子门 + 无下游消费)。补丁后 test_persona 10 passed。
2. 清掉分支尖 WIP 提交带进来的两个清单杂物脚本(.wo_l4_checklist.sh /
   .wo_l4_watch.sh),分支尖可直接合并。

## manifest 独立重算

105 条目 = `_protected_files()` 105 文件,mismatch 0,not-in-manifest 0,
skipped 1(活体 approval_rules.json 读权限,环境项)。**manifest 诚实**。

## 遗留(不阻塞)

- 实体轴判别力有限:`memory_scopes` 历史回填全是 user_001 默认值,
  `create_concern` 不写作用域行 → §7.2 防自恋硬规则今天实际选择力弱。
  focus.py 注释已如实声明;补作用域写入侧属后续单(不在 L4/L5 范围)。
- 重申(逐字相同结论)周期 outcome 记 advanced 但反刍计 no_progress ——
  两本账口径不同是有意的(台账记"她给了结论",反刍记"没有新东西"),
  注释已说明,观察项。
