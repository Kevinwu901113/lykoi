# WO-P2-S1A · messenger 资源（她的社交器官，第一步：资源层）

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work`（分支 `wo/p2-s1a`，基于活体 main `89d0247f`）
实现本工单。设计基准：`~/lykoi_embodiment_redesign_v1_2026-08-09.md`（定案，§1.1/§1.2 必读）。

## 输出纪律

- **stdout 即报告本体**，禁止摘要代替明细，宁长勿略。
- **禁止在工单里等待长任务**：跑全量 pytest 前**必须先 `git commit`**；长测试用
  `timeout 1800` 包住，超时就报告"未跑完"，不要挂起会话。
- **必答硬数字**：新增/修改文件数与行数；专项测试用例数与通过数；
  `tests/test_p0_integrity.py` 通过数；manifest 新增/修改条目数。

## 背景（一句话）

Lykoi 将通过**她自己使用的社交软件**与主用户相处。哲学定调：IM 是她身体的**器官**，
与她的浏览器同构——她**经 dispatch 发出动作**去操作它，而不是被平台自动投递消息。
本工单只做**资源层**（真正的 Telegram 设备进程是下一单 S1B，本单用可替换的传输抽象）。

## goal

1. **新资源 `src/lykoi/resources/messenger.py`**（属 manifest 覆盖的六目录之一，见纪律）：
   - `send(text: str, *, context_id: str, reply_to: str | None = None) -> dict`
   - `read(limit: int = 20, *, context_id: str | None = None) -> dict`
   - 严格遵循 `src/lykoi/resources/` 下现有资源（先读 `browser.py` / `terminal.py` /
     `notify.py`）的**签名风格、返回结构、异常约定**——不要发明新范式。
2. **传输抽象**：定义 `Transport` 协议（`send_message` / `fetch_updates`），
   messenger 只依赖协议不依赖具体平台；本单提供 `NullTransport`（记录到本地 JSONL、
   不发网络）作为默认实现，供 S1B 替换为真 Telegram。**不要在本单实现任何 Telegram
   API 调用、不要引入新依赖。**
3. **接入 dispatch**：在 `src/lykoi/kernel/dispatch.py` 的资源表注册 `messenger`，
   使 `messenger.*` 动作走既有 dispatch 管线（审批门 / immutable audit / shadow /
   预算全部自动继承）。**不要绕过 dispatch 另开路径。**
4. **打扰纪律（策略层，硬编码常量集中一处便于后续调整）**：
   - 日上限 1 条主动消息、冷却 6 小时；
   - **回复类消息不受此限**（回应主用户的话不算打扰）；
   - 计数与冷却状态持久化（选一个与现有实现风格一致的位置，说明你的选择）；
   - 超限时 `send` 返回明确的拒绝结果，不抛异常、不静默丢弃。
5. **入站事件**：提供 `ingest_inbound(raw) -> dict` 把一条入站消息规范化为事件结构
   （复用现有事件协议的字段风格），**本单只做规范化与落地，不接注意力管线**
   （接管线属 S1B/S2）。

## scope / forbidden

- 允许改：`src/lykoi/resources/messenger.py`(新)、`src/lykoi/kernel/dispatch.py`(注册)、
  `tests/`(新增)、`guardian/manifest.sha256`(重签)。
- **不改** surface 层、不改 core、不动 `/chat` 等既有端点、不碰 broker。
- 不实现 Telegram 具体协议、不加依赖、不建 systemd 单元。
- 不 push、不合并；提交留在 `wo/p2-s1a`。

## manifest 纪律（历史上让三服务全停两次）

本单必然触及 `resources/` 与 `kernel/`——**必须**用
`python3 guardian/startup_verify.py --write-manifest` 重签，并在报告中给出 manifest diff。
完成后跑 `pytest tests/test_p0_integrity.py` 并报数。
（注意：以 claude 身份跑该测试会有 1 个既有假失败——
`PermissionError: /home/lykoi/state/approval_rules.json`，属身份权限伪影，如实报告即可。）

## success_criteria

1. `messenger.send` / `messenger.read` 经 dispatch 调用成功，动作出现在审计中（用测试断言）。
2. 打扰纪律：第 2 条主动消息在同日被拒；冷却期内被拒；**回复类不受限**——各有测试。
3. NullTransport 不产生任何网络 I/O（测试断言）。
4. 入站规范化：字段完整、异常输入不崩。
5. 全量 pytest 无**新增**失败（既有失败清单见下，如实对照）；p0 除上述伪影外全过。

**既有失败对照（不是你引入的，别去修）**：约 10 个 `_rollout`/`_activation` 用例断言
文件模式 `0o755` 而工作副本是 `0o775`；2 个 `test_core_v1_shadow.py` 超时。

## required_evidence

git log/diff --stat、messenger.py 完整签名清单、打扰纪律的常量与持久化位置、
每条测试用例名+结果、manifest diff、必答硬数字。
