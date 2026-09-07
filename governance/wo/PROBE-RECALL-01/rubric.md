# Topic Recall Probe 评分（non-normative / evaluation）

每个 case×depth×mode×repeat 保存独立原始响应、usage、耗时和finish_reason。命中：回答肯定地给出正确店名与金额；半命中：只记得一项；错报：肯定给出错误金额；遗忘：明确记不清。引用错误值用于否定不算错报，提及无关数字不算错误金额。机器候选标签不代替人工评分。

按mode×depth列有效样本数/预期12、命中率、错报率、半命中率、遗忘率及失败/截断数；失败不默默移出分母。摘要组另外列摘要是否保住植入名词/数字、摘要请求耗时与token。W8M条件使用人工准确命中的一条记忆，测采用率，不测检索率。

供应商usage字段缺失记null，不能估造token或cache hit。分别列prompt_tokens、completion_tokens、prompt_cache_hit_tokens、prompt_cache_miss_tokens，说明相同请求重复与不同装配前缀会影响缓存，不能直接把服务端命中变化当作生产缓存损失。

六段日常对话是固定合成夹具，填充轮刻意不重复目标事实，不能代表真实话题分布；统计SQL只能给互动频率/文本长度，不能推断语义话题深度。Topic/Thread是否立项仍须结合实际样本与治理裁定。
