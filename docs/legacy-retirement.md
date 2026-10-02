# 旧个人 Agent 运行时退役

所有者于 2026-10-02 明确选择“整体退役旧运行时”，当前 main 只维护新版 Composer。这是产品范围收敛；旧代码原本存在真实调用链，不能把它们称为从未使用的死代码。

## 删除范围

- 25 个旧包：人格/决策、Memory/Mind、Heart/Wake、Converse、学习与快照、Cordis 运行时、任务与技能、Telegram、旧 LLM 接入、预算/审计、旧浏览器/工作区器官、Pi runner、Panel、Kernel/Gate。
- 旧 profile、装配 YAML、旧实例管理/导入与验收程序；保留 `profile/composer.ts` 作为唯一入口。
- 旧生产部署模板和不再适用的使用文档。历史设计、治理工单与证据留在 `governance/`，其中旧路径只用于历史追溯。
- 对应 npm workspaces 和第三方运行依赖。没有将旧包搬进另一个参与构建的“归档”目录。

当前 Composer 的 12 个组件、版本化定义、实例隔离、SQLite 状态、操作回执、恢复与可视化画布保留。旧 `npm start` 现在启动 Composer；旧 `npm run panel` 与 `profile/index.prod.ts` 不再存在。

## 查阅和恢复

完整清理前基线：`01afb64f3859ef46cd0e9a903ef3c085f3e56c2a`。它包含旧运行时与最新 Composer；新提交是其后继，没有重写历史。

```sh
# 在另一个目录查看旧实现，不覆盖当前工作树
git worktree add --detach ../lykoi-legacy 01afb64f3859ef46cd0e9a903ef3c085f3e56c2a

# 或只查看某个历史文件
git show 01afb64f3859ef46cd0e9a903ef3c085f3e56c2a:profile/index.prod.ts
```

完整删除清单（含原 blob SHA）见 `governance/wo/WO-COMPOSER-CLEANUP-04/removed-files.json`。

## 运行与测试边界

本次只更新仓库，不执行服务器切换，不迁移、不删除真实旧状态。仍使用旧运行时的服务器必须固定旧版本，不能直接拉当前 main 使用旧部署命令。

旧测试随所属产品范围删除。此前旧全仓的环境失败没有因此被“修好”；当前测试数应只统计保留下来的 Composer 测试。清理前后的 Composer 必须通过相同验证，详见本工单报告。
