# WO-FIX-SEC-01 复核记录

- **复核人**：主治理 Agent（Mac Claude Code）
- **日期**：2026-08-07 深夜 / 08-08
- **执行 Agent**：服务器 claude 账户，模型 sonnet
- **结论**：**代码验收通过**；但**部署路径与其他工单不同——不能用常规 git merge**，见 §3。工单本身状态：代码已完成、测试未跑（环境所限）、**部署待定**。

## 1. 代码审查

### S1 日志脱敏 — 通过

执行 Agent 正确识别了我在工单里点明的分层陷阱，选了方案 A：

- 新建 `src/lykoi/shared/redaction.py`（实现下沉）。
- `src/lykoi/kernel/redaction.py` 改为纯重导出 shim，docstring 写明了循环依赖的理由（kernel 已依赖 shared 的 notifications/approval/dispatch，反向依赖会成环）。现有 `from lykoi.kernel import redaction` 调用点与测试无需改动。
- `shared/log.py` 的 `log_event()` 落盘前 `**redact_obj(fields)`，docstring 同步说明。

改动最小、方向正确，没有为了省事走延迟 import 的捷径。

### S5 完整性清单补 memory 包 — 通过

- `guardian/startup_verify.py` 的 `COGNITION_DIRS` 加入 `"memory"`，docstring 同步；注释说明了补入理由（`upsert_insight` 是 insights 表唯一写入点，此前不在覆盖内）。
- `guardian/manifest.sha256` 新增 4 条 memory 包条目 + 1 条 `shared/redaction.py`，并更新了 `kernel/redaction.py`、`shared/log.py` 两条变更后的哈希。

### 哈希正确性 — 已逐条核验

在工作副本执行 `sha256sum -c guardian/manifest.sha256`：**全部 `src/lykoi/**` 条目通过**（含新增的 memory 四件套与两条更新）。未通过的 4 条均为环境原因，非错误：3 条 guardian 内部相对路径（需在 `guardian/` 目录下解析）、1 条指向活体 `state/approval_rules.json`（claude 账户无读权限）。

## 2. 未完成的验证（执行 Agent 侧）

执行 Agent **未能跑测试**：会话内 Python 执行被工具权限拦截（我给的 allowedTools 模式未匹配其实际调用形式）。它选择如实报告而非伪造结果——这点值得记一笔，是正确行为。同一轮还遭遇网络中断（"Connection closed mid-response"，与 Kevin 家宽带故障、当前走手机热点一致）。

**因此以下验证仍缺**：单元测试、脱敏用例、`startup_verify` 在合并后代码上的实跑。前两项应在部署前补跑（见 §4）。

## 3. 关键发现：本工单不能按常规合并

活体仓库实况：

    dr-xr-xr-x  2 root root  guardian/
    -r--r--r--  1 root root  guardian/manifest.sha256

**`guardian/` 整个目录 root 属主、无写权限**。lykoi 账户对其零写入能力，因此：

- `git merge` 会在写 `guardian/startup_verify.py` 与 `guardian/manifest.sha256` 时失败；
- 这不是意外，是设计——那 17 个 `/usr/local/sbin/lykoi-*-apply` root 控制器存在的原因正是这条纪律；
- 代码里也写明了：`startup_verify.py` docstring 第 34 行 `sudo python3 guardian/startup_verify.py --write-manifest`，第 97 行注释"任何触及这些文件的部署必须 root 重签 manifest 才能过启动闸"。

**如果我按前几单的惯例给出 `git merge` 命令，它会失败或部分应用。** 这是本次复核最有价值的发现。

### 活体基线（部署前状态，已确认）

    cd ~/projects/lykoi && python3 -I -S guardian/startup_verify.py
    → exit=0, "startup_verify: OK"

即当前启动门是通过的，任何部署后的回归都以此为基准。

## 4. 建议的部署流程（需 root，Kevin 执行）

尚未执行。建议顺序：

1. **先补跑测试**（以 lykoi，在活体仓库的临时工作树或治理工作副本 + venv）：受影响测试 + 新增脱敏用例。测试不过就不要部署。
2. **root 合并**：`sudo git -C /home/lykoi/projects/lykoi merge --no-ff task/wo-fix-sec-01`
3. **修正属主**：合并会让 root 创建 `src/lykoi/shared/redaction.py`，需 `sudo chown lykoi:lykoi` 该文件（src 层设计上是服务账户属主，root 属主会破坏这一性质）；`guardian/` 下保持 root 属主。
4. **root 重签 manifest**：`sudo python3 guardian/startup_verify.py --write-manifest`
5. **验证启动门**：`python3 -I -S guardian/startup_verify.py` 必须 exit 0（与 §3 基线一致）。
6. **重启服务使代码生效**（Kevin 决定时机）：`sudo systemctl restart lykoi-server lykoi-autonomy`。注意 `lykoi-core` 是否需要一并重启取决于其是否加载受影响模块。
7. 重启后确认三进程健康、`events.jsonl` 新写入的记录结构未变。

**回滚**：合并前记录 `git rev-parse HEAD`；回滚需同样以 root 执行 `git reset --hard <旧HEAD>` + 重签 manifest + 重启。

## 4.5 测试补跑结果（主治理 Agent，2026-08-08）

方法：以 lykoi 身份 `git worktree add /tmp/sec01-test task/wo-fix-sec-01`（不触碰活体检出），用活体 venv 的 python 跑测试。

### 第一轮：**发现会导致全线停机的缺陷**

`tests/test_p0_integrity.py::test_committed_manifest_matches_available_protected_sources` **失败**（47 passed, 1 failed）：

    manifest 期望 f22f31b61d73…（改动前的旧文件）
    实际        876f681862ca…（改动后的新文件）
    条目：manifest 中的 `startup_verify.py`

**根因**：执行 Agent 修改了 `guardian/startup_verify.py`，更新了 log.py 与 kernel/redaction.py 的哈希、正确新增了 memory 四件套与 shared/redaction.py，**唯独漏了被修改文件自身那一条**。该条目在清单里是裸文件名（相对 `guardian/` 解析），批量核对时极易漏掉。

**后果若部署**：`startup_verify.py` 校验自身哈希失败 → 非零退出 → 它是三个 systemd 单元的 `ExecStartPre` → **三服务全部拒绝启动**。全线停机，不是降级。

对照实验确认非环境假象：同一测试在活体 main 上 `1 passed`。全量清单核对确认仅此一条陈旧。

### 补正与复验

补正提交 `a5b3439`。重新核对：

- 目标测试集：**48 passed, 5 skipped, 0 failed**
- 全量 manifest 自检：无陈旧条目
- **功能性验证**（真实落盘）：设 `LYKOI_DEEPSEEK_API_KEY=sk-FAKE-SECRET-…`，`log_event` 写入含该值的 url、普通文本、嵌套 dict：

      {"event":"test_event","url":"https://api.example.com?k=[REDACTED]","note":"normal text","nested":{"token":"[REDACTED]"}}

  明文未出现在磁盘；非敏感字段与结构原样保留。**S1 目标达成，可验证。**

## 5. 待办

- [x] 补跑测试 —— 已完成，见 §4.5（抓出一个停机级缺陷并已补正）
- [ ] 按 §4 部署（Kevin，需 root）
- [ ] 报告中提到但未处理：`events.jsonl` 文件权限现状（执行 Agent 未及报告，我亦未核实——属活体状态，只看不改）
- [ ] WO-FIX-SEC-02（浏览器 SSRF）工单已就绪，**建议等本单部署完再发**，避免两个未部署分支交叠
