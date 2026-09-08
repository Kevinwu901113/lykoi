# PROBE-RECALL-01 · Topic Recall Probe 准备

状态：脚本与本地验证完成，模型实测、生产统计未执行。基线6553f52，分支wo/probe-recall-01；non-normative / evaluation。运行时代码、manifest、状态库均未修改。

recall-stats.sql 使用真实history(event_type,content,ts)结构，只SELECT总数、30天按日计数、长度中位/p90、相邻间隔中位、无效JSON数量。需只读连接；不输出正文。日期是聚合键，其他输出为数字。

probe-recall.py 固定6个合成主题，每主题40轮；d为距查询深度，植入41−d轮。每个深度对W8/W8S/W8M重复两次，总144次回忆+48次摘要。摘要模板从当前src固定字符串读取，称呼按传入persona投影；dry-run缺省使用中性合成persona。只保存响应与usage，不保存persona请求体；输出私有且人工检查后才分享。失败记录保留，后续运行跳过已有记录；需要重试时使用新目录，不混淆重复试次。

本地两项测试通过：全部24种样本的深度/无答案泄漏，候选金额完整数字边界；内存SQLite真实schema与query_only验证统计中位/p90/间隔/坏JSON。dry-run规划192个请求，未调用API。该探针是受控模拟，不是生产完整Conversation回放；W8M只是理想命中对照。

## Kevin 执行

Python≥3.11，服务器lykoi账号，先核当前工作树：

```bash
sqlite3 -readonly /home/lykoi/state/memory.db < governance/wo/PROBE-RECALL-01/recall-stats.sql
set -a
. /home/lykoi/secrets/llm.env
set +a
python3 governance/wo/PROBE-RECALL-01/probe-recall.py \
  --persona /home/lykoi/runtime/persona/lykoi_base.toml \
  --output /tmp/lykoi-recall-trial --run
```

单请求240秒超时，固定HTTPS端点且拒绝重定向。输出失败时停止判读，保留记录查原因；不得用缺失摘要当作空摘要计算效果。只把经人工检查的合成试验响应/usage与统计汇总交回复核，不分享persona或密钥。模型仍可能复述输入，脚本不自动把输出入库。

## 待回填

Part A计数、Part B效果/token/cache表、摘要数字保留率、错报率、是否需要Topic/Thread全部待测，当前没有支持立项或不立项的真实读数。五项结论按rubric在样本齐套后写；未自动解锁任何人格层。
