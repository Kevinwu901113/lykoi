# WO-U3-FIX · 影子信封解析失败修复(切换阻塞项)

你是执行 Agent,在 `~/lykoi-work-l1` 工作。
**分支 `wo/u3fix` 已由治理侧建好(尖 `a923c44e` = 活体 HEAD),直接 checkout。**
铁律:前台串行、禁后台、每判据一 commit(`[WO-U3-FIX]` 前缀)、测试 `timeout 1800`
包裹、**stdout 即报告本体**、宁长勿略;侦查发现与工单冲突时停下写清楚。

## 背景(治理侧 2026-08-19 凌晨实测,可直接引用)

- 影子首夜(35 次调用,真实对话负载):**1 个合法信封**(且被护栏 demote 为
  silence)+ **34 个 `u3_shadow_failed{error_type: ValueError}`**——系统性
  契约失败,是切换单的阻塞项。
- `u3_shadow_failed` 目前只记 `error_type` 与 `elapsed_ms`,无法区分
  非 JSON / 缺 decision 对象 / 未知 kind / 缺 content——观测不足以定位。
- `llm_client.py`/`llm_router.py` **无任何 response_format 支持**(grep 零命中)
  ——JSON 强制模式从未接线;`ENVELOPE_SYSTEM_PROMPT` 已明言"只输出一个 JSON
  对象"仍 34 连败。
- 对照:自主路径(`autonomous_cognition`)用同一个 `evaluate_message`/
  `_extract_json` 常年正常——差别在对话语境(信封契约是 1500+ tokens 自然
  对话历史之后的最后一条 system,会话惯性可能压过契约)。此为治理侧假设,
  **要靠判据①的结构化数据证实,不要臆测**。

## 判据

① **失败可观测**:`u3_shadow_failed` 增加结构化字段
   `reason ∈ {not_json, no_decision_object, unknown_kind, missing_content,
   pulse_invalid, other}` + `detail`(**仅白名单模板文本**:如 unknown_kind 记
   kind 值截 ≤20 字、not_json 记响应首字符类别——**绝不落她的回复原文/对话
   内容**,沿 U3 影子事件同一隐私纪律);`error_type`/`elapsed_ms` 保留。
   护栏 demote(合法信封被降级)不算失败,已在 `u3_shadow_envelope.demoted`
   有账,不要混。
② **JSON 强制模式接线**:`llm_client`/`llm_router` 增 response_format 透传
   (加在 RouteConfig 或 complete 参数,形态你定并自证);影子路由启用
   `{"type": "json_object"}`(DeepSeek json mode;注意其两个已知边角:prompt
   须含 "json" 字样【契约已含】、偶发空 content【按 not_json 落账】,都要
   测试)。env `LYKOI_U3_SHADOW_JSON_MODE` 默认开、可关(conftest 补默认值,
   教训 36 口径)。**main 与 autonomous_cognition 路由一行不动、一个默认值
   不变**——透传参数不传时行为逐字节等于今天。
③ **契约强化**:`ENVELOPE_SYSTEM_PROMPT` 收尾追加明示("不要以对话口吻直接
   回答;你想对他说的话放进 decision.content 字段"一类,措辞你定);不放宽
   `evaluate_message` 的任何护栏(demote/fail-closed 注入门/溯源纪律不改)。
④ **零扰动**:旧路径与自主路径逐字节不变(复用 U3 判据⑧的四条口径断言);
   影子失败照旧静默、不重试、不影响回复。
⑤ **全邻接前台串行**:conversation 24 文件口径 + `llm_router`/`llm_client`
   邻接 + decide/autonomous 套件 + telegram 套件 + `tests/test_gate5_l1_scan.py`
   + `tests/test_p0_integrity.py`(重签后)。基线:全量 1982/3/6(2026-08-18
   复核权威值,3 failed = redaction×2 + claude 身份 p0 假失败)。
⑥ **manifest 重签**(现 110,前后条数写明);新增 env 全集入报告。
⑦ **报告(stdout 本体)**:①字段样例(构造的,非真实对话);②的插桩点与
   部署核对(哪个进程、要不要新 env 进单元——预期不要);你基于代码对 34 连败
   根因的推断(引用代码行,不臆测);每判据自证。

## forbidden

不动 main/autonomous_cognition 路由的行为与默认值;不动 kernel(本单预期
零 kernel 改动,若侦查发现必须动,停下写清楚);不碰 guardian/ 与
src/lykoi/core/;不删/不改影子机制的零副作用性质;她的回复原文/对话内容
不入任何日志字段;approval_rules 永无写路径;secrets 不入块与日志;凡与
本单口径冲突的侦查发现,停下写清楚。
