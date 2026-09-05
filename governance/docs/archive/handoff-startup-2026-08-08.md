# 2026-08-08 接手流程存档

此段从 HANDOFF 第八节迁出，保留原文供历史追溯。命令、服务名、提交与环境均为当时的 Python 运行时，不适用于当前 Cordis。当前入口见 [HANDOFF](../../HANDOFF.md)。

## 八、接手第一步建议

> ⚠️ 本节写于 2026-08-08：第 3 条的期望值（HEAD/服务数）与第 4 条的"下一步"
> 早已过时，现状一律以第五节 2026-08-31 快照为准；本节保留的是流程骨架。

1. 读白皮书 v1.2 + 协作方案 + 本文件（尤其第四节的教训清单）
2. `ssh lykoi-gov` 确认能连；按第二节的表逐项验证权限边界（应能读代码、读不到 secrets 与 core.sock）
3. 确认活体健康：`ssh lapw1ng.com 'cd ~/projects/lykoi && git log --oneline -1; systemctl is-active lykoi-server lykoi-autonomy lykoi-core lykoi-watchdog; curl -fsS http://127.0.0.1:8080/health'` —— 期望 `74f5907c`、四个 active、health 含 `browser_request_guard=ready`
4. 下一步执行干净 Ubuntu 24.04 VM 从零重建演练；不要直接在生产恢复、不要把 secrets 放进备份。该门通过后再做 S4 Secret + 阶段 2 Delegation Gateway 联合边界设计。除非 Kevin 改变指示，不使用 Opus/Sonnet，主治理 Agent 直接实施
5. 按标准流程收：复核代码 → **自己跑测试**（`git worktree` 到 `/tmp` + 活体 venv，别碰活体检出）→ **必跑 `pytest tests/test_p0_integrity.py`** → 给 Kevin 精确到权限位与顺序的部署命令 + 回滚点

### 一次完整的复核长什么样（照抄这个流程）

以 SEC-02 为例，五步缺一不可：

1. 读 `git show --stat` 与完整 diff，判断改动方向是否符合工单
2. `git worktree add /tmp/xx-test <分支>`（以 lykoi 身份），用 `~/projects/lykoi/.venv/bin/python -m pytest` 跑相关测试
3. **功能性验证**——不止看测试绿，要真的调用它证明目标达成（如直接 `browser.navigate()` 打内网地址看是否 `UrlBlocked`）
4. 反向核对（如遍历六目录确认每个 `.py` 都在 manifest 里）
5. 写 `wo/<WO-ID>/review.md` 归档，记 `governance-ops.jsonl`，给 Kevin 部署命令

**这套流程在 SEC-01 和 SEC-02 各抓出一个会导致三服务全停的缺陷。不要跳步。**

> 一句话原则（白皮书结论章）：**可以重构 Lykoi 的软件身体，但不能未经判断地丢弃她已经形成的经历、关系和身份。**
