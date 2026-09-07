# WO-E4-3 · 实例称呼投影

状态：分支 `wo/e4-3`，基线 `fbf5a24`；实现与本地验证完成，未合并、未部署，治理复核待整批交付。

## 实现

persona 增加可选 `[owner].name`，缺省回退 `voice.address_owner`。统一 `renderOwnerTemplate` 一次替换 `{owner}`、`{owner_name}`、`{self}`，分别取称呼、正式名、角色名。没有新 schema、环境变量或代词配置。

对话系统提示、摘要、回灌标签、信封工具说明、未送达头部、偏好标题、器官能力说明、wake 候选 cost/note 与决策提示均从实例投影。回流、cheapTick、重启经验通过明确的 ownerName 参数接线；快照字段改为 `距上次与所有者互动小时`。独立调用缺实例时使用中性“所有者”。

只渲染框架模板，消息正文、历史引文、绑定 display_name 保持原文。实例值即使包含 `{owner}` 也不会递归替换。工具动作名、参数、审批算法、存储格式不变。

原order漏列的 kernel 审批/建议提示、learn 整合/规则说明和 memory 不兼容错误也去掉第一实例名称，范围校正已记入order。policy-core 与 gate/surface 未改。

## 验证

完整 `npm test` 退出0：**1210 tests / 1199 pass / 0 fail / 11 skipped**；`npm run typecheck`、`git diff --check`通过。有效日志：检查点目录 `e4-3-full-final.log`、`e4-3-typecheck.log`。

既有对话、wake 真插件接线、摘要/经验/未送达测试随称呼更新；新增可选正式名回退、一次替换、合成实例渲染 SHA、信封用户文本及器官绑定名称保真测试。回归曾发现候选 cost 漏渲染，已修正；wake 测试旧模板断言失败时未关闭定时器，已加失败清理并验证正常退出。旧 first/second 日志不是通过证据。

[prompt-sha.json](prompt-sha.json) 保存9项常量的基线、模板与合成实例 chars/SHA。A4 utterances 信封 raw SHA 保持不变，工具表渲染 SHA 依本单更新。生产称呼或渲染结果未写入夹具。

对 packages/*/src 的 TS AST 字符串/模板片段扫描，Kevin/Lykoi 运行时命中为零；文本搜索仍有历史注释及包/类型标识，按order不属于运行时称呼。自动静态门由后继 E4-5 落实。

## 交付边界

触及 converse、decide、wake、reflow、snapshot、adapter、organ-browser、kernel、learn、memory 的源文件及对应测试。需按整批落地重新签署 manifest；未读取生产实例、未更改主分支、未证明真实模型行为或 Telegram 实收。正式名不填也可按原称呼运行。没有执行 E2/37.5 解锁。
