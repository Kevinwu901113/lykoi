# WO-COMPOSER-UI-02 交付报告

状态：实现与本地自验完成，待独立复核；未合并，未操作生产环境。基线是 Composer 原工作分支 5760fbee6eb2992f2191761ff58eaf55ff1e7adc。

## 结果

原三栏长表单改为画布主导的节点编辑器：左侧窄工具栏按需打开组件库、已保存定义或 Agent 设置；右侧选中节点配置；顶部保存/试运行；底部可收起的运行输入、输出和时间线。支持深浅主题与窄屏布局。

已实现节点标题拖动、画布平移/缩放、适应画布、按依赖排列、双击定位添加和组件搜索。端口支持拖动及点击连接，立即拒绝自连/环路/不兼容类型/工具数据流，已连接的输入明确替换；连接可选择并删除。支持有界撤销/重做，文本输入不劫持原生快捷键。

常用提示词/系统提示词/等待提示改为直接字段，高级 JSON 仍可用；无效 JSON 在切换选中节点后保留，阻止保存。Core 工具绑定采用与数据实线区分的虚线；模型与文件工作区仍由显式资源角色绑定。

可选 editor 元数据保存位置和视口；旧定义无元数据时自动布局。服务端检查坐标、节点归属和缩放界限；布局不改变 graphOrder，修改后的保存版本不会改动运行快照。节点执行标记只匹配同 Agent 的同一已保存版本，草稿编辑不沿用旧运行状态。

## 源码调研

实际阅读 Dify workflow/index.tsx、use-nodes-interactions.ts、use-workflow.ts，以及 ComfyUI frontend GraphCanvas.vue、TransformPane.vue、useCanvasInteractions.ts。文件 blob SHA、读过的范围、官方资料、采用与未采用的部分完整记录在 docs/composer-ui-research.md。采用状态划分与交互方式，独立实现当前有界编辑层，没有复制第三方组件源码或引入它们的完整应用。

## 验证

- Composer 测试：18/18 通过（原 16 项 + 编辑器约束/布局版本运行隔离、缩放锚点 2 项）。
- 类型检查：通过。JS 语法检查通过。
- 全仓：1316 项，1290 通过、14 失败、12 跳过；与原交付基线 1314/1288/14/12 比较，失败名称集合完全一致，零新增失败。
- DOM 操作：实际页面脚本+真实 API 路由，拖动、缩放、连线校验/替换、撤销重做、面板主题、布局持久化，以及实例→运行→人工输入→完成通过。
- 真实 Chromium：通过实际 loopback HTTP 服务测试鼠标节点拖动、端口拖动、撤销重做、环路拒绝、滚轮缩放、布局保存、导出/导入新身份、跨节点无效配置阻止保存、深浅主题、实例运行、人工等待续接、节点状态及 390px 无横向溢出。页面脚本错误 0。明细见 browser-result.json。
- 已检查深色、浅色、人工等待和窄屏真实截图；随分支保存 preview-dark.png 与 preview-waiting.png。不是界面概念图。

测试辅助工具安装在临时目录，不修改项目依赖：happy-dom 20.14.5、Playwright-core（工作环境自带）、@sparticuz/chromium 153.0.0。截图环境没有中文字体，临时安装 @fontsource/noto-sans-sc 并转换其字体子集供 Fontconfig 使用；产品继续使用系统字体。浏览器测试未启用 Chromium 包提供的 disable-web-security / allow-running-insecure-content 参数。

复现：在仓库根运行 npm run composer，打开本机 http://127.0.0.1:4310。可选浏览器脚本调用：

```sh
node packages/lykoi-composer/test/browser-smoke.mjs /path/to/playwright-core/index.mjs /path/to/chromium/build/index.js /path/to/output-directory
```

## 范围与待办

不是完整 Dify/ComfyUI 功能对等：多选/分组、迷你地图、单节点执行、条件/汇合、嵌套与循环图、协作编辑未实现。仍最多 64 节点，本次没有扩张运行语义。示例为离线模型，不提供真实联网调研。

代码由独立复核决定是否合入原 Composer 工作分支，再审原 PR #25；本次不合并主分支、不发布生产。
