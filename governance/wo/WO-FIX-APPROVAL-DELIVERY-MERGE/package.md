# 合并包 14 · WO-FIX-APPROVAL-DELIVERY 审批问句送达修复 · 2026-08-19

- 分支 `wo/approval-delivery` 尖 **`7b00ae5e`**,基 `1b8ef063` = 当前活体 HEAD → 可 ff。
- bundle `/tmp/lykoi-merge-apprdeliv-20260819.bundle`,sha256
  `816fd0f12a3dfd0cb91e1c22cb7ebdba95bafe50d3f1908a1b692d3d81a0cdca`
  (thin 基 `1b8ef063`,verify 已过)。
- 改动面:`cognition/conversation.py` + `resources/telegram_device.py` +
  `surface/app.py` + 新测试 `tests/test_approval_delivery.py` + manifest
  (110→110 改 3 哈希);**零 kernel、零 guardian 代码、零 messenger、零新 env**。
- 生效语义:对话轮内审批问句由设备层以当轮入站 id 为 reply_to 发出,不再吃
  打扰纪律日配额;自主情境问句仍计预算(P1 附文 §6,Kevin 2026-08-19 拍板)。
- **本包不碰 U3 影子与切换键。**

## A · 合并(root;教训 39:先验 HEAD 再动手)

```bash
sudo -u claude sha256sum /tmp/lykoi-merge-apprdeliv-20260819.bundle
cd /home/lykoi/projects/lykoi && git rev-parse HEAD
# 必须显示 1b8ef063…,不是就停下喊治理侧
git fetch /tmp/lykoi-merge-apprdeliv-20260819.bundle wo/approval-delivery
git merge --ff-only 7b00ae5e
git rev-parse HEAD   # 应 = 7b00ae5e2a4c9fd43dfad28a84ffb28bbf12846b
```

## B · 属主(root;先验合并到位,后动属主)

```bash
cd /home/lykoi/projects/lykoi
test "$(git rev-parse HEAD)" = "7b00ae5e2a4c9fd43dfad28a84ffb28bbf12846b" || echo "STOP: HEAD 不对"
chown lykoi:lykoi src/lykoi/cognition/conversation.py src/lykoi/resources/telegram_device.py src/lykoi/surface/app.py tests/test_approval_delivery.py
chown root:root guardian/manifest.sha256
find src -name __pycache__ -type d -exec rm -rf {} +
chown -R lykoi:lykoi /home/lykoi/projects/lykoi/.git
```

## C · 测试(lykoi 身份;新套件 + 审批环 + p0)

```bash
cd /home/lykoi/projects/lykoi && sudo -u lykoi bash -c 'timeout 1800 .venv/bin/pytest -q tests/test_approval_delivery.py tests/test_approval_conversation.py tests/test_telegram_device.py tests/test_messenger.py tests/test_p0_integrity.py'
```

预期全绿。

## D · 重启与门(**两个承重单元 = lykoi-server + lykoi-telegram,按惯例五服务全重启**)

```bash
systemctl restart lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && sleep 3 && journalctl -u lykoi-server -n 8 --no-pager | grep startup_verify; systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram; curl -s 127.0.0.1:8080/health | head -c 120
```

半途状态自愈说明(执行方判据⑧核对):只重启其一不损坏——设备新/服务旧 =
旧 surface 忽略未知字段,退化为"只发回复";服务新/设备旧 = 设备不带标记走
逐字节旧路。但都修不好病,所以两个都要重启。

## E · 验证(落地即可测,不用等窗口)

- 对话里再让她跑一个终端小任务(接雨水复刻即可):这次问句应当**作为对你
  消息的引用回复**出现在 Telegram 里;你回"可以"应当绑定执行。
- audit 应见 `approval_question` `stage=asked` `delivered=true`;打扰账本
  (messenger_outbound.json)不再为问句记账。
- 回滚:代码回滚点 `1b8ef063`;行为级回滚 = 无(设备端标记是常量真,回滚即
  回代码——问句重新回到打扰预算轨道,即今天的病)。
