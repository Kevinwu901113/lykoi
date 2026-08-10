# WO-L1 交接 · 给新窗口 · 2026-08-10

Kevin 决定 L1 在新窗口执行，本窗口继续 S2。本文件是新窗口开工所需的全部内容。

---

## 一、先读什么

1. **`wo/WO-L1/briefing.md`**（同目录）——L1 的前因证据链、内容、后果、
   **可直接派发的工单正文**、风险与回滚。你要做的事全在里面。
2. `docs/learning_layer_v2_design_2026-08-10.md` §3.1 / §3.2 / §5——L1 在整个重构里的位置。
3. `HANDOFF.md` 第四节教训 23–27（无头执行 Agent 的坑，尤其 26 关于并行冲突）。

## 二、⚠️ 与本窗口的冲突点与解法（最重要的一条）

**L1 触及 `mind/`/`memory/`，本窗口的 S2 触及 `kernel/`——两者都在 manifest 覆盖的
六目录内。** 按教训 26，六目录锁本该同一时间只发一单。让两条并行的机制：

1. **用独立 worktree**，不要动我正在用的 `~/lykoi-work`：
   ```
   ssh lykoi-gov 'cd ~/lykoi-work && git worktree add ~/lykoi-work-l1 -b wo/l1 <活体main>'
   ```
   （broker 那单就是这么并行的，已验证可行。）
2. **manifest 冲突是可预期且可解的**：`guardian/manifest.sha256` 是从文件确定性重算的，
   两个分支各自重签必然在 git 层冲突。**解法：合并时重跑一次
   `python3 guardian/startup_verify.py --write-manifest` 即可**（root 执行，
   与 P2-01 合并流程相同）。不要试图手工合并 manifest 文本。
3. **合并顺序要协调**：先合谁都行，但**第二个合并的必须重签 manifest**。
   合并前在此文件末尾追加一行说明谁先合了，避免两边都以为自己是第一个。

## 三、服务器执行环境（本窗口已备好，直接用）

- 连接：`ssh lykoi-gov`（治理账户 claude），活体是 `ssh lapw1ng.com`（lykoi 身份）
- **派发脚本**：`~/bin-dispatch.sh <WO-ID> <workdir> [model]`
  - model 默认 sonnet；**复杂单用 `opus`**（Kevin 2026-08-10 定：sonnet 跑不动的用 opus，
    服务器 settings 里 effort 已是 medium）
  - 内置 3 次重试；**每次重试前自动 `git commit` 保存 WIP**（我今天补的，
    防止网络中断丢工作）
  - 工单必须放 `~/wo/<WO-ID>/order.md`（脚本硬读这个文件名）
- 延时派发（撞额度上限时用）：`~/bin-delayed-dispatch.sh <WO-ID> <workdir> <model> <HH:MM>`
- **活体当前 HEAD：`89d0247f`**（P2-01 数据模型 + P2-03A broker 已合并）

## 四、当前未合并的分支（别踩）

| 分支 | 内容 | 状态 |
|---|---|---|
| `wo/p2-s1a` | messenger 资源层 | 已复核通过，待合并 |
| `wo/p2-s1b` | Telegram 设备（基于 s1a） | 已复核通过，待合并 |
| `wo/p2-s2` | 审批解释器（基于 s1b） | **本窗口正在跑** |

三者线性叠加，合并最后一个即含全部。L1 应基于**活体 main `89d0247f`**，
不要基于这三个分支中的任何一个。

## 五、L1 的验收要点（复核时重点查）

1. **分类数字必须吻合**：原料池 **1337**、档案层 **3531**（合计 4868）。
   对不上就说明判据实现有偏差——这是一次免费的正确性验证，别放过。
   - 拆解：对话 116 + 感知 1178 + `action_result` 中 >80 字符的 43 = 1337
2. **行为零变化**：integrator 与 `pending_experiences` 的现有测试必须全部照常通过。
   L1 只建分类，不改任何消化行为。
3. **不改 `experiences` 表结构、不动 append-only 触发器**（用影子表，照
   P2-01 `memory_scopes` 的做法）。
4. **可重入**：回填跑两次结果一致。
5. **逆迁移**：删掉影子表即回到现状。
6. manifest 重签 + `pytest tests/test_p0_integrity.py`
   （claude 身份下有 1 个既有假失败 `PermissionError: approval_rules.json`，是权限伪影，
   活体以 lykoi 身份跑为 25 passed——别把它当真缺陷）。

## 六、Kevin 尚未答复的一个问题

**L1 的历史回填要不要直接在活体上跑？**
我的建议（已写进 briefing §六）：**要**。零行为影响、不需要停 autonomy
（只写新表，不锁 `experiences`），而且回填结果本身就是上面第 1 条的正确性验证。
新窗口开工前跟 Kevin 确认一句。

## 七、其它待办（不属于 L1，但新窗口可能看到）

- **活体 memory.db 迁移（v9→v10）仍未执行**——需 Kevin 以 root 停 autonomy，
  程序见 `wo/WO-P2-MIGRATE/procedure.md`。**L1 的影子表不依赖它**（L1 建自己的表），
  但如果两件事一起做能省一次停机。
- Telegram 上线序列见 `wo/WO-P2-DEPLOY/sequence.md`（四步 + 3b/3c）。

---

## 合并协调记录（谁先合了，在这里追加一行）

- （尚无）
