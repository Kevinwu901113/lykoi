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

### 4.1 已知缺口：重定向的那一跳拦不住（2026-09-02 复核实测）

**现象**（playwright-core 1.60.0 + Chrome 152 headless=new，`test/smoke.test.ts` ⑥⑦
把它钉成了断言）：Chromium 上 `context.route('**')` **不为重定向 hop 回调**。
一次 `A -302-> B` 只产生一次 route 回调（A 自己，`redirectedFrom` 为 null）；B 只在
只读的 `context.on('request')` 上出现（`redirectedFrom` = A），那里 abort 不了。
子请求（fetch / image / xhr）会回调，它们各自的 302 目标同样不会。

**后果**（两条，都已实测复现）：

- **出域跳转**：`redirect_off_domain` 实际由导航后的 `final_url` 检查拦下，不是由
  请求层。她读不到跳转目标的文本，但那个页面**已经被持久 profile 请求过一次** ——
  cookie 发出去了，页面 JS 跑过了。
- **SSRF**：直接导航到私网地址会被判定器拒；**经 302 抵达**的同一个地址不会 ——
  那一跳到不了判定器。响应回不到她手里（最终仍判出域），但请求确实发出去了。

**没有在本单堵上的原因**：唯一可行的堵法是 `route.fetch({maxRedirects:0})` +
`route.fulfill` 自己跟重定向链，那等于把整条导航从 Chrome 的网络栈搬到 Playwright
驱动进程里（代理、TLS、cookie 语义全换一套）。属重架构，归 M5 总盘另立单。

**代码里保留了请求层那道门**（`driver.ts` 的 `#arm`）：零成本，且是 backend 契约的
一部分；Playwright / Chromium 哪天改成逐跳回调，它立刻生效，smoke ⑥⑦ 的倒挂断言会
同时变红提醒。

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
| Chrome 起来就崩 | 家目录权限 / profile 被别的进程占 | 确认 `/home/lykoi-browser/profile` 属主是 `lykoi-browser`；同一 profile 不许两个 Chrome |
