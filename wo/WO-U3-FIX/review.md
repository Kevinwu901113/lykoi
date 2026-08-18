# WO-U3-FIX 复核 · 2026-08-19 凌晨

**结论:PASS(待独立复跑收尾条目补录;追认项 2 条随合并包 13)。**
执行:opus,EXIT=0 单次过(01:54→03:47),5 commit,10 文件 +1152/−9,
尖 `1b8ef063`(基 `a923c44e` = 活体 HEAD)。

## 复核方独立验证

1. **Scope/forbidden**:改动面 = cognition 三文件 + manifest + 测试;
   **零 kernel、零 guardian 代码、零 core**——与工单预期完全一致。
2. **response_format 接线逐行审**(llm_client/llm_router diff):传输层只
   转发不解释;None 不落线(未设路由的请求体逐字节不变,executor 有三条
   打在线上字节的用例);**唯一配置点 = `_conversation_shadow_config`**;
   kill switch `LYKOI_U3_SHADOW_JSON_MODE` 默认开、读在调用点;`_bool_env`
   抄不 import(反向 import 会闭环,理由成立)。
3. **classify_failure 逐行审**(conversation_cycle.py:365-437):结构复验
   复用同一个 `_extract_json`(单一真相);detail 全模板化(`_other_detail`
   明确不记 `str(exc)`——httpx 异常文本带 URL);归因器自身 try 包裹永不抛;
   pulse 分支的"当前不可达"注释与代码一致。隐私口径三条守卫用例在卷。
4. **manifest 独立重算**:110 条、0 不符、0 缺失、六目录 0 漏保、1 不可读
   (approval_rules 0600 既知)。
5. **独立复跑**(136 文件 14 块,服务器侧 setsid 脱管防 ssh 抖动):
   〔总数待 sweep 收尾填〕
6. **执行方自跑全量**:2077/3/6,+95 恰等于新增用例数,失败集合=基线三条。

## 追认项(复核方均建议追认,理由:两条都严格加强)

1. `pulse_invalid` 不可达→预留位(不为凑枚举改护栏,双面测试);
2. `unknown_kind` detail 不截断只二选一(防回复前 20 字落账,较工单更严)。

## 亮点

- 根因推断一节(报告判据⑦)质量突出:对照组论证排除解析器变量、指出尾置
  system 的分布外位置会**放大**会话惯性、预判"判据②是止血主力③是同向第二层"、
  并给出部署后每格读数的判读表——这正是"仪表+一次施加,不是已验证的修复"
  的诚实姿态;
- `first_char:empty` 一格把"提供方空壳"与"她开口说话"分开,json mode 边角
  不特判不重试;
- 契约强化的写法照顾了她的"不回=晾着他"压力("那句话放进 content,一个字
  都不少"),不是冷冰冰的格式命令。

## 观察(不阻合并)

- 修复效果要等第二夜真实读数,门③ 判读表在报告判据⑦ 末段;
- 全量耗时 56 分钟(基线约 50),增长来自 +95 用例,正常。
