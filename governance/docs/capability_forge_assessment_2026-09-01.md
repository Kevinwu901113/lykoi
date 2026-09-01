# Capability Forge 方案对照评估与裁定（2026-09-01）

来源：Kevin 转交的外部（GPT）方案——新增 "Capability Forge" 子系统，处理
"系统发现自己缺少某项能力并尝试构建该能力"。本文是治理侧对照评估、两项
裁定与落位结论。裁定权：Kevin 2026-09-01 原话"这两个你拍板"，授权治理侧
就下述 D-FORGE-1/2 两点定案；Forge 本体其余内容**非定案**。

## 一、对照结论（对白皮书 v1.2 与新体现状）

方案约七成与既有设计同构：

| 方案要素 | 既有等价物 |
|---|---|
| Builder 统一接口 / BuildSpec / sandbox / Candidate Artifact 不直接安装 | 17 章 Delegation Gateway + 18 章任务合同 + 现行工单复核制度（自报完成不算完成） |
| 只改 extensible space、不碰 immutable core | GK-13 受保护面（root 域 kernel + hash-pin 域）+ lykoi-gate 七检查项 + manifest 钉面（比方案硬：结构强制而非 Builder 自觉） |
| 认知≠权限、提议≠执行 | L5 铁律（她无写审批规则路径，建议只入队列） |
| Heavy Builder（Codex/Claude Code/dsh） | coding agent 器官既有定案（两段式：类型注册所有者批一次 + 按任务实例化） |

方案不了解现状之处：它假设 Capability Registry / Plugin Loader 是现成件；
实际这正是 M5 在建（browser 器官为第一单，registryActionCatalog 尚未切换，
"无伤拔插"是方向不是机制）。故 Forge 是插件化的三阶导数，时机未熟。

方案的净新贡献（现行设计无明文）三件：
1. **capability_gap 一等事件**——她想调却没有的能力，先诚实答复、后留痕。
2. **resolution 优先于 build**——先查已有能力/组合/现成插件，生成代码是最后手段。
3. **价值阈值**——gap 记频次/价值/成本，达阈值或所有者明确要求才 build
   （直接回应"审批疲劳"待办盲区，与预算硬顶同构）。

## 二、裁定（定案）

**D-FORGE-1 · 启用权归属：注册≠启用，启用权保留在治理侧。**
任何 Builder 产物最多自动注册为 disabled 态；启用一律是治理动作（现阶段
=所有者/治理侧执行）。有副作用面（可补偿/不可逆）的 capability 启用必过
对话门/硬门。方向 fail-closed；与 converse 默认 disabled、L5 铁律同构。
未来若放宽只读/可逆类为"自动注册 + 影子期"，须以影子期数据另呈所有者拍板。

**D-FORGE-2 · 落位：Forge 永不成为第二委托口。**
Forge = Delegation Gateway 之上的一种 build 型委托用途；Router 复用
Gateway，17 章 [NORMATIVE] 约束全程适用。任何绕开 Gateway 的 Builder
调用路径均属违规设计。

## 三、落位

- **现在**：capability_gap 事件并入 WO-U2-SENSE-01（认知主线第一单）；
  resolution 优先、价值阈值两条写入器官/委托类工单模板与治理台账，零代码。
- **条件立项**：≥2 器官在线且插件拔插成为真实机制后，Forge 作为 Gateway
  build 用途做正式设计（Candidate Artifact 形态化、启用分级呈所有者）。
- **纸面**：白皮书 v1.3 候选素材，挂 21 章（自进化走廊）名下，标
  [EXPLORATORY]。
