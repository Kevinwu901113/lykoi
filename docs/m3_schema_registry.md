# 图式注册机制 · 设计小节（GK-11 / DK-15）· M3-W4

DK-15 记明：图式注册机制**无活体正本 = 新建面**。蓝图 GK-11 因此规定「先出设计
小节再实现首版」，验收四条：注册即感知 / 可逆副作用登记 / 卸载即消失（无幻肢）/
认知可读不可写。本文是那一节设计；实现见
`packages/lykoi-kernel/src/schema-registry.ts`。

## 1. 问题：她凭什么知道自己长着什么

M2 的 `renderOrganInventory`（`lykoi-decide/src/organs.ts`，SA-160/161）已经解决了
「**怎么告诉她**」：把身份绑定、设备通道、动作能力派生成一段只读文本，四条禁止
（不写 channel_key / secrets 永不进 / 不读活规则 / 时效与健康不进清单）钉死。

它没有解决「**清单从哪来**」。W1 之前动作轴接的是显式替身（空动作面），W1 之后
接 `kernelActionCatalog` —— `KNOWN_ACTIONS` 全表 18 项 + 治理核 `isHardGated`。
那是一张**编译期常量表**：18 项里有多少真接了传输面，代码里看不出来。W3 上线了
出站器官真身（messenger 2 + notify.owner + autonomy 2），其余 13 项仍是「大声抛」
的替身 —— 可她的器官清单照样把 18 项全念一遍。

这就是**幻肢**：清单说她有终端，她伸手过去，摔在一个 `throw` 上。方向错了 ——
器官清单的四条禁止全都朝「往少了说」收紧，唯独这一处在往多了说。

## 2. 定案：图式 = 注册出来的，不是声明出来的

**一个器官在身体图式里出现，当且仅当它自己注册过。**

- `KNOWN_ACTIONS` 是**词汇表**（这个动作类型合法、拼写如此），不是**图式**；
- 图式是运行期事实：插件 apply 时把自己登记进来，dispose 时注销。

注册面（`OrganRegistration`）三栏：

| 栏 | 含义 | 纪律 |
|---|---|---|
| `organId` | 器官标识（`telegram` / `notify` / …） | 唯一；重复注册抛 |
| `actions` | 这个器官**真正接得通**的动作类型 | 必须 ⊆ 调用方给的词汇表；越界抛 |
| `sideEffects` | 副作用登记（见 §3） | 数组可空，但**必须显式给**（`undefined` 抛） |

`actions ⊆ 词汇表` 这条是双向闸：器官编不出词汇表以外的动作（防止绕过 dispatch
的 `_resolve` 拒绝面），词汇表也管不着一个没注册的器官（防幻肢）。

## 3. 可逆副作用登记

注册一个器官通常伴随进程外的痕迹：一个 state 文件、一条出站消息通道、一个游标。
`SideEffectDeclaration` 要求每条痕迹自报三件事：

- `kind` / `target`：是什么、落在哪（路径或通道名）；
- `reversible`：卸载时能不能收回；
- `reverse?`：能收回的，把收回动作**在注册时就交出来**（不是卸载时才去找）。

规则：
- `reversible: true` 必须带 `reverse`（缺了抛）—— 「可逆」不是形容词，是一个可
  调用的函数；
- `reversible: false` **允许**，但注销时不会被自动执行，只落一条
  `organ_side_effect_irreversible_retained` 遥测。发出去的消息收不回来，这是事实，
  登记的意义是让它**在账上**而不是让它消失；
- 注销时可逆副作用按 **LIFO** 执行；某一条 reverse 抛了不阻断其余条（落
  `organ_side_effect_reverse_failed`），因为半个注销比不注销更像幻肢。

## 4. 卸载即消失（无幻肢）

`register()` 的返回值**是注销器本身**（`() => void`），不是一个 id ——
「谁注册谁负责注销」在类型上就成立，拿不到注销器的代码也注销不了别人的器官。
注销后：`snapshot()` 里没有它、`catalog().knownActions` 里没有它的动作、
`OrganInventoryCache.invalidate()` 之后清单文本里也没有它。

幂等：重复调用注销器是 no-op（第二次不再跑 reverse），因为 cordis 的 dispose 在
异常路径上可能被调多次。

## 5. 认知可读不可写

这是四条里唯一一条**安全**条款，其余三条是正确性条款。

- 认知面拿到的是 `snapshot()`：`Object.freeze` 过的数组与对象，逐层冻结；
- 认知面**没有** register/unregister 的引用 —— 注册器是接线方（插件 apply）持有
  的对象，`OrganInventoryCache` 只收到 `catalog()` 派生出来的只读视图；
- 派生视图 `registryActionCatalog(registry)` 的类型正是 M2 已有的
  `OrganActionCatalog`（`knownActions` + `isHardGated`），没有一个 mutator。

于是「她读到自己长着什么」和「她能改自己长着什么」在**类型层**分开，不靠纪律。

## 6. 与 OrganInventoryCache 的接合

两者是**源**与**渲染器**的关系，不重叠：

```
BodySchemaRegistry   →  registryActionCatalog()  →  OrganInventoryCache  →  清单文本
（运行期事实：谁注册了）   （只读派生视图）            （进程级缓存 + 渲染）    （她读到的）
```

- 注册表是**权威源**：唯一知道「哪个器官此刻在位」的地方；
- `OrganInventoryCache` 保持 SA-160 的原样：进程级缓存、空清单 → null、
  `invalidate()` 零读、每次构建落 `organ_inventory_built`。它**不**知道注册表的
  存在，只吃 `OrganActionCatalog` 接口 —— 所以这次接合没有改它一行；
- 注册/注销时注册表调 `onChange`，接线方在那里调 `cache.invalidate()`。缓存失效
  是**接线方的编排**，不是注册表反向依赖认知层（kernel 是 CF-B1 库模块，反向
  import 一次都不许 —— W3 已立的纪律）。

## 7. 首版落地范围（M3-W4）与后续

**本波交付**：注册表本体 + 派生视图 + 与 `OrganInventoryCache` 的接合（四条验收
各有实测）。

**本波刻意不做**：不把生产接线（`lykoi-wake` / `lykoi-converse` 的
`catalog: kernelActionCatalog`）切到注册表。理由是范围纪律 —— 切过去等于当场把
13 个未接线动作从她的清单里拿掉，那是**她读到的自我认知的一次实质变更**，属于
器官上线编排（M5）的动作，不该藏在一次完整性门的波次里顺手改掉。切换点与其
后果（清单从 18 项收到 5 项）记在 `docs/m4_handoff.md`，由 M5 显式执行。

**M5 切换清单**：①每个器官插件在 apply 里 `register()`、在 dispose 里调注销器；
②接线方把 `catalog:` 换成 `registryActionCatalog(registry)`；③`onChange` 接
`organs.invalidate()`；④回归断言：未注册器官的动作不出现在清单文本里。
