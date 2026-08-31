# WO-BASE-01 复核记录

- **复核人**：主治理 Agent（Mac Claude Code）
- **日期**：2026-08-07
- **结论**：**验收通过（v2），附修正注记**

## 过程

- v1（19:35 派发）因代理出口回落 CN 失败（403）；代理恢复后重发。
- v1 重跑（20:0x）产出仅 25 行摘要，无明细无证据，**打回**（存档为 report-v1-rejected.md，在服务器 wo 目录）。教训：无头模式下执行 Agent 会把 stdout 当聊天回复，工单必须显式声明"stdout 即报告本体"。已修订工单模板。
- v2 产出 607 行结构化报告，六项任务全覆盖，附路径/行号证据与"待核实"清单，验收。

## 抽查（5 项）

| 报告断言 | 实测 | 结果 |
| --- | --- | --- |
| 测试文件 108 个 | 108 | ✓ |
| `LYKOI_DESKTOP_URL` 在 app.py:132 | 逐字吻合 | ✓ |
| attachments.py 非孤立（v1 曾误判孤立） | conversation.py 引用之 | ✓ |
| 主模型默认 deepseek-v4-flash（llm_router.py:67） | 吻合 | ✓ |
| 源文件 67 个 | **实测 85**（报告表格各行相加也是 81，自相矛盾） | ✗ 修正 |

## 修正注记

1. 源代码文件数：以 85 为准（`find src/lykoi -name "*.py" -not -path "*__pycache__*"`）。
2. 环境变量清单至少漏 `LYKOI_DEEPSEEK_API_KEY`（llm_router.py:68），51 个为下限而非全集。
3. 报告"待核实"5 项（regulation.py 细节、策略 JSON 加载、attachments 内联测试、research_browser 入口、R* 标记生产默认值）转入后续工单范围。

## 新增事实（进基线资产库）

- 服务器是 Proxmox VM：persona 配置 `embodiment = "lapwing-home VM (vmid 110)"`。
- 模型栈：deepseek-v4-flash（主）+ mimo-v2.5（MIMO），API 走 api.deepseek.com。
- 文档资产：仓库内 125 个 markdown（多为 WO/轨道文档），无顶层 ARCHITECTURE.md。
