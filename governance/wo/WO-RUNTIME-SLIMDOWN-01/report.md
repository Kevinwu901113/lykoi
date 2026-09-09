# WO-RUNTIME-SLIMDOWN-01 验证报告

第一阶段首批实现与本地验证完成。基线 `cd5bfad`，分支 `wo/runtime-slimdown-01`；未合并、未部署。

## 改动

- [分类清单及依赖图](inventory.md)：记录全仓静态扫描和关键调用链，区分产品契约、认知策略、迁移证明、闲置兼容面，明确后续 contracts/runtime 的依赖。
- [历史注释存档](../../adr/runtime-slimdown-01-history.md)：迁出 Snapshot/Regulation 中 44 个注释块，保留原文、基线与原行号。源码保留当下行为说明。
- 删除 `snapshot.assemble()`：生产无调用，Wake 零写测试三个初始化点直接调用 maintain；全部测试断言保留。
- 删除 `snapshot.codePoints()`：唯一调用点内联码点展开，不改变 Unicode 裁剪。
- src 总行数由 31,937 降为 31,799，净减 138 行；其中只有两个包装层涉及可执行代码，其余为注释精简。没有宣称完成全仓 Slimdown。

## 验证与复核

环境 Node v26.4.0，隔离 worktree 使用 `npm ci --offline --ignore-scripts --no-audit --no-fund` 安装 44 个包。

| 验证 | 结果 |
| --- | --- |
| 基线全量（沙箱） | 1,226 tests：1,201 pass / 14 fail / 11 skip；14 个失败属于 LLM adapter 与 Browser 包的本地 listen EPERM |
| 上述两包在未修改 main 上重跑（允许本地监听） | 75 pass / 0 fail，确认环境原因 |
| 改后全量 `npm test`（允许本地监听） | 1,226 tests：1,215 pass / 0 fail / 11 skip；18 个 workspace 全部结束，退出 0 |
| 基线与改后 `npm run typecheck` | 均退出 0 |
| `node governance/wo/WO-RUNTIME-SLIMDOWN-01/verify-equivalence.mjs` | 去注释编译结果与基线按声明清理后的结果相同；Wake 测试断言未改；44 个归档注释的原文/行号全部匹配 |
| `git diff --check` | 通过 |

[validation.json](validation.json) 保存每包计数及原始本地日志路径/散列。11 个跳过项为既有的 devstate 相关验证，本轮未注入私有状态副本；不据此声称验证了活数据迁移或生产体验。

复核方式：人工检查全部源码 diff，加上独立于自然语言说明的执行代码比较和真实测试。没有另行调用 Reviewer Agent。去注释比较明确豁免的是 assemble 删除、码点包装内联与三个测试初始化调用；不把移除导出宣称为外部 API 完全兼容。当前包为 private，仓内消费者已核实；未知仓外消费者不在本轮扫描范围。

## 重要结论与剩余工作

1. Telegram 全局注册、Browser 代建 BodySchema、Converse/Wake 资源快照共同造成实例作用域与启动顺序问题；后续必须整体处理生命周期，单独搬文件不够。
2. Floor 确实在制造关切，但删除前需要验证零关切整合路径；本批不改状态行为。
3. 回合终态已有 failure/silence 区分，不能重复修复已解决的问题；内部 demotion/safeKind 仍需梳理。
4. Python golden 不能仅按名字删除：当前数值输出有活跃消费者。纯结构约束应随新契约落地退休，现役数据升级测试保留。

下一批为 contracts/runtime 的服务基础及 BodySchema 生命周期。合并本分支与任何 root/生产动作仍由所有者授权。
