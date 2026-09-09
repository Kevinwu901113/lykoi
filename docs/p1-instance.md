# P1 Character Instance

P1 保留现有存储，实现明确创建、恢复与单实例选择。统一认知、完整 Task Runtime、Resolver、Forge 和多角色并发不在范围内。

## 归属

| 内容 | 归属及恢复方式 |
| --- | --- |
| 初始身份、性格、表达 | 创建/接管时保存 `definition.toml` 快照与哈希。以后修改源模板不会改变已有实例；快照损坏即拒绝恢复。 |
| 记忆、关系、关注、后天自我、叙事、思想、跟进 | 每实例沿用独立 `memory.db`，现有 schema 18 不变。跟进仍是现有 continuation。 |
| 入站会话、在途回合 | 每实例 `inbound-spool.db`；恢复、终态及迟到结果均落在该实例的文件集合。 |
| budget、主动联系、审批、outbox、未送达、通知、游标、心跳 | 全部固定到该实例的 `stateRoot`；运行配置不能覆盖这些路径。已登记的文件缺失/JSON 损坏直接失败。 |
| 模型、器官、通道、凭据引用、功能开关 | 独立 Cordis JSON/YAML 配置，继续使用现有插件 schema。可更换配置，不重新出生。凭据值不进实例登记。 |
| 选择 | `selected.json` 只决定下次启动；每个子进程固定一个实例，不能在运行中改为另一个实例。 |

`registry/<id>/instance.json` 和状态目录的 `instance.json` 相互核对；路径、实例 id 或定义快照不一致即失败。创建拒绝覆盖目录；接管拒绝已有归属。接管只添加归属与定义快照，不执行 seed 或 DB migration。

人格进程缓存已经删除。其余 legacy 接线变量局限于固定实例的 OS 子进程；P1 不允许在同一进程里更换角色或并发装配两个完整角色。Runtime 的在途工作登记、入口排空与进程退出形成切换边界，不建设新的任务调度器。

## 入口

使用 Node 24。运行配置沿用 Cordis 的平铺插件列表；控制台需要 Runtime、Audit、Budget、LLM/provider、Memory、Ingress、Converse。生产列表继续保留 Telegram 与 Wake 等实际配置。

```sh
node profile/instance.ts create --registry /path/instances --id a --definition /path/template/persona.toml --owner-name Owner
node profile/instance.ts create --registry /path/instances --id b --definition /path/template/persona.toml --owner-name Owner
node profile/instance.ts select --registry /path/instances --id a
node profile/instance.ts run --registry /path/instances --config /path/runtime.json --console
```

控制台输出带 `instanceId` 的 JSON 行；输入一行即调用现有 Converse 服务。关闭旧进程再启动所选实例；活跃进程锁阻止同一 registry 同时启动两个角色。旧进程退出前等待已接收工作完成；强制杀进程时沿用现有入站/continuation 恢复语义，不把中断伪装成成功。

## 现有实例接管与生产切换

生产选择记录为 `profile/instance.prod.json`，默认登记 id 为 `lykoi`。接管部署命令应在代码验证完成、切换窗口确定后执行：

```sh
node profile/instance.ts adopt --registry /home/lykoi/runtime/instances --id lykoi \
  --definition /home/lykoi/runtime/persona/lykoi_base.toml \
  --state-root /home/lykoi/state --audit-path /var/log/lykoi-audit/audit.jsonl
```

先核对现有库和绑定、记录只读摘要，再由部署权限所有者停止旧服务并执行接管。登记成功后核对原有数据摘要；原有 DB、账本和队列不得初始化或覆盖。实例目录的 descriptor 与 definition 是新的 root 保护输入，需设为 root 拥有且 Runtime 可读，并加入正常 manifest 重签。状态目录的归属标记仍由服务用户读取。门验证通过后再启动新入口；应确认实例 id、历史与关系、Telegram 正常交互及服务状态。失败时保留状态，恢复旧代码与对应 manifest，不删除角色数据。

生产当前阶段仍使用既有 state 与 audit 规范路径；其它实例通过独立选择入口验收，不扩展生产多角色调度。仅有本地测试通过不代表当前角色已接管或生产已部署。

## 验收与当前状态

- 创建/恢复：同一定义创建 A/B；记忆与关系分别保留；模板/种子文件变动不影响恢复；配置中的错误状态路径不能重定向实例。
- 接管：合成既有 DB 接管前后逐字节哈希相同，原有绑定不变；没有种子回放。
- 真子进程：使用现有 Cordis、Memory、Converse 和测试 provider，A/B 分别产生对话；重启、选择、改变模型配置后，provider 实际收到的历史只包含对应实例内容。
- 迟到结果：A 等待结果时选择 B，结果和审计仍归 A；排空后 B 才启动。已接收回合在停机中可完成嵌套工作，直接能力调用也纳入排空；新的外部调用拒绝。
- 失败：丢失 memory/budget、坏归属标记、改定义快照均明确报错，不造空经历。
- 本机 Node 24 全量回归：1206 项，1195 通过、11 项既有跳过、0 失败。
- 服务器隔离验收：用户授权后已上传 `4a6a184`；Node 24 创建、恢复、副本接管与真子进程 A/B 测试共 4 项通过。现有生产状态复制至临时目录后接管：17 个原有文件全部逐字节保留，memory DB 39 张表、完整性检查通过，仅新增实例归属标记。
- 真实 provider：用户明确授权内存凭据使用后，服务器通过现有 Converse 入口完成四次独立进程对话。A 记住“青柠灯塔741”，B 记住“琥珀纸船963”；从 `deepseek-v4-flash` 改为 `deepseek-v4-pro` 后，两者准确回忆各自名字且无交叉。凭据未输出或落盘。
- 现有角色副本：用户批准真实上下文发送给 DeepSeek 后，`lykoi-copy` 通过现有 Converse 入口获得 230 字回复；回复保留服务器。原有用户与身份绑定数量不变，history 从 1577 增至 1580，审计全部属于该实例，DB 完整性为 `ok`。回复与原历史有 6 个八字连续匹配；这只是历史关联证据，不等同于完整语义准确性评审。首次请求因测试配置上限 100000 低于沿用账本的 287602 而明确失败；随后仅将隔离配置恢复为生产上限 2000000，未清零账本。
- 待完成：正式接管与生产 Telegram 交互验证。当前 SSH 账号没有免密 root 部署权限，生产切换需部署权限所有者按上述流程执行。生产尚未切换，P1 尚不能标为全部完成。
