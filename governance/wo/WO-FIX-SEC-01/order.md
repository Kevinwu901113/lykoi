# WO-FIX-SEC-01：事件日志脱敏（S1）+ 完整性清单补 memory 包（S5）

你是 Lykoi 治理平面的执行 Agent。允许修改代码，仅在工单分支，不得合并。

## 通用纪律

- 从 main 新建分支 `task/wo-fix-sec-01`，提交前缀 `[WO-FIX-SEC-01]`。
- 禁区：`/home/lykoi/secrets`（不读）、`core.sock`、systemd/进程操作、对 `/home/lykoi/state` 的任何写入。
- 你（claude 账户）读不到活体 state，无法做端到端实跑；实跑验证由主治理 Agent 以 lykoi 身份执行。
- **本工单涉及启动门，改坏会导致服务起不来**——见 §2 的红线。

---

## 1. S1：事件日志脱敏

### 现状（已核实）

`src/lykoi/shared/log.py` 的 `log_event()` 把 `**fields` 原样 `json.dumps` 写入 `state/events.jsonl`（当前约 6MB），全函数无脱敏。`kernel/redaction.py` 提供 `redact()` / `redact_obj()`，但全仓仅 3 处调用，全在 `kernel/dispatch.py`（307、648、650）——脱敏只覆盖"返回给认知层的观测结果"，不覆盖磁盘日志。

### 这不是一行代码能解决的——先解决分层问题

`kernel` 依赖 `shared`（例如 `kernel` 侧 import `shared.log`）。若让 `shared/log.py` 直接 import `kernel.redaction`，会形成循环依赖。**这很可能就是当初没做脱敏的原因。**

请先用 grep 确认真实依赖方向，然后在以下方案中选择并说明理由：

- **A（推荐起点）**：把脱敏实现下沉为 `src/lykoi/shared/redaction.py`，`kernel/redaction.py` 改为从 shared 重导出以保持现有调用点与测试不变。
- **B**：在 `log_event` 内做函数级延迟 import（可行但掩盖分层问题）。
- **C**：其他方案，需说明为何优于 A。

### 要求

1. `log_event()` 落盘前对 fields 走脱敏（对象递归版本）。
2. 脱敏不得破坏日志可用性：结构、键名、非敏感值保持原样，只替换命中的敏感串。
3. **不得引入性能悬崖**：`log_event` 在自主循环里高频调用，脱敏实现若是"对每个字符串扫描全部已知密钥"，请确认密钥集合在进程启动时快照一次而非每次读环境（现有实现可能已是如此，核实并说明）。
4. 补测试：至少一条"含密钥的字段写入后，落盘内容不含明文"的用例。
5. 顺带核实并在报告中说明：`events.jsonl` 的文件权限是什么，是否需要一并收紧（**只报告，不要改权限**，那属于活体状态）。

---

## 2. S5：完整性清单补 `src/lykoi/memory/`

### 现状（已核实）

`guardian/startup_verify.py` 的 manifest 覆盖 `cognition` / `mind` / `shared` / `surface` / `resources` 五个包，**独漏 `src/lykoi/memory/`**（4 个文件，含 `insights` 表的唯一写入点 `upsert_insight`）。

### 红线（务必遵守）

`startup_verify.py` 是三个 systemd 单元的 `ExecStartPre`——**它返回非零，服务就起不来**。因此：

1. 先读懂 manifest 的机制：是硬编码路径列表、还是带期望哈希？哈希从哪来、何时更新？把机制在报告里讲清楚**再动手**。
2. 如果 manifest 含期望哈希，你必须一并给出**正确的哈希生成方式**，并在报告中写明主治理 Agent 该如何在合并前验证（例如"在活体仓库执行 `python guardian/startup_verify.py` 应退出 0"）。
3. **绝对不要**为了让校验通过而放宽校验逻辑。若发现补入 memory 包会导致现有校验失败，停下来在报告里说明原因和建议，不要自行绕过。
4. 若 manifest 的正本在仓库之外（如 root 属主路径），只在报告中指出并给出建议，不要尝试访问。

---

## 验证要求

1. `python -m pytest` 相关测试通过（只跑受影响的测试文件，不要跑全量以免超时）；说明跑了哪些、结果如何。
2. `python guardian/startup_verify.py` 在**你的工作副本**上的行为（可能因不在活体环境而失败，如实报告，不要伪造）。
3. `git diff` 全文。
4. 给主治理 Agent 的实跑检查点 3-5 条，其中必须包含"合并前如何确认启动门不会挡住服务"。

## 输出要求

**不要写报告文件；stdout 即报告。**第一行 `# WO-FIX-SEC-01 执行报告`。禁止对话性语句。禁止用摘要代替明细。
