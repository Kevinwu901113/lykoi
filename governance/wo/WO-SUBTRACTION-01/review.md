# WO-SUBTRACTION-01 审计与复核

状态：源码与文档减法完成，全量回归通过；待所有者决定是否合并。

## 审计口径

覆盖当前 GitHub HEAD `c03ffffe5d55161173fb220fdba870791e2acc9c` 的 17 个运行时包与 profile 工作区，另查依赖、测试、deploy 与协作文档。其他未合并工作树未纳入此分支，不混入正在进行的 ingress/schema 19 等改动。只读核对远端，未执行生产操作。

结论归因于可见代码与协作制度；Git 作者多为共用身份，虽有 Claude 共同署名，无法可靠逐项分摊 GPT-5.6 Sol 与 Claude 的责任。行数仅用于定位维护成本，不能代替重复度或正确性判断。

## 基线

- Node v26.4.0（仓库要求 >=24）；`npm run typecheck` 通过。
- `npm test`：1165 tests / 1154 pass / 0 fail / 11 skipped。
- 测试需要本机临时端口与 Unix socket；沙箱内会 EPERM，正确基线使用获准的本机测试执行环境。
- 工作副本使用独立 node_modules，workspace 符号链接指向本副本；最初共享 node_modules 的试跑因跨副本类型冲突作废，不计入基线。
- 已跟踪资产：packages 245 文件；governance 394；docs 8；deploy 8；profile 5。vendor 只作依赖面检查，不修改供应商快照。

| 包 | src TS 行数（含注释） | test TS 行数 |
|---|---:|---:|
| lykoi-adapter-telegram | 3142 | 2157 |
| lykoi-audit | 128 | 65 |
| lykoi-budget | 300 | 194 |
| lykoi-converse | 4433 | 5524 |
| lykoi-decide | 2250 | 2001 |
| lykoi-gate | 1385 | 1380 |
| lykoi-heart | 518 | 387 |
| lykoi-kernel | 6195 | 4274 |
| lykoi-learn | 2680 | 2606 |
| lykoi-llm | 342 | 294 |
| lykoi-llm-deepseek | 29 | 284 |
| lykoi-memory | 4147 | 3219 |
| lykoi-organ-browser | 2099 | 1722 |
| lykoi-reflow | 665 | 896 |
| lykoi-regulation | 330 | 358 |
| lykoi-snapshot | 1131 | 1075 |
| lykoi-wake | 746 | 1625 |

## 主要发现

| 主题 | 证据与原因 | 本轮处置 |
|---|---|---|
| 同包 I/O 复制 | adapter 的 outbox/device/messenger 各有一份同步 JSON 原子写，M3-W3 移植提交 `174942a` 同批引入；格式与调用序相同 | 收敛包内 jsonio，保持持久化和失败清理 |
| 重复数据库读取 | snapshot floorMaintain 在任何写入之前，按相同 active/dimming 条件查两次；底层 listConcerns 每次跑完整 SQL | 查询一次，复用计数与标题集合 |
| 分支维护成倍放大 | L4 五条结束路径都执行 promote→retire→finalize；`e9e2ba9b` 加 retire 时必须同步改五处 | 同一收尾函数；外围编排异常仍只 finalize |
| 读模型缺少共享实现 | memory 的 RO/RW 复制 regulationField/openThoughts/autonomyState SQL 与映射、版本读取与读失败包装 | 同包共享查询，保留公开接口、连接权限和不同拒绝文案 |
| 工具参数解析重复 | conversation 四处独立 JSON.parse、对象检查和同一错误返回，`7d44f15` 同批引入 | 单一解析函数；保留工具权限/字段检查与错误文案 |
| 小范围返回映射重复 | browser host 的 URL 操作与 get_text 使用同一结果映射 | 分支只选操作，统一映射一次 |
| 旧事故流程仍在指挥新任务 | HANDOFF 第八节要求旧 Python pytest、旧服务名、旧 SHA；CLAUDE 全量阅读入口把历史规则一起带入每次任务 | 历史步骤原文归档；现行入口按任务读相关教训，引用当前测试命令 |
| 文档硬写可派生数量 | gate 文案称八项，但 CHECKS 已有九项 | 当前说明不硬写数量；历史报告不回填重写 |

这说明主要问题是移植时复制与后续补救不断叠加，尚不足以断言整个架构都过度设计。小包和窄接口普遍已经较轻；不应仅因源码长、分支多或防御性注释多就删代码。

## 本轮明确保留

- 同步 JSON writer 只在 adapter 包内收敛；kernel 私有写入仍独立，adapter 入站异步 writer 另有串行队列与末尾换行，不强行混用。
- Telegram 的重试/退避、部分投递、未送达标记、入站与出站不同坏游标策略：分别处理网络不确定性、防双记与历史消息重放；不能合成一个默认恢复策略。
- LLM 信封修复、有限重试、deadline 与动作回执：都有已记录的用户路径故障，当前审计没有证据证明已冗余。无真实模型反证，不改认知策略。
- memory 的 schema 拒绝、只读连接/query_only、事务/触发器，以及历史数据格式兼容：是数据与权限边界，抽共享读逻辑不能移除这些语义。
- learn 与 memory 的少量时间格式/常量副本：learn 不依赖 memory 写库能力，boundary.test.ts 验证该界限；为七行代码新增跨包工具依赖收益不足。
- browser.navigate 与 researchReadText：普通导航不读取正文，研究页需独立 ephemeral context 并在 finally 关闭；不可把表面相似当作整条流程等价。SSRF、重定向、下载与 untrusted 边界保持。
- gate/kernel 的权限、manifest、symlink/shadow 检查和 schema twin：当前双包均 root-owned，旧“kernel 是业务可写域”的注释理由需要重评，但仍需独立审查加载边界，不能在此次等价简化中直接取消。
- budget、heart、audit、regulation、llm/llm-deepseek、wake/reflow/decide：未发现值得为本轮引入额外抽象或改变协议的高置信删除项；配置装配和供应商 vendor 保持。

## 需单独处理的结构问题

`gate/verify.ts` 在模块顶层从 `lykoi-kernel/policy-core` 加载代码，workspace 解析链接的核验随后才在 verify 中执行；`docs/deploy.md` 明示 node_modules 由服务用户持有。静态代码可确认加载早于检查，但本轮未做攻击复现，也未核实实际生产权限。此项是加载信任边界审查，不能用“合并 schema 减少重复”来解决；后续应评估可信相对加载或启动前解析校验。不会在本轮声称已修复或已证明线上可利用。

## 执行与复核分工

三个 GPT-5.6 Luna / max 子 Agent 分别审计对话链路、认知记忆、基础设施。Luna 完成 Telegram JSON writer、browser host 返回映射与 gate 文案，并对 writer 做交叉独立复核。认知子 Agent 在完成 L4/floor 源码修改后触发用量上限；主 Agent 接手其未完成验证、memory 共享查询与 conversation 参数解析，逐项读 diff 后运行完整回归。未将中断 Agent 的半成品当作完成。

等价性复核：共享 SQL 的列、过滤、排序和字段映射与原两份一致；RO/RW 生命周期/PRAGMA 与版本不符文案原样保留；queries 只 import type，不增加运行期循环依赖。L4 只收敛五个既有收尾调用，外围 catch 仍只 safeFinalize，finally 仍 reset。floor 两次读之间原本无 await 或写入，故复用结果不改变观测时点。工具解析位置仍在已知工具/接线检查之后，notify.origin 盖章与三个认知工具自己的限制原样保留。

新增两个测试（JSON 原子替换失败清理、RO/RW 返回形状与后续写入可见性）；在原有 floor 与 L4 衰减测试中补查询次数、衰减先于 finalize 且只 finalize 一次的断言。其他已有工具/失败/权限/坏库回归保留，不额外暴露私有 parser 作为测试入口。

## 最终验证与交付边界

- `npm test`：1167 tests / 1156 pass / 0 fail / 11 skipped / 0 cancelled；包含本机 Chrome smoke 与 Unix socket 测试。相较基线新增两项，无新增失败或跳过。
- `npm run typecheck`、`git diff --check` 均通过。
- 运行时 src TS diff（包含两个新共享模块）：+149 / -223，净减 74 行；减少重复实现而非削减功能。测试与审计文档新增行数另计。
- 原 HANDOFF 第八节在 archive 中逐字保留，返回当前 HANDOFF 的链接已检查。
- 本地日志：`/private/tmp/lykoi-subtraction-baseline-test.log`、`/private/tmp/lykoi-subtraction-final-test.log`、`/private/tmp/lykoi-subtraction-final-typecheck.log`；数字与结论已固化在本报告，不依赖临时日志交接。
- 工作分支 `wo/subtraction-01`；未合并 main，未部署，未访问活数据。生产应用时仍须重签完整性 manifest；本机未生成生产 manifest 或声称通过生产 gate。

这次可确认的是重复实现和协作入口的历史负担。更大的 schema twin/模块加载信任边界问题已列出静态证据，需作为有独立威胁模型的特权层变更处理；没有为了增加删除行数而撤掉它。
