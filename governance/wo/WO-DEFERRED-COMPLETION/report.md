# 补齐验收记录

承接 Panel (`4e51169`) 与 Persona v2 (`9939f03`)，本批完成：

- Character Card v1/v2.0/v3.0 JSON 与 PNG 转换为原生角色包，保留源文件全部字节，未映射的世界书/指令/资源等在导入报告中列出。不是完整 Tavern 前端兼容层。
- Mind 新增 self、moment，复用现有证据、事务和快照版本；moment 到期退出当前工作集并保留历史。旧可认知 narrative 作为去重事件重新评估，不自动把旧叙述作为当前真值。Converse/Wake 共用 Mind；Task 同时读取当前和相关记录。
- 修正图片 base64 被当成文字的旧视觉接线；复用官方附件插件和现有预算化 LLM。Panel 单图上传及截图识别传递真实 image block。本地预览仍是固定测试模型，不能识别图像内容。
- 独立 Instance 可在独立 OS 进程并行；状态目录锁同时用于 CLI 和生产入口，保留 supervisor 与 worker 的存活归属。没有引入角色间任务调度。
- 候选生产 profile 装配 Panel、Workspace、Pi Runner、附件存储；部署脚本准备固定 Pi 供给、停机备份、依赖更新、Gate 重签和启动。原有审批门保留。

本地最终全量：1266 项，1255 通过、0 失败、11 项既有外部 devstate 跳过。随后针对 supervisor/worker 锁收尾单独复测真实进程 4/4；补充 narrative 去重断言后 Mind 8/8。typecheck、git diff --check、升级脚本 bash -n 通过。首次远程 CI 发现新增 mock 配置 imageInput 被误设为必填，影响旧测试调用的类型兼容；已改为可选，保持原有纯文本默认。远程 CI 以 PR 的最终提交结果为准。

实际验证包含：导入后创建/恢复实例；两个进程同时运行且 A/B 记忆和审计互不混淆、同一 A 重复启动拒绝；self 持久与修订、moment 截止时刻退出、历史检索；真实 Conversation 模型请求含新人格记录；HTTP 附图经过实际附件解码/存储，以 image 类型到测试适配器，正常进入 Converse，卸载附件服务后不可继续上传。测试适配器核对真实 1×1 图片引用和可读字节，不用一句固定回复冒充图像传输证据。

浏览器实测：提交合成 PNG，真实聊天记录包含标明测试边界的视觉观察，表单完成；390px 宽度 clientWidth=scrollWidth=390；未见浏览器 console error。文件选择工具出现一次约 13 分钟的响应延迟，最终完成；没有将等待算作验收通过。

生产只读核对为 `9bb57eb`、active/running、NRestarts=0、Node v24.18.0。治理 SSH 无 root 写入/重启权限，PATH 未发现 Pi。**未部署本批、未向在役角色发测试消息、未验收真实视觉模型。** 生产视觉保持 disabled，等待真实图像模型供给；Telegram 图片、音频/视频和完整世界书解释器未实现。

复核结论：本批无需新 Runtime 框架或新心智数据库，无 Kernel/Gate 策略改动；角色、附件与运行状态仍分离，插件装卸由 Cordis 生命周期承接。Resolver、Forge、DAG、自动 Skill 晋升、角色间调度与“大插件内核”继续冻结。上述工程交付不替代生产功能和长期人格体验验收。
