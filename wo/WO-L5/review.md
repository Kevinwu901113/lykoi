# WO-L5 复核 · 2026-08-12 · PASS(含 1 个复核者补丁)

**有效提交:`wo/l5` @ `71a72720`**(基 `wo/obs-llm` @ 5c63187a = 活体 main 内容)。

## 过程记录

首轮 EXIT=0 假阳性:白名单死规则 `Bash(.venv/bin/*:*)`(前缀不吃通配)拒了
裸 pytest,Agent 以"请求许可"收尾——实现①–⑥已提交,缺⑦/重签/报告。
白名单已修为无通配前缀两条(教训 33),续跑一轮收官。

## 代码审读(src 全量 1281 行)

- **模块切分**:入队侧 `mind/suggestions.py`(只碰 store+日志,不知 messenger
  存在)/问答侧 `kernel/suggestion_conversation.py`/编排在 autonomy 周期尾。
  focus.py 的安全边界一字未松(只多一个 mind 线内的入队动作)。✅
- **铁律(§3.8)双重保证**:结构上——三个 L5 模块无 approval_rules.json 写路径、
  不 import kernel.approval,"生效"动作在代码里不存在;门上——接受的产物只是
  存表的 staged 执行说明。AST 静态断言 + guardian 文件 mtime 不变测试钉死。✅
- **S3 四姿态原样继承**:先发后记(发送失败不出队)、认领失败撤回(撤回同守
  打扰预算,不开后门,残余窗口记审计)、不递归、三消息切分+数据非指令。✅
- **归属只认 reply_to**,比 S3 更严——权限边界上不做模糊归属,不引用即
  ignored(零写零 LLM,落回普通对话)。✅
- **判定失败一律 unclear**:超时/空回/解析失败/未知 verdict/异常,唯一通往
  accept 的路是模型明确说 accept;temperature=0。✅
- **状态机写成数据**(_SUGGESTION_TRANSITIONS),迁移原子 CAS;再武装保留
  ask_count 与上次答复原文;拒绝 30 周期冷却、过期 10 周期,按周期序号不按墙钟;
  去重键由代码派生,UNIQUE 物理去重。✅
- **词表判定宽松方向有论证**(假阳性=多问一句,假阴性=想法永远不被看见),
  §6.4 拿不准往严的正确形状。✅
- **audit 全链路**,每条自证 `wrote_approval_rules: False`。✅

## 判据与清单(执行报告 + 我方验证)

八条判据逐条有测试行号自证;⑦清单 6 组前台串行全绿(p0 仅已知环境项)。
`test_l5_suggestions.py` 30 例;`test_l4_focus.py` 43 例保持全绿(迁移停版
改用绝对版本 `_apply_upto(conn, 13)`,教训 31c 合规)。

## 全量串行 pytest(57 分钟)

**19 failed / 1766 passed / 6 skipped**:

- 14 条 = 已知基线(11 rollout 环境性 + 2 shadow + 1 p0 读权限)。✅
- **5 条新增,同一根因**:test_l1_experience_class(2)/test_l2_intake(1)/
  test_p2_data_model_migration(2)的手写逆迁移梯子缺 v14 级——新表未拆导致
  sqlite_master 比对红、以及 mind_schema 残留 v14 行使 apply_migrations 空转
  ("no such table: memory_scopes")。**责任双重**:执行 Agent 该照 a7f42fc8
  先例自查;我的续跑清单也漏了迁移邻接三件套(教训 31b 复犯,见遗留)。

## 复核者补丁(71a72720)

三个文件的梯子顶端各补 `downgrade_v14`(l1×3 处、l2×3 处、p2×1 处)+
p2 的 `_L5_TABLES` 集合与断言扩展。补丁后三文件满绿:45 + 28 + 16 passed。

## manifest 独立重算

107 条 = `_protected_files()` 107 文件(+kernel/suggestion_conversation.py、
+mind/suggestions.py),mismatch 0,skipped 1(环境项)。**manifest 诚实**。

## 遗留(不阻塞)

- **流程债(我的)**:工单模板的"全邻接清单"应固化一条规则——任何动
  `mind/migrations.py` 的单,清单自动含迁移三件套(l1/l2/p2_data_model)+
  未来每一个带手写梯子的文件。已记 HANDOFF 教训 31b 补注候选。
- `standing_grant` 种类已建枚举与 HOWTO,但当前无入队来源(她还没有"这类事
  你总是批准"的观察机器)——位子留好,属后续单。
- suggestion 问询消耗每日 1 条主动开口预算:她"想问"与"想说"共享同一个
  额度,是否要分池,等真实使用数据再议。
