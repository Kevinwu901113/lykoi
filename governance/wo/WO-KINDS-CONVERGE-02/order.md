# WO-KINDS-CONVERGE-02 · 共享动作事实第一版

依据Kevin“都你来决定”的授权，采用WO-KINDS-01甲案，保持两处提示词及工具呈现SHA不变。保留七种自主kind及四种对话kind，不合并record_note/tend_inner，不新增delegate或自主工具权限。

共享模块放lykoi-decide/action-registry.ts，沿既有依赖方向。迁入现有TOOL_TABLE；自主有序元数据表派生KINDS/content-required列表，explore复用research_read_text动作名。reflow实际dispatch与候选wired过滤读同一表。queue_notification/notify_owner action名不同且预算语义不同，本轮保留两条，不强行统一参数。

“审批/是否接线”不能成为本表新的静态真相：这些仍由kernel实际注册/授权判断供给。此表只收编认知名称、形状和映射；不替代E3 effect_class registry，不造Task Runtime。C1补样本和C2真实tax仍独立待实测，本变更不宣称探针已完成或生产解锁。

验收：现有全部prompt SHA、KINDS顺序/必填列表、候选wired负例、reflow三条dispatch与内部写入回归通过；全量和typecheck净。root/生产部署、主线合并继续原权限边界。
