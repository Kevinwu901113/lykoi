# WO-OBS-LLM 复核 · 2026-08-12 · PASS(续跑一轮后)

**有效提交:`wo/obs-llm` @ `5c63187a`**(叠 `wo/l4` @ 3a29112c)。

## 过程记录

首轮 EXIT=0 假阳性(教训 31c 形态):实现与测试落盘,但 Agent 把 pytest 丢后台
并以"等它跑完"收尾——会话退出即后台死,报告 1 行、manifest 未签。续跑单钉死
"前台串行禁后台"后一轮收官(06:17)。

## 审读

- **实现(+13 行)**:`log_event("llm_call")` 从请求前挪到 200 响应解析后,
  附 usage 四数(`prompt/completion/cache_hit/cache_miss_tokens`),
  `usage or {}` + 逐字段 `.get()`,缺省 None 不抛。✅
- **遥测语义变化已核**:失败路径本有独立 `llm_error` 事件(llm_client.py:161),
  挪位后无调用不可见,`llm_call` 语义=成功调用;src 内无代码消费此事件名。
  报告的取舍说明完整。✅
- **零行为**:重试逻辑、返回值、失败路径逐字未动;既有 P0-4 套件 23 条全过
  (含追加的 3 条 usage 钉子:四数齐全/整体缺失/部分缺失三形态)。✅
- **清单结果**:6 个命中文件串行跑,仅两个 root_apply.sh 权限失败
  (0o775 vs 0o755,与我 L4 全量基线中同名失败一致,checkout 环境性,非本单引入)。
  p0 重签后回基线(仅 approval_rules.json 读权限环境项)。✅
- **manifest**:105→105 仅 llm_client.py 一条哈希变化;我独立重算
  105/105、mismatch 0。✅

## 效果

合并重启后 usage 四数立即开始按 route 入账——1 天基线观察期从部署时刻起算
(观察方案:docs/llm_cache_observability_plan_2026-08-11.md 第 2 步,
decide 路由做对照组)。
