# E1 共享动作事实第一版

基线e350900，分支wo/kinds-converge-02；实现与本地验证完成，未合并、未部署。

根据Kevin授权代定，选择甲案：共享模块放lykoi-decide，保持既有依赖方向、工具呈现和决策语义。原TOOL_TABLE逐字迁至action-registry.ts，converse导出原接口；有序AUTONOMY_ACTIONS派生KINDS及content-required集合。explore的动作名复用research_read_text项，候选wired筛选与reflow的三个外部dispatch从表取值。

保留七个自主kind、四个对话kind。record_note写自主笔记，tend_inner可推进线程/关切，两者不因零使用样本归并；queue_notification与notify_owner参数及预算边界不同，保留原映射。rest泄压、silence不发声、候选接地及失败处理各自不变。审批和真实接线仍来自kernel，不复制静态权限判断，也未扩大自主工具面。

验证：完整npm test退出0，1217 tests /1206 pass /0 fail /11 skipped；typecheck、diff check通过。现有prompt模板/实例渲染SHA、KINDS顺序与必填集合、未接线候选负例、reflow dispatch/内部写入与wake真插件测试通过。未改提示词常量或期待SHA，也未新增重复实现的镜像测试。日志kinds-full.log、kinds-typecheck.log。

改动面：新增decide/action-registry.ts，调整decide/index.ts、converse/contract.ts、reflow/index.ts；四个src文件涉及manifest重签。无迁移或新增依赖。

E1本轮实现完成，但C1缺样本、C2真实tax与生产验收仍不等于完成；E2/37.5前置未满足继续锁定。本单不替代E3的effect_class治理设计，不引入Task Runtime。
