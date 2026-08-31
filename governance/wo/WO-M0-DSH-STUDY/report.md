# WO-M0-DSH-STUDY：dsh/Cordis 装机研读报告

- 日期：2026-08-24
- 环境：macOS (Darwin 25.5.0, arm64)，Node v24.18.0，npm（lockfileVersion 3），网络直连 registry.npmjs.org
- 工作区（临时件，阅后即焚）：Mac scratchpad `dsh-study/`
- 下文所有包内路径均相对该工作区的 `node_modules/`；引用格式 `包名@版本:包内路径`。
- 标注约定：[事实]=读码/实测/registry 元数据；[推断]=由事实合理外推；[建议]=移植决策建议。
- 落库注记（治理侧）：执行 Agent 环境禁止子 Agent 落盘报告文件，本文由治理侧按其返回全文落库，仅修传输转义，内容未改。

安装事实速记：[事实] `npm install @deepseek-ai/dsh` 装得 `dsh@0.1.1-rc.2`，lockfile 共 511 个依赖包，`node_modules` 实际磁盘 270MB，其中 `@deepseek-ai/` 作用域下 197 个目录。install 脚本被本机 npm allow-scripts 策略全部阻断（node-pty/koffi/protobufjs/@google/genai），运行时验证均不受影响（详见第 6 节）。

---

## 1. cordis 内核 API 速写

包：`@deepseek-ai/cordis@4.0.1`，MIT，unpacked 239KB，依赖仅 `@deepseek-ai/cosmokit` + `@standard-schema/spec` [事实：npm view + `cordis@4.0.1:package.json`]。这是 Shigma 的 cordis 框架被 DeepSeek vendor 进 `deepseek-harness` 仓库（`repository.directory: vendor/cordis`）后以自有 scope 发布的 v4 [事实：package.json author/repository]。TS 源码全量随包（`src/` 共 2693 行），可直接读源不读编译产物 [事实]。

### 1.1 Context（`src/context.ts`）

- `new Context()` 返回 Proxy（`ReflectService.handler` 包装，context.ts:74-83）；普通属性读取走服务解析器。四个内建服务：`events`/`logger`/`reflect`/`registry`（context.ts:26-32）。
- 三种派生子上下文，全部原型继承、不改父（context.ts:99-145）：`extend(meta)` 附加元数据；`isolate(name, label?)` 服务作用域隔离——同名服务在子树内解析到独立标签，两处传同一 label 可连通（context.ts:121-125）；`intercept(name, config)` 给子树内插件注入按服务名合并的拦截配置。
- 拦截配置合并语义在 `Service[symbols.resolveConfig]`：祖先先、近者后，可选 `Config.merge`，否则浅 `Object.assign`（`src/service.ts:86-102`）。

### 1.2 Plugin 定义形态（`src/registry.ts`）

三种入口形态（registry.ts:92-133）：**函数** `(ctx, config) => any`、**类** `new (ctx, config)`、**对象** `{ apply(ctx, config) }`。共享元数据 `Plugin.Base`：

- `name` — 诊断/日志名；
- `Config` — **StandardSchemaV1** 校验器（v4 起是 standard-schema 接口；dsh 主线用 `@deepseek-ai/schemastery`，个别包用 zod）；配置在 fiber 激活前同步校验，失败抛 `ValidationError`（`src/fiber.ts:19-62`；不支持异步校验 fiber.ts:55）；
- `inject` — 依赖服务声明，数组或 `{名: 拦截配置}` 映射；**全部就绪才加载，任一变更即卸载重载**；
- `provide` — 声明提供的服务名；另有 `@Inject` 装饰器（registry.ts:37-60）。

`ctx.plugin(plugin, config)` 返回 `Fiber & PromiseLike<Fiber>`（await 即等加载完成并重抛启动错误，registry.ts:316-336）；`ctx.inject(deps, callback)` 是速写（registry.ts:300-302）。同一 plugin 回调可多次挂载，各成一个 fiber，共享一条 `Plugin.Runtime` 记录。

### 1.3 Fiber 生命周期与可逆副作用（`src/fiber.ts`）

- 状态机：`PENDING → LOADING → ACTIVE / FAILED`，卸载走 `UNLOADING → (PENDING|DISPOSED)`（fiber.ts:147-154）。核心是 **epoch** 机制：`_refresh()` 把所有依赖服务提供方的 fiber uid 拼成 epoch 串，任一依赖换实现即 epoch 变化 → 自动 unload+reload（fiber.ts:611-639）。这就是"服务热替换、下游自动重启"的实现点。
- `ctx.effect(execute, label?)`（fiber.ts:415-561）：执行体可返回单个 disposer、Promise<disposer>、或（异步）生成器逐个 yield disposer；全部收集，**倒序**执行清理；fiber 卸载时未手动释放的 effect 自动清理（`_unload`，fiber.ts:675-696）。disposer 幂等。`getEffects()` 输出带 label 的诊断树。已 DISPOSED 的 fiber 上建 effect 抛 `CordisError('INACTIVE_EFFECT')`。
- `fiber.update(config, noSave?)` 走 `internal/update` waterfall（HMR/持久化钩子可拦截）再 restart（fiber.ts:736-753）；`internal/config` waterfall 是 loader 做 `!!js` 插值的挂点（fiber.ts:641-644）。

### 1.4 服务注册与注入（`src/reflect.ts` + `src/service.ts`）

- `ctx.provide(name, value)` 注册当前 fiber 拥有的服务（激活后对同 isolate 作用域可见，卸载自动注销）；`ctx.get(name, strict?)` 绕过 inject 声明读服务；`ctx.set` 只有提供方 fiber 能写；另有 `accessor`（计算属性）与 `mixin`（把服务方法平铺到 ctx，如 `ctx.on` → `ctx.events.on`）[事实：reflect.ts:7-71]。
- **未声明 inject 就读服务会抛错**：Proxy get 对插件上下文强制 `cannot get property "X" without inject`（reflect.ts:144-167）——依赖显式化纪律；dsh 各包用 `ctx.get('x')` 表达"可选消费"。
- `Service` 抽象基类：`super(ctx, name)` 即完成 `ctx.reflect.provide(name, this)`，随 fiber 注销；支持 `[Service.init]`（构造后异步初始化，可为生成器 yield disposer）、`[Service.check]`（可用性谓词）、`[Service.invoke]`（可调用服务）[事实：service.ts:11-59]。

### 1.5 事件机制（`src/events.ts`）

五种派发模式（events.ts:32）：`emit`（同步不等待）、`parallel`（全部 await）、`serial`（顺序 await 到首个 bail 值）、`bail`（同步到首个 bail 值）、`waterfall`（next() 链，中间件式）。listener 随 fiber 自动 dispose；事件类型经 `interface Events` 声明合并扩展。dsh 的扩展点（`tools/pre-execute`、`agent/pre-step`、`internal/update`……）全部建在这五种模式上。

### 1.6 最小插件样例

[事实归纳自 registry.ts Plugin 类型 + service.ts + `dsh-llm-deepseek@0.1.1-rc.2:lib/index.js:1754` 的实际形态]：

```ts
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'   // 任何 StandardSchemaV1 皆可

export const name = 'my-heart'
export const inject = ['llm']              // 依赖：llm 就绪才加载，llm 换实现即重载

export interface Config { intervalMs?: number }
export const Config: z<Config> = z.object({
  intervalMs: z.number().default(60_000),
})

export function apply(ctx: Context, config: Config) {
  // 可逆副作用：disposer 在插件卸载/热重载时自动执行
  ctx.effect(() => {
    const timer = setInterval(() => ctx.emit('heart/beat'), config.intervalMs)
    return () => clearInterval(timer)
  }, 'heartbeat timer')

  // 提供服务（随 fiber 注销）
  ctx.provide('heart', { now: () => Date.now() })

  // 监听事件（随 fiber 注销）
  ctx.on('heart/beat', () => ctx.logger.info('beat'))
}
```

对应 cordis.yml 一行：`- id: heart / name: './plugins/my-heart' / config: { intervalMs: 30000 }`。

---

## 2. loader 与配置树语义

三件套：`cordis-plugin-loader@1.0.2`（entry 树运行时）、`cordis-plugin-include@1.0.6`（文件后端 + patch 语义）、`cordis-plugin-hmr@1.0.16` [事实]。

### 2.1 entry 树

`cordis.yml` = 顶层**数组**（非数组直接报错，include/src/index.ts:261-263）。Entry 字段：`id`（稳定寻址键）/`name`（模块说明符）/`config`/`group`（config 变为子 entry 列表，可配 `isolate`）/`disabled`/`inject` [事实：loader README + preset yml 中 `name: cordis:group` 实例]。loader API：`create/update/remove/resolve/await/locate`。文件可写时 loader 反向写回（loader/src/index.ts:103-109）。

### 2.2 dsh 的 profile 组合（bundles + patch 层）

[事实：`dsh@0.1.1-rc.2:README.md`「Profiles」+ `lib/profile-boot-DG5t9aNs.js:102-108`]

- profile 根 `cordis.yml` 是**空列表** `[]`（模板注释原文：树全部由 patch 组成，"Edit cordis.patch.yml, not this file"）。
- 组合顺序（后覆盖前）：`package.json` 的 `dsh.profile.bundles` 声明顺序的各 bundle `cordis.patch.yml` → profile 自己的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` overlay。bundle 先从 dsh 安装解析，再从 profile 的 node_modules。
- bundle 实体就是一个带 `cordis.patch.yml` 的普通 npm 包（实例：`dsh-base` 一个大 insert 铺底约 60 行 entry；`dsh-headless` 33 行做模式覆盖）。
- `--dump-default-config` / `--dump-config` 离线打印合成树。

### 2.3 patch 语义（id-targeted override / disable / insert）

实现在 `applyEntryPatches`（cordis-plugin-include/src/index.ts:58-128）[事实]：

- `- insert: [...]`：无 `id` 追加顶层；带 `id` 时目标必须是 group，插入其 config；**插入的行立即入索引，同一 patch 列表内后续 patch 可寻址前面刚插入的行**（96-102 行注释明说这是分层组合的关键）。
- `- id: X, <字段>: <值>`：逐字段覆盖目标行；**`config` 整体替换、不做深合并**（dsh-base patch 头注释 6-10 行明确此纪律）。
- `disabled`/`inject`/`isolate` 同理可覆写；带 `name` 时先校验与目标一致，不一致警告跳过；找不到 id 警告跳过（不是错误）。
- 输入 `structuredClone` 后再 patch（:63），保证热重载可回退。

### 2.4 `!!js` 表达式

- include 注册 YAML tag `tag:yaml.org,2002:js`，解析为 `{__jsExpr: string}` 节点（include/src/index.ts:9-23）。
- 求值器是字面 `with (ctx) { return eval(expr) }`（loader/src/config/utils.ts:5-9）[事实]——**配置文件即代码，patch 层等同任意代码执行权**；主权上是特性（部署者拥有机器）但需知情 [推断]。
- 求值时机与作用域：行 config 里的 `!!js` **惰性**求值——在该行自己 fiber 的 `internal/config` waterfall 中 `interpolate`（loader/src/index.ts:92-101），所以能写 `ctx.headlessStartup.task`（dsh-headless patch:35）这类**服务引用**；树载体（group/include）保持 literal，嵌套行的表达式归嵌套行自己；`disabled` 的 `!!js` 对 entry 上下文即时求值（loader/src/config/entry.ts:101-111）。dsh-base 里大量 `!!js process.env.X ?? '默认'` 即此机制。

### 2.5 HMR 边界（cordis-plugin-hmr@1.0.16）

[事实：hmr README]

- **能热载**：watch 根覆盖的应用层插件文件——chokidar + 追踪 Node 模块图 + 清模块缓存 + 只重载依赖变更文件的 plugin entry；配置文件变更走 include 的 `refresh()` 事务（换树失败回滚到上一棵好树，include/src/index.ts:296-309）。
- **不能热载**：framework-level 依赖（node_modules 内框架/库）变更 → 直接 `loader.exit()` 整进程重启。需要 `loader`+`timer` 服务，且要求运行时暴露 Node internal module loader（没有就抛错）。
- dsh 实践：base 层挂 hmr（root: ['.']），headless 模式**禁用**（`dsh-headless:cordis.patch.yml:14-15`），由 launcher watch-only fallback 保持用户 patch 层可热更；设置免重启热更走另一条路（`dsh-settings-file` 的 settings.yaml → 各插件 settings 命名空间）。
- [建议] Lykoi 常驻进程：hmr 视为开发期工具，生产靠「patch 层 + include refresh + fiber.update」做受控变更。

---

## 3. dsh 插件长什么样（三包精读）

三包均 `0.1.1-rc.2`，MIT [事实：LICENSE 抽查]。共同形态：包根导出 `name`/`inject`/`Config`（schemastery）/`apply(ctx, config)` 四件套，README 带「Model Experience / KV Cache effect / Known Limitations」固定栏目（工程文档纪律极严）。

### 3.1 `dsh-llm-deepseek` — LLM 客户端形态

- 入口：`apply(ctx, config)`（lib/index.js:1754），`inject = ["llm"]` [事实]。它不提供服务，而是向 `ctx.llm`（`dsh-llm` 的 `LlmRuntime`）**注册 provider 路由** `deepseek-official`；重复注册抛 `DUPLICATE_ADAPTER`。运行时依赖仅 `eventsource-parser` + schemastery [事实]。
- 传输：直接 `fetch` + SSE，无官方 SDK；`DeepSeekAdapter` 纯传输层，连接事实经 **thunk 每操作解析**（lib/index.js:1755-1774：坏 settings 快照保留 last-good 并记日志）。
- 三个**可选** seam 请求时 `ctx.get` 动态取：`settings`（`llm-deepseek:` 命名空间免重启覆写）、`credentials`（`apiKeyEnv` 引用按请求解析，**配置里永远不放明文 key**；无 credentials 服务时回落信任环境层）、`attachments`（图片）。
- 值得抄的形态 [建议]：**「插件=向 seam 注册路由」+「配置=惰性 thunk + last-good 降级」+「凭据=引用不落值」**，直接可作 lykoi-llm-* 模板。

### 3.2 `dsh-session-persistence-jsonl` — 持久化形态

- 入口：`inject = ["sessions"]`，注册为 `ctx.sessionPersistence`（seam 定义在 `dsh-session-persistence`，一 seam 一实现，重复加载抛）。
- 配置（lib/types/index.d.ts:17-41）：`root` **必填无默认**（dsh-base 用 `!!js dshHomePath('sessions')` 供值）、`packChunks`（约小 60%）、`compression: zstd|none`、`preparedSessionCacheSize`、`writeBatchMaxDelayMs`（200ms 合批）。
- 存储：每会话一个 append-only JSONL（默认 `.jsonl.zstd`，**Node 内建 zstd**：`node:zlib` zstdCompress 等，lib/index.js:10 [事实]）；首行 SessionHeader，`seq` 连续；fsync + 硬链接发布防覆盖；崩溃恢复保留完整尾帧、合成 closer；**无删除 API**。
- 原生依赖真相：声明依赖 `koffi`，但**只在 win32 路径惰性 `await import("koffi")`**（lib/index.js:627，MoveFileExW）；POSIX 运行时不加载 [事实]。
- [建议] 该包与其 seam 是 Lykoi 记忆/会话日志的直接可用底座；本地文件、无网络、append-only，与白皮书主权立场契合。

### 3.3 `dsh-subagent` — 子代理形态

- 角色：**Service Definition**（`ctx.subagents`）：命名 provider 注册表 + 能力校验 start API；执行者是兄弟包 `-spawn-in-process`（无父历史）/`-fork-in-process`（继承父历史）；模型面消费者是 `dsh-tool-subagent`。多 provider 并存按名选取 [事实：lib/types/index.d.ts 头注释]。
- 运行时依赖：`zod@^4`（精读包中唯一不用 schemastery）[事实]。
- API：`start`（一次性，所有权在 fulfillment 边界转移）、`startContinuable/followup/interrupt/reportFrom`（可续子代理：durable 收件箱、冷恢复、父权限精确校验）、`listChildren/listDescendants`（读 session 树不唤醒）。
- 能力协商：`capabilities` 声明 `outputSchema/depthLimit/toolFilter/persona`，不支持的请求建子前拒绝。
- 委托策略（与审批递归缺口直接相关）[事实：README「Delegated policy」]：子代理固化父的 sandbox override 快照，**approval 一律钉死 `'never'`**——孩子不允许升权、不产生无人看守的审批悬挂，要更大权限就以"报告受限"结束。深度由持久化 header `delegationDepth` 单调递增，恢复后不可被重计为顶层。
- durable descriptor：每次 start 在子会话日志追加 `subagent/descriptor` 事件（provider、mode、label、冷恢复参数），log-only、不进模型历史。

---

## 4. agent 循环形态（只评估，不设计）

### 4.1 `dsh-agent-loop@0.1.1-rc.2` — 唯一的具体循环

[事实：README] 自我定位原文级明确："THE concrete agent plugin and loop driver……harness 里唯一含具体循环逻辑的包，其他一切是抽象服务或扩展点插件"。

- 服务 `ctx.agentLoop`，注入五服务：`agents/sessions/llm/tools/systemPrompt`；同时实现 `AgentFactory` 并 `ctx.agents.setFactory(this)`，编程创建/恢复统一走 `ctx.agents.create/resume`（rollback-covered 事务：私建 session+agent+scope → setup → 双注册表 enter → 事件公告 → 才启动 driver）。
- 具体 driver（ReactLoopAgent）**包内私有**，exports map 无逃生口——一切可观察行为经 session 事件与 `agent/*` 事件税目。
- 输入原语：统一 `send()` 按 (`target` × `wakeup`) 路由，三别名——`followup()`（next-turn FIFO+唤醒）、`steer()`（next-step+唤醒）、`inject()`（next-step 不唤醒）。turn 边界原子 claim；每次收件箱变更发规范化 `agent/inbox/spliced` 事件，可重放。
- 决策闸门：claim 后 `agent/pre-step` waterfall 可**拒绝本步**；`agent/request` 可在派发前补 provider/model/effort；`agent/request-error` 闭步 waterfall 承载重试（`dsh-llm-retry` 挂此，每次重试开新编号 turn）。
- 配置：`maxParallelToolCalls`（默认 10，settings 免重启）+ 声明式 `agents[]`（启动即建）。

### 4.2 `dsh-tools@0.1.1-rc.2` — 工具注册与执行管线

[事实：README] 服务 `ctx.tools`（ToolRuntime）：

- `register(definition)`：作用域即层——普通插件上下文=全局，`agent.ctx`=该 agent 私有并遮蔽同名全局；同层重名抛错；随 fiber 注销。`defineTool()` 类型化参数 schema；定义必须带规范 `output {schema, render}`。
- `guard(fn)`：同步**单调**拒绝闸（返回 reason 即拒，后续不能翻案）；`restrict(filter)`：agent 级可见性掩码（明示不是权限边界）；`presentAs(mode)`：native/code/both 按 agent 遮蔽。
- 执行管线（固定序）：`tools/pre-execute`（allow/deny/**ask** waterfall）→ guards（单调）→ `tools/execute`（around：超时/重试/度量，只准换 signal）→ 工具体 → `tools/post-execute`（换 content 或换 value 二选一、block、附加 context）→ `finalizeContent` → `tools/result`（只读通告）。参数入线冻结快照，结果独立快照。
- 审批：`ask` 由 `ctx.approval` 承接（**机会式 `ctx.get`，非硬注入**）；无审批服务时 **ask→deny 降级**，注册表照常工作。
- 取消：合作式，caller-owned AbortSignal 贯穿，`ABORTED_BEFORE_DISPATCH`/`ABORTED`/`TOOL_TIMEOUT` 分类。

### 4.3 对「决策信封周期」的参考价值评估

[推断+建议，只评估不设计]

1. **可直接借鉴**：(a) `send()` 的 (target×wakeup) 三态输入——`inject()`（入箱不唤醒）天然表达"下个心跳再看"的材料投递；(b) `agent/pre-step` 的"批已 claim、可整步否决"——信封周期"开封审视→行动/搁置"的现成挂点；(c) guard 单调拒绝 + ask→deny 降级 + 委托子 approval='never'——正好覆盖审批递归缺口里"无人在场不得悬挂等待"那一半；(d) 全事件溯源与治理审计诉求同构。
2. **需自建**：dsh 循环是**任务完成即停**的 coding-agent 形态，没有自主起搏的常驻周期；心跳/起搏器应作为 lykoi-* 插件用 `cordis-plugin-timer` + `followup()/inject()` 外部驱动，循环本体不必改 [推断：agent-loop 无内生定时器，配置面无周期概念]。
3. **约束**：driver 私有不可继承，定制手段=事件挂点+配置+换插件；若信封语义要求改 turn 内部结构，只能 fork `dsh-agent-loop`（unpacked 106KB 单包，可控）[推断]。

---

## 5. 复用清单初稿

版本纪律先行：[事实] 全家 `0.1.1-rc.2` 是 `next` dist-tag（子包 `latest` 多数停在 `0.0.1-rc.1`，仅主包 `dsh` 的 latest 已推进），**裸 `npm install @deepseek-ai/dsh-xxx` 会装到 0.0.1-rc.1 旧版**；一切依赖必须显式钉 `0.1.1-rc.2`（或经 `@deepseek-ai/dsh` 传递解析）。rc 无 semver 稳定承诺 [推断]。

### 直接复用（管道件）

| 包 | 版本 | 理由与接口面 |
|---|---|---|
| `@deepseek-ai/cordis` | 4.0.1 | 内核本体：Context/plugin/Service/effect/events。 |
| `cordis-plugin-loader` + `-include` + `-timer` | 1.0.2 / 1.0.6 / 1.1.3 | 配置树运行时 + 文件后端/patch + 定时器。bundle 分层照抄 dsh profile 模式。 |
| `cordis-plugin-hmr` | 1.0.16 | 开发期用；生产 profile 学 headless 禁用 [建议]。 |
| `dsh-llm` | 0.1.1-rc.2 | Provider 中立 LLM 词汇与 `ctx.llm` 注册表。 |
| `dsh-llm-deepseek` | 0.1.1-rc.2 | DeepSeek 官方路由。⚠ 匿名 id 头，见第 7 节。 |
| `dsh-llm-retry` | 0.1.1-rc.2 | 闭步重试，策略随 adapter 注册携带。 |
| `dsh-session` + `dsh-session-persistence` + `-jsonl` | 0.1.1-rc.2 | 事件溯源会话 + 持久化 seam + JSONL/zstd 后端。Lykoi 记忆底座候选。 |
| `dsh-token-meter` | 0.1.1-rc.2 | 会话级 token 折算（durable log 重放）。 |
| `dsh-storage`（+ `-json`/`-domain` 按需） | 0.1.1-rc.2 | 非会话数据存储 hub。 |
| `dsh-timeout` | 0.1.1-rc.2 | 零依赖超时/取消分类纯函数库。 |
| `dsh-atomic-write` | 0.1.1-rc.2 | 零依赖原子文件替换。 |
| `dsh-subagent` + `-spawn-in-process` + `-fork-in-process` | 0.1.1-rc.2 | 委托 seam + 进程内 provider；委托策略与治理契合。 |
| `dsh-agent` + `dsh-agent-loop` + `dsh-tools` + `dsh-system-prompt` | 0.1.1-rc.2 | Agent 句柄/注册表 + 唯一循环 + 工具管线 + 提示词装配；采用其 agent 面则整组一起用（五服务咬合）[推断]。 |
| `dsh-sandbox`（定义）+ 平台后端按需 | 0.1.1-rc.2 | 文件效应三档 + fail-closed `confine()`；Linux 后端经 `node-addon-landlock-run`（BSD-3-Clause）。 |
| `dsh-settings-file` + `dsh-credentials-local` + `dsh-home-paths` | 0.1.1-rc.2 | 免重启设置层 + 凭据引用存储 + 家目录解析；llm 插件动态配置依赖这套。 |

### 不用 / 明确排除

- **全部 `dsh-client-ui-*`（30+ 包）、`dsh-web-*`、`dsh-host-*`、`dsh-brand`、`dsh-client-*`** —— 浏览器 UI 与 Web 宿主；也是 react 全家与体积大头。
- `dsh-llm-pi-ai` —— 引入 `@earendil-works/pi-ai` → `@google/genai` 等重依赖 [事实：npm ls]；单一 DeepSeek 路由用不上 [建议]。
- `dsh-session-telemetry-otel`、`dsh-anonymous-user-id` —— 主权红线不进组合（注意后者被 `dsh-llm-deepseek` 硬依赖，排除的是 telemetry 行，匿名 id 库会随 adapter 进树）[事实]。
- `dsh-terminal*`、`dsh-tool-pwsh*`、`dsh-pwsh-*`、`dsh-tmux-context`、`dsh-cmdline`、`dsh-headless` —— CLI/终端产品形态件。
- `dsh-web-search-deepseek`、`dsh-tool-web` —— 模型面搜索工具，默认不挂 [建议]。
- 元包 `@deepseek-ai/dsh` 本身 —— CLI launcher 全家桶；Lykoi 自建 profile 直接依赖所选包 [建议]。

---

## 6. 工程事实

- **Node 版本**：[事实] cordis、dsh 及全部精读包 **均无 `engines` 字段**（仅 `node-addon-landlock-run` 声明 `node >=20`）。[事实] jsonl 后端用 `node:zlib` zstd API（lib/index.js:10），Node v24.18.0 实测存在；[推断] 该 API Node 23.8 引入，**有效下限 = Node 24 LTS**（或 jsonl 配 `compression: 'none'` 放宽）。全线 ESM-only（`"type": "module"`）[事实]。
- **体积与包数**：[事实] 元包全装 270MB / 511 依赖（含 UI/web 全家）。单包很小：cordis 239KB、agent-loop 106KB、tools 522KB、subagent 454KB、jsonl 108KB（unpackedSize）。[推断] 按第 5 节裁剪后最小组合约 40-60MB（去 react/web/pi-ai）。
- **锁文件形态**：[事实] npm lockfileVersion 3；**511/511 个 `resolved` 全部指向 `https://registry.npmjs.org`**，无 git/tarball/私有域外源。上游自用 pnpm，消费侧 npm/pnpm 皆可。
- **install 脚本与原生件**：[事实，本机实测] allow-scripts 阻断全部 install 脚本，无一受损：`koffi@3.1.6`（MIT）平台二进制经 **optionalDependencies `@koromix/koffi-<platform>-<arch>` 从 npm registry 安装**（实测 FFI 调用成功）；`node-pty@1.2.0-beta.15`（MIT）prebuilds 六平台**随 tarball 自带**，实测加载成功。结论：**`npm ci --ignore-scripts` 可行**，供应链面更小 [事实(mac)/推断(linux)]。
- **license 抽查**：[事实，逐包 LICENSE] cordis、loader、hmr、dsh、三精读包、agent-loop、tools、telemetry-otel、anonymous-user-id：全部 **MIT**；koffi MIT；node-pty MIT；`node-addon-landlock-run` **BSD-3-Clause**（唯一非 MIT，宽松兼容）。
- **dist-tag 陷阱**：[事实] 子包 `latest`≠当前版（如 token-meter latest=0.0.1-rc.1 / next=0.1.1-rc.2）；元包依赖 `^0.1.1-rc.2` 传递解析所以整装正确，散装必须 `@next` 或钉死。
- **离线/代理安装判断**：[推断，基于上述] http 代理走 npm registry 即可完整安装：唯一 registry 域、无脚本期外网下载（koffi 平台包也是 registry 包）、可 `--ignore-scripts`。建议：本机生成 lockfile → 服务器 `npm ci`；或维护内部 registry 镜像。

---

## 7. 数据主权与回连审计（红线节）

审计方法 [事实]：`@deepseek-ai` 全树 grep URL 常量与 `fetch(` 调用点，命中逐包读码；grep `update-check/checkForUpdate/latest-version` **零命中**（无自动更新检查、无 phone-home 代码路径）。

### 7.1 `dsh-session-telemetry-otel@0.1.1-rc.2`

- **默认关**：[事实] `DEFAULT_TELEMETRY_MODE = DISABLED`（lib/index.js:33，schema default :69）。DISABLED 分支**不构造** coordinator/LoggerProvider/processor/exporter（:109-114），配置里写了 exporter.url 也不构造；`feedback/record` 只落本地警告。README 原文："No telemetry record leaves the process."
- **端点不在包内**：[事实] 生产端点 `https://harness-telemetry.deepseeksvc.com/v1/logs` 在 **dsh-base 的 patch 配置**（`dsh-base:cordis.patch.yml:154`），mode 由 `!!js process.env.DSH_TELEMETRY_MODE || 'DISABLED'`（:151）供值。另有 `DSH_TELEMETRY_DISABLED`（任意非空值）让 launcher 直接 patch 该行 disabled（`dsh:lib/profile-boot-DG5t9aNs.js:99-116,189`）。
- **开了会发什么**：[事实：README「What leaves the machine」] FULL 模式外发**完整会话事件原文**（用户/助手消息、工具参数与结果、完整系统提示词、cwd），seam **默认无 redaction**；Resource 带匿名 user.id。对 Lykoi 是绝对红线，但需三重显式 opt-in 才可能发生。
- [建议] Lykoi 组合**不挂此行**（而非挂了再 disable）；服务器再设 `DSH_TELEMETRY_DISABLED=1` 纵深防御。

### 7.2 `dsh-anonymous-user-id@0.1.1-rc.2`

- **包本体零网络**：[事实，lib/index.js 全文 80 行读毕] 仅 `node:crypto`+`node:fs`：随机 UUIDv4 持久化为 `$DSH_HOME/.anonymous-user-id`，明确不从主机名/网卡/git remote 派生，删文件即重置。
- **但 id 会上行**：[事实] `dsh-llm-deepseek` 在**每个** provider 请求附 `x-deepseek-harness-user-id: <id>`（带 sessionId 时另附 `x-deepseek-harness-session-id`），发往 resolved baseURL **含自配网关**；README 明言 `DSH_TELEMETRY_DISABLED` **不**抑制此头；adapter 源码 `resolveUserId = () => getOrCreateAnonymousUserId()` 无开关（lib/index.js:1787-1793）。另有固定 UA 归因头 `deepseek-harness/<version>`（`dsh-llm:lib/index.js:766-790`，注释明言 "omission cannot suppress attribution"）。
- [建议] 这是用官方 adapter 的代价：请求头级稳定假名标识。选项 a) fork adapter 去掉 resolveUserId（单点改动）[推断]；b) 网关侧剥头；c) 接受（头不进请求体/模型内容）。需白皮书层面定夺。

### 7.3 全树回连面清点

[事实，grep 实测] 硬编码非文档端点仅四类：

| 端点 | 所在 | 触发条件 |
|---|---|---|
| `https://api.deepseek.com` | `dsh-llm-deepseek`（baseURL fallback） | 仅当发起模型请求；可覆写 |
| `https://api.deepseek.com/anthropic/v1` | `dsh-web-search-deepseek:lib/index.js` | 仅当模型调 web_search；可覆写；Lykoi 不挂 |
| `https://harness-telemetry.deepseeksvc.com/v1/logs` | `dsh-base:cordis.patch.yml:154`（配置非代码） | telemetry 三重 opt-in 后 |
| `http://dsh.internal` / docs/github 链接 | client-ui/web 文案 | 纯字符串，无请求代码 |

其余 `fetch(` 命中（`dsh-tool-web`、`dsh-host-apiproxy`、`dsh-client-connection`、`dsh-tool-cordis`、`dsh-llm-pi-ai`、`dsh-session-log-export`）均无内置端点常量——目标全来自配置或浏览器侧 [事实：URL grep 为空]。`dsh-tool-web` 在 base 组合 `fetch: false` 且不挂 fetch provider（SSRF 立场，`dsh-base:cordis.patch.yml:399-418`）。

### 7.4 红线结论

**headless 最小 profile 默认外发面 = 模型 API 请求本身，无其他任何默认外发** [事实：以上逐项]。telemetry 默认 DISABLED 且端点在配置层不在代码层；匿名 id 库零网络；无更新检查。唯一需治理层显式表态的残余：DeepSeek 请求头上的匿名 id 与 UA 归因（7.2 三选项）。

---

## 附：本单未尽事项

- [推断] 未在 Linux 服务器实际过代理安装（本机 macOS 直连）；M1 装机时用 `npm ci --ignore-scripts` 复核。
- [事实] `dsh-agent-loop` 的 ReactLoopAgent 内部状态机源码未逐行读（包不发 src，lib 为 bundle）；第 4 节以 README + .d.ts 为据，M1 若需 fork 再深读。
