# WO-E4-5 · 实例事实静态门

状态：`wo/e4-5`，基线 `343351e`；本地实现与验证完成，未合并、未部署，root 域源码待治理复核。

新增 `instance_facts` 检查并登记在 verify 的统一检查表；CLI 已通过同一 verify 输出 FAIL，无需第二套输出逻辑。扫描 packages/*/src 的 TS 字符串和模板片段、profile/deploy 的非注释配置值。报告文件、行、命中 token；读失败和扫描面符号链接报失败。只依赖 Node 内置模块，没有新增运行时依赖。

TS 扫描跳过注释、标识符和通常的正则表达式，保留字符串中的 URL、# 与插值内字符串，识别固定长度 Unicode/hex 转义。配置值支持带引号与未带引号形态。deny-list 自己仅有准确声明行豁免，不豁免整个文件。它是静态字面量回归门，不是完整 TS/YAML 语义解释器，也不承诺识别动态拼接/混淆文本。

扫描真实树发现额外的 profile 描述、service Description 和 browser JSON 示例说明，已改为中性措辞；CLAUDE.md 当前角色称呼改“所有者”，保留一处当前所有者声明。包名、路径、unit 名和治理历史不变。范围校正写入 order。

## 验证

完整 `npm test` 退出0：**1213 tests / 1202 pass / 0 fail / 11 skipped**。随后只调整命中行号计算，gate 专项重新通过；typecheck、diff check通过。有效日志为检查点目录 `e4-5-full.log`、`e4-5-gate-final.log`、`e4-5-typecheck.log`。

新测试涵盖四种 token 红例、注释/包名/测试目录排除、转义字面量、模板插值、配置注释、真实树零命中及 verify 检查表注册。已有 gate 完整性/实例文件签署红绿例保留通过，E4-4 的 manifest 实现没有重复修改。

## 落地边界

gate src 属 root 域，需要整批复核、重签、启动门检查。没有生产签署、root 操作、服务重启或主分支合并。实例事实门通过不等于真实对话效果验收。
