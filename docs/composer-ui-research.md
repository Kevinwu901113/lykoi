# Composer UI 源码研究与实施依据

调研时间：2026-10-01。研究面向当前技术开发者用户与 64 节点首版范围；不是 Dify 功能对等声明。

## 实际阅读的官方源码

| 来源 | 文件 / 已读范围 | 文件 blob SHA | 发现与采用 |
| --- | --- | --- | --- |
| Dify | [workflow/index.tsx](https://github.com/langgenius/dify/blob/main/web/app/components/workflow/index.tsx)，480–840 | 293df78ec1224cb63efb8d0db52a493b92597ac3 | WorkflowCanvas 接收独立的节点拖动、连接、视口事件；Background 与外层配置分离。采用画布主导布局与视口状态分离。 |
| Dify | [use-nodes-interactions.ts](https://github.com/langgenius/dify/blob/main/web/app/components/workflow/hooks/use-nodes-interactions.ts)，1–335 | 59e4784e108e3b20ddef3efbfad79c647f6f5a74 | 记录拖动起点，过程中更新位置；有对齐、容器约束及协作状态。采用起点 + 缩放校正的增量坐标，本版不声称具有协作或嵌套容器。 |
| Dify | [use-workflow.ts](https://github.com/langgenius/dify/blob/main/web/app/components/workflow/hooks/use-workflow.ts)，1–220、260–450 | dd4127f8472ae8fc75923737ed519779807d0e20 | 连接前检查节点类别及递归后继环路；不是画出连线后才等待保存失败。采用客户端即时校验，服务端仍独立复验。 |
| ComfyUI frontend | [GraphCanvas.vue](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/components/graph/GraphCanvas.vue)，1–470 | ae8ad7ebddc3dc53834535b851e96e5066dce680 | 外壳由顶部、侧栏、右侧属性、底部面板、画布和节点搜索组成；Vue 节点与连线有独立呈现层。采用可收起面板，不将一切表单常驻。 |
| ComfyUI frontend | [TransformPane.vue](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/renderer/core/layout/transform/TransformPane.vue)，完整 | e6e7c6fa43c38c47d4eb089927b0448ea1cd9f01 | 坐标变换直接作用于单个容器，避免每帧重建整个节点集合。采用 DOM 节点 + SVG 连接的统一变换层。 |
| ComfyUI frontend | [useCanvasInteractions.ts](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/renderer/core/canvas/useCanvasInteractions.ts)，完整 | bed2c6a2ff8770b67f1305cd29c20c3ffbf6ea44 | 区分输入控件滚动、画布缩放、中键/空间键平移，明确事件所有权。采用标题拖动、端口连接、空白平移、输入控件保留原生事件。 |

官方产品资料：[ComfyUI 界面概览](https://docs.comfy.org/interface/overview)、[Nodes 2.0](https://docs.comfy.org/zh/interface/nodes-2)、[Dify 节点调试和变量检查](https://dify.ai/blog/dify-1-5-0-real-time-workflow-debugging-that-actually-works)、[React Flow 连接校验](https://reactflow.dev/examples/interaction/validation)、[保存与恢复](https://reactflow.dev/examples/interaction/save-and-restore)。

## 适配决定

1. 主画布采用紧凑的节点工作台：端口、关键配置摘要、节点状态、输出标记；深浅主题。左侧窄工具栏展开组件/定义/设置，右侧显示选中节点配置，运行详情放可收起底部面板。
2. 组件通常在库中加入后手动连接。示例才生成预连接链路，避免“添加顺序即执行顺序”的误解。一个输入已有连接时明确替换，不隐式产生首版不支持的汇合。
3. 数据流用实线；Core→工具绑定用虚线与文字说明，不伪装成普通顺序执行边。资源仍使用显式角色绑定。
4. 保留高级 JSON，但文本模板、系统提示词、等待提示使用直接可编辑字段。无效 JSON 跨节点切换保留，并阻止保存。
5. 布局写入可选 editor 元数据，与执行拓扑区分；旧定义缺省自动布局。坐标不参与 graphOrder，持久运行继续固定原定义。
6. 运行结果和时间线复用已有真实 API。节点状态仅对应同一 Agent 的同一已保存版本；编辑草稿时隐藏旧执行标记。没有新增单节点执行或可编辑缓存 API，因此不展示这些按钮。

## 实现选择与边界

Dify 基于 React Flow，ComfyUI 有 LiteGraph/Vue 混合渲染和大量工作流管理。直接搬入任一前端都会给当前无构建步骤的 Composer 增加另一套应用框架、状态和依赖。本版独立实现有界交互层，研究交互与状态划分，不复制它们的组件源码。已阅读两库 LICENSE；引用研究不等同于把其前端集成进 Lykoi。

独立实现不是无限扩展承诺：仍限制 64 节点；多选、群组、嵌套图、复杂端口、多输入、协作编辑或大量节点需要另行评估成熟图编辑器迁移，不能持续堆叠到当前轻量层。

未实现：框选/多选、分组、迷你地图、单节点调试、条件/汇合、任意循环图、协作编辑。此次不修改运行内核以虚假满足这些界面能力。
