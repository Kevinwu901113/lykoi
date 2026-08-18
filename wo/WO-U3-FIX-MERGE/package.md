# 合并包 13 · WO-U3-FIX 影子信封修复 · 2026-08-19

- 分支 `wo/u3fix` 尖 **`1b8ef063`**,基 `a923c44e` = 当前活体 HEAD → 可 ff。
- bundle `/tmp/lykoi-merge-u3fix-20260819.bundle`,sha256
  `781ec3d856029dd0b4c5ec1ba3ecb992ddb5c9f54c88bb4a23f7d155a8c78852`(thin 基
  `a923c44e`,verify 已过)。
- 改动面:cognition 三文件 + manifest(110→110 改 3 哈希)+ 测试;**零 kernel
  零 guardian 代码**;新 env 1 个(`LYKOI_U3_SHADOW_JSON_MODE` 默认开,单元
  文件不用动);重启面理论上仅 lykoi-server,按惯例五服务全重启。
- **本包不碰切换键。**

## 追认项 2 条(随包,Kevin 一并回复)

1. `pulse_invalid` 当前不可达——执行方未为凑枚举改护栏,实现为"未来会抛的
   消毒器的预留位"并双面测试。复核方认可(护栏松紧是另一单的事)。
2. `unknown_kind` 的 detail 比工单更严:不截断,整值 ≤20 字才原样记,超长只记
   长度——防"回复正文塞进 kind 时前 20 字落日志"。复核方认可(严格加强)。

## A · 合并(root 执行——教训 39:manifest 属 guardian,普通身份 unlink 不动)

```bash
sudo -u claude sha256sum /tmp/lykoi-merge-u3fix-20260819.bundle
cd /home/lykoi/projects/lykoi && git rev-parse HEAD
# 必须显示 a923c44e…,不是就停下喊治理侧(教训 39 模板修正:先验 HEAD 再动手)
git fetch /tmp/lykoi-merge-u3fix-20260819.bundle wo/u3fix
git merge --ff-only 1b8ef063
git rev-parse HEAD   # 应 = 1b8ef063…
```

## B · 属主(root;先验合并到位,后动属主)

```bash
cd /home/lykoi/projects/lykoi
test "$(git rev-parse HEAD)" = "1b8ef063e1e50900323d28857ea304bbd8df632b" || echo "STOP: HEAD 不对"
chown lykoi:lykoi src/lykoi/cognition/conversation_cycle.py src/lykoi/cognition/llm_client.py src/lykoi/cognition/llm_router.py tests/conftest.py tests/test_u3_conversation_cycle.py tests/test_u3fix_contract_hardening.py tests/test_u3fix_failure_observability.py tests/test_u3fix_json_mode.py tests/test_u3fix_zero_disturbance.py
chown root:root guardian/manifest.sha256
find src -name __pycache__ -type d -exec rm -rf {} +
chown -R lykoi:lykoi /home/lykoi/projects/lykoi/.git
```

## C · 测试(lykoi 身份;含 U3-FIX 四新件)

```bash
cd /home/lykoi/projects/lykoi && sudo -u lykoi bash -c 'timeout 1800 .venv/bin/pytest -q tests/test_u3fix_failure_observability.py tests/test_u3fix_json_mode.py tests/test_u3fix_contract_hardening.py tests/test_u3fix_zero_disturbance.py tests/test_u3_conversation_cycle.py tests/test_u3_policy_exemption.py tests/test_u3_shadow_zero_disturbance.py tests/test_p0_integrity.py'
```

预期全绿。

## D · 重启与门

```bash
systemctl restart lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && sleep 3 && journalctl -u lykoi-server -n 8 --no-pager | grep startup_verify; systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram; curl -s 127.0.0.1:8080/health | head -c 120
```

## E · 观察(影子第二夜,换了新姿势)

- json 强制 + 结构化失败账即刻生效(默认开,零配置);
- 正常聊天重攒样本;读数命令已更新(`wo/WO-U3-MERGE/readout.md`,新增失败
  原因直方图)——门③ 期望:`not_json/first_char:cjk|ascii_alpha` 塌掉;
- 若信封能解析但质量差(demote 率高/decision 怪),kill switch:
  `LYKOI_U3_SHADOW_JSON_MODE=0` 进 llm.env 重启 lykoi-server。

## 回滚

影子整体:`LYKOI_U3_SHADOW_ENABLED=0`;仅 json mode:上面的 kill switch。
代码回滚点 = `a923c44e`(不应需要)。
