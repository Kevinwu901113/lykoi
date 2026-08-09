# WO-P2-03A · Secret broker 服务（设计 v1 §4.2，与 WO-P2-01 并行 lane）

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work-broker`（分支 `wo/p2-03a`）实现本工单。
设计基准：`~/phase2_joint_design_v1_2026-08-09.md` §4（冻结版，不得偏离）。

## 输出纪律

- **stdout 即报告本体**；禁止摘要代替明细，宁长勿略。
- **必答硬数字**：新增文件数与总行数；pytest 通过/失败/跳过数；六目录改动文件数
  （**必须为 0**，见 forbidden）；测试覆盖的场景数。

## goal

实现凭证 broker 最小可用版（http_proxy 型，第一个 handle=`llm.deepseek.chat`）：

1. 新包 `src/lykoi/broker/`（新目录，独立服务，入口 `python -m lykoi.broker`）：
   - FastAPI + uvicorn（仓库现有依赖，不新增依赖）
   - 配置：`LYKOI_BROKER_HANDLES`（yaml 路径）+ `LYKOI_BROKER_SECRETS`（真 key 的
     env 文件路径，仅 broker 进程读）+ `LYKOI_BROKER_PORT`（默认 127.0.0.1:8090）
     ——**yaml 解析用 stdlib 可行的最小子集或 json，不引入 pyyaml**（依赖零新增优先，
     配置格式可改 json，如实报告你的选择）
2. 票据机制：
   - `POST /grant`：入参 `{handle, contract_id, ttl_s}`，鉴权头 `X-Broker-Admin`
     （值来自 env `LYKOI_BROKER_ADMIN_TOKEN`）；返回一次性会话票据
     `{ticket, expires_at}`。票据随机 ≥128bit，内存存储即可（重启即失效，可接受并记录）。
   - 反代路径 `POST /proxy/{handle}/...`：校验头 `X-Lykoi-Ticket`（有效、未过期、
     handle 匹配），按 handles 配置把请求转发到上游 base_url + 注入真实 API key，
     流式响应透传。路径必须命中 handle 的 `allowed_paths` 白名单，否则 403。
3. 审计：每次 grant 与每次 proxy 使用，append 一行 JSONL 到 `LYKOI_BROKER_AUDIT`
   路径（ts/event/handle/contract_id/ticket 前 8 位/结果），**绝不落任何 key 明文**。
4. 错误纪律：上游错误透传状态码；broker 自身错误响应**不得包含**上游 key、票据全文、
   handles 配置内容。
5. `lykoi-broker.service` 单元文件草稿放仓库根（User=lykoi-broker 占位，不安装）。

## forbidden

- **六目录（cognition/mind/memory/shared/surface/resources）与 kernel/core/guardian
  一个字节都不许改**——这是与 WO-P2-01 并行的前提。manifest 不动。
- 不碰活体路径；不使用任何真实 API key（测试用假 key 断言注入行为）。
- 不 push；提交全部留在 `wo/p2-03a`。

## success_criteria

1. 单测（fake 上游 http server）覆盖：①key 注入正确且响应透传；②无票据/过期票据/
   handle 不匹配 → 401/403；③路径不在白名单 → 403；④审计行数与调用数一致且无 key
   泄漏（对审计文件全文 grep 假 key 必须 0 命中）；⑤错误响应体无 key/无票据全文。
2. 全量 pytest 无新增失败；`tests/test_p0_integrity.py` 全过（应天然不受影响，报数确认）。
3. `git diff --stat` 证明改动全部在新目录 + tests + 仓库根 unit 草稿。

## required_evidence

- `git log --oneline`、`git diff --stat`
- 五组场景测试的实际输出
- 审计 JSONL 样例 3 行（脱敏后）
- 必答硬数字
