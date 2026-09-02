# 浏览器器官 · 运行手册

正本：`governance/wo/WO-M5-ORGAN-BROWSER/order.md`（定案 D-1..D-10）与同目录
`charter.md`。本文只讲怎么落地、怎么看、怎么坏了怎么办。

## 0 · 形态

两个进程，一条 socket。

| | 大脑侧 | 宿主侧 |
|---|---|---|
| 代码 | `packages/lykoi-organ-browser/src/index.ts`（Cordis 插件） | `packages/lykoi-organ-browser/src/host.ts`（守护进程） |
| OS 用户 | `lykoi` | `lykoi-browser` |
| unit | `lykoi-cordis.service` | `lykoi-browser.service` |
| 持有 | 三个动作的 handler | Chrome、持久 profile、截图 |
| 配置 | `profile/cordis.prod.yml` 里只有 `socketPath` | `/etc/lykoi-browser/host.json` |

**大脑永不 spawn Chrome。** 两侧都零 env 读取（GK-6）。

**两侧互相看不见（2026-09-02 复核修订）**：

- 宿主 → 大脑：unit 带 `ProtectHome=tmpfs`，宿主视野里的 `/home` 是一张空 tmpfs，
  只有 `BindPaths=/home/lykoi-browser` 把它自己家挂回来。`/home/lykoi` 不在它的
  挂载命名空间里 —— 它带什么组都读不到。代码树经
  `BindReadOnlyPaths=/home/lykoi/projects/lykoi-cordis:/opt/lykoi-browser/tree`
  只读挂进来，宿主**不需要任何附加组**。
  （早先那版靠 `usermod -aG lykoi lykoi-browser` + `SupplementaryGroups=lykoi`，
  方向是反的：`/home/lykoi` 虽是 750，其下 `state/backups/`、`reports/`、`.config/`
  等多为 755/775 组可读，带上 lykoi 组就穿得过去。已删除。）
- 大脑 → 宿主：socket 属组是宿主自己的主组 `lykoi-browser`（0660），由**大脑**加入
  该组来连（`usermod -aG lykoi-browser lykoi`）。家目录 `700`，所以同组也进不去
  `profile/`；组只买到"连 socket"这一件事。

三个动作（v1，只读）：

| 动作 | 上下文 | 参数 | 返回 |
|---|---|---|---|
| `browser.navigate` | 持久 profile，单 tab | `{url}` | `{url, final_url, title, screenshot}` |
| `browser.get_text` | 同上，读当前页，不导航 | `{max_chars?}` | `{url, title, text, chars, truncated, untrusted, screenshot}` |
| `research_browser.read_text` | 全新一次性上下文，用完即毁 | `{url, max_chars?}` | 同上加 `final_url` |

其余六项（`browser.click/type/screenshot`、`research_browser.open/extract_links/screenshot`）
保持替身：她要用会落 `capability_gap{not_wired}`（v2 词汇的输入，不是故障）。

## 1 · 依赖

`playwright-core`（精确钉版，无 postinstall、不下载浏览器，驱动系统 Chrome）。
安装一律 `npm ci --ignore-scripts`。**不要装 `playwright` 全家桶** —— 它靠
postinstall 下载浏览器，那是不受 manifest 约束的执行面。

系统需要 Google Chrome：`/usr/bin/google-chrome`（服务器现装 148）。

## 2 · root 落地（逐条命令）

### 前验：NoNewPrivileges 下 Chrome 沙箱可用吗

unit 带 `NoNewPrivileges=true` / `RestrictSUIDSGID=true`，Chrome 于是只能用命名空间
沙箱（setuid helper 在这两条下不可用）。落地**之前**先跑这条探针：

```sh
tmp=$(mktemp -d)
setpriv --no-new-privs /usr/bin/google-chrome --headless=new --no-first-run \
        --disable-gpu --user-data-dir="$tmp" --dump-dom about:blank
echo "exit=$?"
rm -rf "$tmp"
```

期望：`exit=0` 且打出 `<html>…</html>`。服务器上 2026-09-02 实测通过（`/etc/apparmor.d/chrome`
给 `/opt/google/chrome/chrome` 放行了 `userns`，而 `kernel.apparmor_restrict_unprivileged_userns=1`）。

**探针失败时不要加 `--no-sandbox`。** 那等于把"Chrome 是唯一执行外部代码的进程"这条
前提作废。记录现象（exit code、stderr 全文、`aa-status | grep chrome`）并停下，回治理侧
重新定隔离形态。

### 前验二：本机的 systemd IP 过滤真的在生效吗

unit 的出网闸（`IPAddressDeny=` / `IPAddressAllow=`）是 cgroup 上的 eBPF。它**装不上时
systemd 只记一条警告、单元照常启动** —— 也就是说，"模板里写了"不等于"生产里拦得住"。
落地前用 `systemd-run` 单独验一次，root 执行：

```sh
# ① 带 Deny：期望连不上（rc 非 0）。目标要挑一个**确实有人在听**的私网地址，
#    否则连不上也可能只是没人应答，证明不了任何事。这里用大脑的代理（已知在听）。
systemd-run --wait -p IPAddressDeny=any -p IPAddressAllow=127.0.0.53/32 --quiet \
  curl -sS -m 3 -o /dev/null http://192.168.0.202:7890/ ; echo "带 Deny rc=$?"

# ② 对照，不带 Deny：期望连得上（rc 为 0，或至少是"代理拒绝了这个请求"这类
#    应用层错误，而不是网络不可达）。
systemd-run --wait --quiet \
  curl -sS -m 3 -o /dev/null http://192.168.0.202:7890/ ; echo "无 Deny rc=$?"
```

**两条都要跑。** 只跑①证明不了过滤在生效（可能它本来就连不上）；只有"①失败、②成功"
这一对结果才说明本机的 cgroup BPF 过滤确实起作用。

若①也返回 0（即带着 Deny 还是连上了），说明本机 eBPF 防火墙没生效 —— **停下**，
不要按"反正还有 SSRF 判定器"继续：判定器拦不住重定向 hop（§4.1），出网闸是那条缺口
在 v1 的唯一封口。

起服务之后再看一次日志，确认表真的装上了：

```sh
journalctl -u lykoi-browser.service -b | grep -i "ip firewall"   # 期望没有失败行
```

### 逐条命令

以下全部以 root 执行，`<NODE_BIN>` = Node 24 绝对路径。

```sh
# ① OS 用户与目录。无登录 shell、无密码；家目录只有它自己进得去（700 —— 大脑
#    即便同组也读不到 profile 里的登录态）。
useradd --system --create-home --home-dir /home/lykoi-browser \
        --shell /usr/sbin/nologin lykoi-browser
chmod 700 /home/lykoi-browser
install -d -o lykoi-browser -g lykoi-browser -m 700 /home/lykoi-browser/profile
install -d -o lykoi-browser -g lykoi-browser -m 700 /home/lykoi-browser/data
#    代码树只读 bind 的挂载点（空目录，内容由 unit 的 BindReadOnlyPaths 挂进来）。
install -d -o root -g root -m 755 /opt/lykoi-browser
install -d -o root -g root -m 755 /opt/lykoi-browser/tree

# ② 方向是反的：**大脑加入 lykoi-browser 组**，好去连宿主的 socket。
#    宿主一个外来组都不带 —— 它在自己的挂载命名空间里根本看不见 /home/lykoi。
usermod -aG lykoi-browser lykoi
#    附加组要重启进程才生效。LANDING-H 本来就要重启大脑（第⑦步），不用额外动作；
#    验证：`sudo -u lykoi id -nG | tr ' ' '\n' | grep -x lykoi-browser`（大脑重启后再验）。

# ③ 配置文件（root 属主，宿主只读）。
install -d -o root -g root -m 755 /etc/lykoi-browser
install -o root -g root -m 644 \
        /home/lykoi/projects/lykoi-cordis/deploy/lykoi-browser.host.json.example \
        /etc/lykoi-browser/host.json
#   按需改 proxy / screencast / timeouts；改完 systemctl restart。

# ④ 单元。
install -o root -g root -m 644 \
        /home/lykoi/projects/lykoi-cordis/deploy/lykoi-browser.service.template \
        /etc/systemd/system/lykoi-browser.service
sed -i "s#<NODE_BIN>#<NODE_BIN>#" /etc/systemd/system/lykoi-browser.service
systemctl daemon-reload
#    起之前先让 systemd 自己把这份单元读一遍（IPAddress* 那两行地址前缀写错的话，
#    这里就会说，不用等到起服务才发现）。
systemd-analyze verify /etc/systemd/system/lykoi-browser.service

# ⑤ 起宿主，先只验 health（这一步不需要大脑在跑，但需要第⑥步的 npm ci 已经做过
#    —— host.ts import playwright-core；树里没有 node_modules 时宿主起不来）。
#    bind 挂载不改权限：宿主以 lykoi-browser 身份读挂进来的树，所以树本身要 o+rx。
#    750 的 /home/lykoi 不挡路 —— 挂载点是 /opt/lykoi-browser/tree，权限检查从
#    挂进来的那个目录往下算，不再经过它的宿主侧父目录。要看的是树自己的 other 位：
stat -c '%a %n' /home/lykoi/projects/lykoi-cordis \
     /home/lykoi/projects/lykoi-cordis/packages/lykoi-organ-browser/src/host.ts \
     /home/lykoi/projects/lykoi-cordis/node_modules/playwright-core
#    期望目录 o+rx（如 755）、文件 o+r（如 644）。不满足就 chmod o+rX 补上。
systemctl enable --now lykoi-browser.service
systemctl status lykoi-browser.service --no-pager
ls -l /run/lykoi-browser/host.sock   # 期望 srw-rw---- lykoi-browser lykoi-browser
sudo -u lykoi node -e '
  const net=require("net");const s=net.connect("/run/lykoi-browser/host.sock");
  s.on("connect",()=>s.write(JSON.stringify({id:"1",op:"health",args:{}})+"\n"));
  s.on("data",d=>{console.log(String(d).trim());s.end()});'
#   期望一行 {"id":"1","ok":true,"data":{"alive":true,...}}

# ⑥ 大脑侧：树落地之后 **在 chown 之前** 装依赖，再重签 manifest。
sudo -u lykoi npm ci --ignore-scripts --prefix /home/lykoi/projects/lykoi-cordis
node /home/lykoi/projects/lykoi-cordis/packages/lykoi-gate/src/cli.ts --write-manifest
node /home/lykoi/projects/lykoi-cordis/packages/lykoi-gate/src/cli.ts   # 期望 exit 0

# ⑦ 起大脑。
systemctl start lykoi-cordis.service
```

验收：审计里出现一条 `browser_organ_wired`；对话面的器官清单块里能看到三个动作；
她走一次 `browser.navigate` 落一条 `browser_action{op,domain,status,chars,duration_ms,truncated}`。

**宿主没起来大脑照常起**：三个动作返回 `browser_host_unreachable`，清单仍列三项。

## 3 · 审批面（不在本器官里）

`browser.navigate` 的**逐域首次审批**由 kernel 既有的 `domain:<eTLD+1>` scope +
对话式审批承担 —— 器官不自带白名单，也不新增任何审批面。拒绝后 24 小时静默期
同样是 kernel 的既有行为。

器官承担的是审批管不到的那一段：**跳转出域即中止**。导航后 `final_url` 的
eTLD+1 与请求不同 → 停止加载、**不读文本**、返回 `redirect_off_domain`，
审计 `browser_redirect_off_domain`。（`www.` 前缀差异不算出域。）

**明示后果**：`research_browser.*` 四项在不可变核的 `AUTONOMOUS_ALLOWED` 里，
autonomous 起源直接放行 —— 她独处 explore 用 `research_browser.read_text` 时
**不逐域问 Kevin**，只受下面四道硬化约束。要改这条属 policy-core，另立单。

## 4 · 四道硬化（全部 fail closed）

这四道全在**用户态**。它们之外还有一道在内核：unit 上的 cgroup BPF 出网闸
（`IPAddressDeny=` / `IPAddressAllow=`），在 `connect()` 那一刻判最终 IP。
为什么需要它、它补的是哪一段，见 §4.1。

1. **SSRF**：只许 `http:`/`https:`、端口 80/443、拒 IP 字面量、拒 `localhost`
   `*.local` `*.internal` `*.home.arpa` 与单标签主机名；`dns.lookup(host,{all:true})`
   的每一个地址逐个判私网/环回/链路本地/组播/保留段（IPv4-mapped、6to4、Teredo
   取内嵌 v4 再判）；解析失败或零地址 = 拒。判定不只在顶层导航 ——
   `context.route('**')` 对**每个子请求**同样判，不过就 abort。
   配了代理照样先判（代理不是豁免）。

   **覆盖不到重定向那一跳**（2026-09-02 复核实测，见下）。
2. **下载隔离**：`acceptDownloads:false`；`download` 事件一律 `cancel()` + 审计
   `browser_download_blocked{url_domain, suggested_name_len}`；`blob:` `data:`
   `file:` `javascript:` 顶层导航拒绝。v1 没有任何文件落到宿主之外。
3. **不可信标记**：所有页面文本进大脑一律带 `untrusted:true`，且 `text` 首行固定
   是 `UNTRUSTED_MARKER`，次行 `url= title=`，第三行起才是正文。位置固定：正文里出现的任何指令都排在标记之后。
4. **文本上限**：`max_chars` 缺省 20000、硬顶 60000（源码常量，配置改不动）；
   超出截断 + `truncated:true`。取 `document.body.innerText`（脚本/样式不入文）
   并折叠空白。

### 4.1 重定向那一跳：用户态拦不住，封口在内核（2026-09-02 复核实测）

**用户态的事实**（playwright-core 1.60.0 + Chrome 152 headless=new，
`test/smoke.test.ts` ⑥⑦ 把它钉成了断言）：Chromium 上 `context.route('**')`
**不为重定向 hop 回调**。一次 `A -302-> B` 只产生一次 route 回调（A 自己，
`redirectedFrom` 为 null）；B 只在只读的 `context.on('request')` 上出现
（`redirectedFrom` = A），那里 abort 不了。子请求（fetch / image / xhr）会回调，
它们各自的 302 目标同样不会。

所以第 1 条里的 SSRF 判定器与第 3 节的出域检查都够不着那一跳：一个 302 就能把
Chrome 领到判定器没看过的地址上。

**v1 的封口：cgroup BPF 防火墙**（unit 里的 `IPAddressDeny=` / `IPAddressAllow=`）。

三道各司其职，别混淆：

| 层 | 位置 | 拦什么 | 拦不住什么 |
|---|---|---|---|
| ① SSRF 判定器 | 用户态，动作入口 + 子请求 | 顶层 URL 与每个子请求 | 重定向 hop |
| ② 出域检查 | 用户态，导航后看 `final_url` | 跳转落到别的注册域 | 拦不住"请求已经发出去了"这件事 |
| ③ cgroup BPF 出网闸 | **内核**，`connect()` 那一刻 | **一切去私网的连接**，与 URL 怎么来的无关 | 去公网的出域跳转（那是 ②的活） |

③ 之所以补得上 ①②：它判的是**最终那个 IP**，在 socket 层。重定向 hop、WebSocket、
Service Worker、Chrome 自己的后台连接、任何子进程，全部一视同仁；DNS rebinding 在这
一层自动失效（判的不是名字）。

**判定顺序与分工**：① 仍是第一道 —— 它拒得早、拒得便宜，而且能给出 `reason`
（`blocked_url` + `private_address`），她因此知道自己撞了什么墙；③ 只会让连接失败，
她看到的是 `timeout`，没有语义。所以两道都要，不是二选一。

**smoke ⑦ 那个案例在生产下的预期**：本机（Mac，无 systemd）实测 —— 直接
`navigate('http://priv.test/…')` 被 ① 拒（`blocked_url`），而**经 302 抵达**的同一个
地址被真的请求到了（P 站实收 `/latest/meta-data/`）。**在服务器的生产 unit 下，
这一次连接的包会被内核丢掉**：`IPAddressDeny=` 是 cgroup skb 过滤，**丢包而不是拒绝**
—— `connect()` 不返回 EPERM，SYN 一直没有回音，直到动作超时。所以动作落的是
`timeout`（不是 `blocked_url` —— 拦它的不是判定器；也不是 `navigation_failed` ——
Chrome 没有收到任何错误，只是等不到）。§2 前验二里 curl 的 rc=28（超时）是同一个签名。

> **LANDING-H 实证（2026-09-03，服务器 Chrome 148）**：§2 前验二 带 Deny rc=28 / 无 Deny rc=0；
> 起服务后 `research_browser.read_text` 打 `https://httpbin.org/redirect-to?url=http://192.168.0.202:7890/`
> 得 `{"ok":false,"error":"timeout"}`；对照直连 `https://httpbin.org/get` 秒回 `ok:true`（unit 内 DNS 与出网可用）；
> journal 无 ip firewall 安装失败行。原稿把预期写成 `navigation_failed`，是没算到丢包语义，已按实测改。
> Mac 上没有 systemd / cgroup，smoke 跑不到内核这一层，倒挂断言钉的仍是"用户态拦不住"。

**为什么不在 Playwright 层堵**：唯一路子是 `route.fetch({ maxRedirects: 0 })` +
`route.fulfill` 自己跟重定向链，那等于把整条导航从 Chrome 的网络栈搬到 Playwright
驱动进程（代理、TLS、cookie 语义全换一套，新栈本身又是一个新的安全面）。属重架构，
归 M5 总盘另立单。内核这一层便宜得多，也牢固得多。

**代码里保留了请求层那道门**（`driver.ts` 的 `#arm`）：零成本，且是 backend 契约的
一部分；Playwright / Chromium 哪天改成逐跳回调，它立刻生效，smoke ⑥⑦ 的倒挂断言会
同时变红提醒。

**出网闸的 fail-open 风险**：`IPAddressDeny=` 装不上时 systemd 只记一条警告、单元
照常启动。所以它不能只写在模板里就算数，必须按 §2 前验验一次、起服务后再看一次日志。

## 5 · 看她在看什么

**截图**：每个动作落一张 PNG 到 `/home/lykoi-browser/data/shots/YYYYMMDD/<ts>-<op>.png`，
返回值里是相对路径。宿主启动时与每小时滚动删除超过 `screenshotRetentionDays`
（缺省 7）的整个日期目录。

```sh
sudo ls -lt /home/lykoi-browser/data/shots/$(date +%Y%m%d) | head
```

**实时画面**（screencast）：MJPEG over HTTP，**只绑 127.0.0.1**。从 Mac：

```sh
ssh -N -L 9223:127.0.0.1:9223 <server>
# 然后浏览器打开 http://127.0.0.1:9223/ （裸流在 /stream）
```

只对持久上下文开画面；一次性调研上下文不出画面。
关掉 = `/etc/lykoi-browser/host.json` 里 `screencast.enabled: false` + 重启宿主。

**审计**：大脑侧每个动作一条 `browser_action{op, domain, status, chars,
duration_ms, truncated}` —— **不落页面文本、不落完整 URL**（只到 eTLD+1）。
宿主侧 journald 里另有 `browser_host_op` 行（同样零正文）。

## 6 · 备份

`/home/lykoi-browser/profile` 进备份集（她的登录态在里面）。

**目前是手工项**：日备份 `/usr/local/sbin/lykoi-cordis-backup.sh` 以 `User=lykoi` 跑，
读不到 700 的 `lykoi-browser` 家目录，所以定时器不会产出它。以下三步要 **root 手工**执行；
纳入日备份需要一个以 root 身份运行的独立定时器，留作 M5 后续。

**先停服务再打包**：

```sh
systemctl stop lykoi-browser.service          # 保持 enabled，不要 disable
tar -C /home/lykoi-browser -czf browser-profile-$(date +%Y%m%dT%H%M%SZ).tar.gz profile
systemctl start lykoi-browser.service
```

运行中的 profile 不是一致快照（Chrome 持续写 LevelDB）。大脑从不读这个目录。
截图目录 `data/` 不备份：可再生，且 7 天自清。

## 7 · 回滚

器官是可摘的：`systemctl stop lykoi-browser.service` 之后大脑侧三个动作立刻变
`browser_host_unreachable`，其余一切照常。要连清单一起摘掉，就在
`profile/cordis.prod.yml` 的 browser 位加 `disabled: true` 并 root 重签 manifest、
重启大脑；那之后器官清单里不再有这三项。

## 8 · 常见故障

| 现象 | 多半是 | 怎么办 |
|---|---|---|
| 每个动作都 `browser_host_unreachable` | 宿主没起 / socket 不在 / 大脑没带 `lykoi-browser` 组 | `systemctl status lykoi-browser`；`ls -l /run/lykoi-browser/host.sock` 期望组 `lykoi-browser`、模式 `0660`；`sudo -u lykoi id -nG` 里要有 `lykoi-browser`（`usermod -aG` 之后大脑进程**必须重启**才带上新组） |
| 宿主起不来，日志 `Cannot find module ... playwright-core` 或 `ENOENT ... host.ts` | 只读 bind 的树没挂上或树不可读 | `systemctl show -p BindReadOnlyPaths lykoi-browser`；`stat -c %a` 看 `/home/lykoi/projects/lykoi-cordis` 一路是否 o+rx；挂载点 `/opt/lykoi-browser/tree` 必须先存在 |
| `busy` | 宿主串行，上一个动作还没结束 | 正常行为，不是故障。等它结束再来；长期频繁说明某个页面卡在超时上限 |
| `blocked_url` | SSRF 判定拒了 | 看审计 `browser_url_blocked.reason`：`private_address` 多半是那个域名解析到内网 |
| `redirect_off_domain` | 目标站 302 去了别的注册域 | 这是设计。要去那个域就让她显式对那个域再走一次审批 |
| `timeout` | 页面加载超过预算 | `host.json` 的 `timeouts`；宿主已自愈（关页/关上下文），不会留僵尸 |
| `no_page` | 还没 navigate 就 get_text，或上一次导航被拦 | 先 navigate |
| 宿主起不来，日志 `ENOENT ... google-chrome` | `executablePath` 不对 | `which google-chrome` 后改 `host.json` |
| 所有外网页面都 `timeout`，私网也一样 | 出网闸把该放的也挡了 —— 多半是 `IPAddressAllow` 写了全网前缀把 Deny 废掉后又改错，或 DNS 存根没放行 | `systemctl show -p IPAddressAllow -p IPAddressDeny lykoi-browser`；`IPAddressAllow` 应当只有 `127.0.0.53/32` 与 `127.0.0.1/32`；开了代理要另加代理那一条 |
| 私网地址经 302 还是连得上 | 出网闸没装上（systemd 只警告不拦，fail open） | `journalctl -u lykoi-browser -b \| grep -i "ip firewall"`；再跑一遍 §2 前验二的两条探针 |
| Chrome 起来就崩 | 家目录权限 / profile 被别的进程占 | 确认 `/home/lykoi-browser/profile` 属主是 `lykoi-browser`；同一 profile 不许两个 Chrome |
