# WO-OPS-BROWSER-PROXY-01 · 浏览器器官宿主开出站代理（零代码）

- 状态：**已落地**（2026-09-04 00:42:43–00:42:59 CST，Kevin root 执行 apply-proxy.sh 一次通过：host.json.bak-20260904T004243、drop-in proxy.conf、宿主 00:42:44 重启、§4 记账 00:42:59；随后两次重跑被 §0 幂等前验正确拒绝。验收：00:44 那条 ETH/BTC 问价，币安 2.9 s / coingecko 3.7 s status ok，价格经 notify_owner 送达）
- 立单：2026-09-04 00:50 CST，主治理 Agent
- 上游：LANDING-M 后首轮 Telegram 读数（HANDOFF §五）：缝处四跳全净，但五次取数全空 → 180 s 轮次期限 DeadlineExceeded → 沉默

## 1 · 证据（2026-09-04 00:40 CST，服务器只读实核）

| 项 | 实测 |
|---|---|
| `/etc/lykoi-browser/host.json` | `"proxy": ""`（直连） |
| 直连 `api.coingecko.com/api/v3/ping` | 10 s 无响应（000） |
| 直连 `api.kraken.com/0/public/Time` | 10 s 无响应（000） |
| 经 `http://192.168.0.202:7890` coingecko | 200，0.9 s |
| 经代理 kraken | 200，1.4 s |
| 经代理 `api.binance.com` | 451（币安对该出口地理封锁；不在本单范围） |
| 本机 DNS（`getent hosts`） | 四个域名全解析成 `2001::/32` Teredo 地址，解析面已被污染；SSRF 判定器按 Teredo 内嵌 v4 判，coingecko/kraken 放行、binance 判成 blocked_url |
| unit `lykoi-browser.service` | `IPAddressDeny` 含 `192.168.0.0/16`，`IPAddressAllow` 仅 `127.0.0.53/32 127.0.0.1/32` → 即便 host.json 开了代理，出网闸也会拦住 192.168.0.202 |
| lykoi-gate 是否钉此 unit / host.json | `packages/lykoi-gate/src/surface.ts` 无 lykoi-browser、host.json、IPAddress 任何钉面（grep 空）→ 本单不触 GK-6 |

结论：研究器官对境外 API 一律超时到 45 s 上限的根因是**宿主直连而出口不通**，不是缝、不是模型。持久浏览器旧栈曾配代理 192.168.0.202:7890，新宿主落地时代理留空。

## 2 · 决定

- D-1 `host.json` `proxy` 置 `http://192.168.0.202:7890`（deploy/lykoi-browser.host.json.example 与 docs/browser_organ.md §「按需改 proxy」既定形态）。
- D-2 unit 加 drop-in `IPAddressAllow=192.168.0.202/32`（模板第 111 行注释的既定做法；IPAddressAllow 多条累加，drop-in 不覆盖主表；Allow 优先于 Deny）。
- D-3 `systemctl daemon-reload && systemctl restart lykoi-browser.service`；大脑不动。
- D-4 前验/后验眼见为实：`systemctl show -p IPAddressAllow lykoi-browser` 含新条；`journalctl -u lykoi-browser -b | grep -i "ip firewall"` 无失败行（模板警告：BPF 表装不上时 fail open，只记警告）；宿主 active；大脑侧审计尾见 `browser_organ_wired` 或无 `browser_host_unreachable`。
- D-5 **不改** timeouts（45 s）。先单变量看代理后的真实延迟，再决定要不要把 research 超时压到 ~20 s 给 180 s 轮次留 reply 余量。
- D-6 SSRF 判定不因代理豁免（docs §202），binance 类地理封锁与 DNS 污染导致的 blocked_url 属预期，不在本单。

## 3 · 验收

- Kevin 在 Telegram 再问一次需要境外取数的问题（如 ETH 价）：审计 `browser_action` 应出现 `status:"ok"` 且 `chars>0`，`u3_cycle_envelope` 最终 kind 为 reply，无 `turn_failed`。
- 治理侧记 HANDOFF §五 与 ops 记录（脚本 §4 自动落账 `/home/lykoi-gov/reports/governance-ops.jsonl`）。

## 4 · 回滚

删 drop-in `/etc/systemd/system/lykoi-browser.service.d/proxy.conf`，用脚本备份的 `host.json.bak-<ts>` 覆盖回去，`daemon-reload` + `restart lykoi-browser.service`。库、大脑、树三者全程未动。

## 5 · 顺带记下（不立单）

- 动作层把器官 `{ok:false,error:'timeout'}` 记成 `action_result success:true`——接地缺口同源，另立单。
- 派发参数 URL 出现 `&amp;`（coingecko 那条），全仓 src 无实体转义代码，倾向模型输出所致；待代理开通后看是否复现。
