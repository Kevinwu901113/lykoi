# C1 缺失末项补收（evaluation / non-normative）

基线4e52d9e，分支wo/probe-cap-01-recovery。原报告的P4B-3-off两次样本缺失有确定的脚本原因：Python用join写plan且无末尾换行，原shell `while read -r k`在最后一次read返回非零时不执行循环体。最后一项正是P4B-3-off，每项本应跑2次。

修复循环保留无换行末项；新增首参数精确筛选一个试次key，缺省仍为原完整计划。无效key/计划生成失败立即退出。提示词、目标、模型参数、重复次数不变。

离线回归用真实planner+实际shell循环，分别验证完整计划和仅P4B-3-off，均读取末项且无重复；假run函数不调用API，不读取秘密。1项测试通过，bash语法检查通过。生产源码未改，不触及manifest域，不重复全仓回归。

Kevin以lykoi账号只补这两次：

```bash
bash governance/wo/PROBE-CAP-01/probe-cap.sh P4B-3-off > /tmp/probe-cap-p4b3-off.out 2>&1
```

期望只出现一次 `=== P4B-3-off` 和两条 content/usage 记录。若API错误、信封无效或截断，保留失败样本，不填作成功。输出人工检查后回传评分，原报告22条P4样本先不改；补齐后分母应为24。不得仅依据本修复推出剩余两条模型结果。
