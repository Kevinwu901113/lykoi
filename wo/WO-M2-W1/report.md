# WO-M2-W1 · 状态写层与调节场 · 执行报告（治理侧存档）

- 执行：Mac 本地 Agent；产物 commit：lykoi-cordis `9b1591b`（基 4900eae）
- 复核：独立复跑 126/126 绿 + tsc 净 + golden mtime 未变 + rw.ts 事务纪律注释核——**PASS**

## 交付

1. **lykoi-memory 写层**（`src/rw.ts` 独立入口，缺省只读入口一字未动）：C-01/C-02
   （BEGIN IMMEDIATE 显式事务、嵌套即抛、回滚后可续写）；**统一定案=memory 侧表也走
   IMMEDIATE/10000ms**（STATE-CONTRACT C-03/R-08 分歧点由蓝图裁决，行为收紧，代码注释留痕）；
   写 API：recordExperience/applyRegulationCause（**接口无 delta 参数**，SA-75 结构化）/
   thoughts 全套（容量 7 软拒挤占/injected_ids 闸/衰减/settle/archive）/appendHistory/
   autonomy_state+runs。
2. **lykoi-regulation** 纯函数包（零 I/O 零时钟）：15 CAUSES 逐字、四变量四元组、
   双衰减算法（decayValue/decayCharge 分立）、THRESHOLDS 严格不等号、八 effects、
   registryProblems 全套（含极值功能性证明）。
3. **端到端**：record_experience → experience_recorded → load 精确 +0.04（IEEE 位级）→
   事件行 append-only；合成 fixture 与 devstate tmp 副本各跑一遍。

## 验证要点

- **触发器红测 = 库层拒绝实录**：9 类 UPDATE/DELETE 全部 SQLITE_CONSTRAINT_TRIGGER
  且 message 与触发器原文全等（experiences 单向位红绿双测、thoughts 状态机 5 合法边
  +4 非法边+2 单向列）。
- **C-22 格式对拍**：formatPyIso 与 golden 真实行 104 行采样全匹配（+00:00 六位微秒
  业务形态 vs mind_schema 的 Z 毫秒迁移形态双口径确认），parse→format 往返一致。
- 测试 126/126（memory 50 + regulation 45 + 既有 31）；devstate 未注入时 9 skip 不 fail。

## TODO 台账（10 条，W2–W4 认领）

thought_lapse 模板对拍 / LAPSE_SALIENCE 常量名 / 挤占次序键对拍 / resolveThought 返回契约 /
getAutonomyRuns 排序键 / decision 序列化口径 / now 必传（clock 注入归 W3）/
setAutonomyLastWake 签名 / rw 插件化形态归 W3 / 懒衰减数值序 golden 复核归 W2。

## 纪律核验

零偏离（两处蓝图明文点已在报告说明）；golden 只读（mtime 核验未变）；行内容零输出；
lockfile 仅 +9 行 workspace link；未 commit（治理侧提交）。
