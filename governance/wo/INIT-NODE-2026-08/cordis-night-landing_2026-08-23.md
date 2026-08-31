# Cordis 总攻落地记录（2026-08-23 晚 → 08-24 00:31 收官）

- **执行**：Kevin root 会话三段（原稿 + 续跑稿 1 + 续跑稿 2，后两段经聊天呈递、owner 亲手执行=现场批准）
- **活体终态**：HEAD `4463ae8` = tag `cordis-night-20260822`；回滚锚 `rollback-pre-cordis-night` = `32238013`
- **提交链**：`32238013` → `f40520f` [MERGE] U3S → `be2fba1` [GOV] HARD_ASK → `2f91128` [MERGE] CB-01 → `83b6025` [MERGE] GW-02 → `b124bc4` [GOV] manifest 重签 113 → `e9ddd60` [GOV] U3S 锚点修正 → `4463ae8` [GOV] GW-02 锚点修正
- **切换态**：`20-u3-switch.conf` drop-in 在位（`LYKOI_U3_SWITCH_ENABLED=1`），00:31:08 起生效。**U3 周期合一自此上线**；CB 心跳影子同时自动上岗（零 LLM/零表写）。
- **验证**：C 步三段 187+66+200 全绿；A/B 两段重启均 `startup_verify: OK`；五服务 active、NRestarts 全 0；manifest 113 条 root 属主；`.git` root 残留 0；00:31 后 server/telegram 日志零异常。

## 落地途中拦下的三颗雷（均为"凭记忆写标识符"类，教训 42 家族）

1. **幻影服务名**（落地前终检抓出）：原稿三处 `lykoi-perception-ingest`——systemd 里根本不存在的单元，`set -e` 下前验必死。改回 init-node 实证过的 `lykoi-watchdog`。修正稿 sha256 `12149624`，治理仓库 @ 7d63057。
2. **U3S 自证锚定 HEAD**（C 步 1 段 186/1 红）：`test_u3s_zero_disturbance.py::test_the_forbidden_neighbours_are_untouched` 硬编码 `git diff 7b00ae5e..HEAD`。分支上自证成立，合并树上必炸。10 个"越界"文件逐一归账：GW-01 六件（包 15 已复核落地、在活体基内）+ CB-01 三件（本次 M2，复核 PASS）+ `guardian/policy_core.py`（HARD_ASK 步 3，Kevin 批）；U3S 自身 `7b00ae5e..55921d33` 仅动 manifest（=测试自己的豁免项）。**零真实违规**。修法：diff 终点钉到复核过的不可变分支尖 `55921d33`（commit `e9ddd60`）。
3. **GW-02 自证锚定 HEAD**（C 步 3 段 196/4 红）：`test_gw02_zero_disturbance.py` 两处 `f"{BASE}..HEAD"`（65/159 行），同类同账。修法：钉 `076634f9`（commit `4463ae8`）。

全树扫雷结论：HEAD 锚点自证测试仅上述两件；4 个 0600 测试文件在干净 clone 里核过零 HEAD 锚；其余命中均为 `INJECTION_HEADER` 类子串假阳性。

## 遗留记账

- **潜伏雷（不拆，归后续小单）**：`test_gw02_deployment.py:149` 同型 `{base}..HEAD` 锚，断言既有 systemd 单元文件零 diff——本轮没人动单元文件所以是绿的；未来任何合法触碰单元文件的合并会误炸。修法同类（钉尖），可并入下一张 GW 域小单。
- **教训 42 扩条建议（入 HANDOFF）**：粘贴稿/自证测试里的一切标识符——测试文件名、systemd 单元名、diff 锚点——必须对树/对系统核实，禁止凭记忆写；**零扰动自证测试的 diff 终点必须钉分支尖，永远不许写 HEAD**（分支上等价，合并树上必炸，已连炸两单）。
- ~~E 步实弹（待 Kevin）~~ → **已实弹并止损（08-24 00:53–01:07，切换态存活 36 分钟）**：轮 1（喂喂喂）信封回复正常送达 ✓；轮 2（CPBL 提问）/轮 3（人呢）均 `u3_cycle_failed: ValueError not_json, first_char:empty` → 降级沉默（4 次信封调用 2 失败）。**定性**：completion 54/81 tokens 但 content 空 = DeepSeek json 模式已知空回复形态，json_object 强制挡不住；影子期"json 修复后零失败"底数仅 1 样本，欠采即切换（盲切授权下的已知风险兑现）。**第二缺陷**：轮 2 信封 kind=tool_call 记 `dispatched: research_browser.open`（自称事实），kernel/audit 零痕迹——派发执行链或审计面有洞。**她认知行为正确**：先查证再回话（内心独白明言）+ 唤醒试图 explore 查比分被候选集拦（`decision_ungrounded: kind_not_in_candidates`，归 C-B 唤醒候选设计）。Kevin 删 drop-in 止损，01:07:20 回影子态（代码不回滚，4463ae8 保留，信封继续影子双跑攒失败直方图）。**修复单 WO-U3S-FIX-01（待签发）**：①契约失败有界重试一次（带 nudge）再失败才沉默 + `u3_cycle_failed` 补原始响应长度/reasoning 字段；②对话轮 tool_call 派发执行链与审计面定位修复。E 步②（终端任务→审批问句引用回复）未测，随修复后重实弹。切换键价值实证：36 分钟暴露两真缺陷，一条命令退回，零代码回滚。
- 另册未动：lykoi-runner/broker 系统安装（`docs/wo_gw02_merge_checklist.md`，前提=代理箱 ACL）；追认 5 条与转呈 5 项决断仍待 Kevin。
