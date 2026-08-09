# WO-MAC-UPLINK-01 · 感知上行"服务器就绪"改造（Mac lane，与服务器两单并行）

执行方式：Mac 本机 sonnet 子 Agent（主治理 Agent 派发），仓库 percept-02-mac-repo，
分支 wo/mac-uplink-01（基于 codex/mac-memory-fuse-20260729）。

要点：上行目标可配置（默认仍本地 mock，行为零变化）；可选 Bearer token
（独立 Keychain 条目 com.lykoi.mac-app/percept-token，经环境变量传 watcher）；
离线磁盘队列（JSONL 分段、0600、指数退避、50MB 上限淘汰）；fake_surface 加
token 校验与故障注入以便测试。隐私红线：队列只存已脱敏事件、不落 token、日志不打正文。

完整措辞见派发记录（内容与服务器工单同纪律：报告含硬数字、测试实跑）。
