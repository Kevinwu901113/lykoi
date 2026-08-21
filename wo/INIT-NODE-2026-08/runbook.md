# 初始化节点 · 2026-08 · 总 runbook(骨架,随各单复核定稿逐段填实)

**Owner 指令(2026-08-21)**:撤销证据采样;**明示授权 U3 盲切**(红线解除,
governance-ops 2026-08-21T12:05Z);代码整备到新的初始化节点。

## 目标形态

一条 ff 链,**一次 Kevin root 会话**全部落地:

```
活体 1b8ef063 (合并包13)
  → 7b00ae5e   合并包14 · 审批送达 v2(设备层问句)          [已发布,bundle 816fd0f1]
  → <GW tip>   合并包15 · Delegation Gateway 数据面+管线面   [第2波执行中→复核→发布]
  → <U3S tip>  合并包16 · U3 切换读者(信封转正)             [已签发,GW复核后派发]
  + 切换 env 翻转(lykoi-server drop-in LYKOI_U3_SWITCH_ENABLED=1)
  + 回滚 tag + 初始化节点 tag
```

串行基设计(U3S 基 = GW tip)使三包 manifest 重签无冲突,最终**统一重签一次**。

## root 会话步骤(定稿时逐段展开为可粘贴命令)

- **A0** 先验 HEAD=1b8ef063、五服务 active、工作树净(教训 39 模板)。
- **A** `git tag rollback-pre-init-node` → bundle 校验(三包各自 sha256)→
  ff-merge 到 U3S tip(kernel/guardian/core 属主归位 root+清 pycache,教训 37/39;
  GW-01 触 kernel/dispatch.py,A 步必须 root,教训④升级版)。
- **B** manifest 统一重签(root;条数以包 16 复核定稿为准)。
- **C** 关闭态验证:lykoi 身份 C 步测试清单(三包并集,定稿时给)、
  `startup_verify: OK`、五服务 restart、/health、影子照跑、**切换键仍关**。
- **D** 切换翻转:写 lykoi-server drop-in `LYKOI_U3_SWITCH_ENABLED=1`,
  `daemon-reload` + 重启 lykoi-server(其余单元不动)。
- **E** 切换态验证:Kevin 发一条消息——预期信封周期驱动回复(audit 见
  `inner_outer_pair`+E2 章、零 shadow 调用);再发一条要 terminal 动作的——
  预期审批问句以**引用回复**到达(判据⑧实弹)。异常即回滚:drop-in 撤除+
  重启=秒级回到关闭态。
- **F** `git tag init-node-<日期>`;可选:`systemctl disable --now
  lykoi-gate-readout.timer`(证据门已作废;留跑亦无害,Kevin 单选)。
- **G** 备份:治理仓库 push 已由治理侧做;活体侧 offsite git push 照常 cron;
  deployment_config 若 drop-in 新增须入包(BACKUP-04 口径)。

## 状态清单(治理侧维护)

| 件 | 状态 |
|---|---|
| 合并包 14(审批送达 v2) | ✅ 已发布 `wo/WO-FIX-APPROVAL-DELIVERY-MERGE/`,bundle /tmp 完好 |
| WO-GW-01 第 2 波 | ⏳ 执行中(8-21 18:55 起 opus;第 1 波判据②–⑥幸存) |
| 合并包 15(GW-01) | ⌛ 待复核后发布 |
| WO-U3S | ✅ 已签发(盲切授权入单);⌛ GW 复核后建基派发 |
| 合并包 16(U3S+切换) | ⌛ 待复核后发布 |
| 本 runbook 定稿 | ⌛ 包 15/16 发布后合并为单次可粘贴 root 稿 |

## 回滚总线

- 切换行为回滚:撤 drop-in + 重启 lykoi-server(秒级,代码不动)。
- 代码回滚:`rollback-pre-init-node` tag(=1b8ef063);分段回滚点在各包内。
- U4(转录机清理/周期接力/sendPhoto 等)**不在本节点内**——切换态跑稳后另开。
