# WO-E4-4 · 部署事实接续交付

状态：实现及本地验证完成，分支 `wo/e4-4`，基线 `6a705ee`。未合并、未部署，独立治理复核待交付阶段。

## 修正与结果

旧order把生产profile的Telegram代理写成browser proxy，真实消费者是 adapter/production。现改为 `proxy: instance` + 同一 personaToml 路径，读取实例包 `deploy.toml` 的 `[telegram].proxy`；浏览器独立host JSON保持原职责。

实例加载器新增 `deploy.telegram_proxy`，deploy文件可选；选择instance代理时缺文件/缺值/空值/损坏/错误表名/非HTTP(S) URL均拒起。配置不是instance时原值不变，空串显式直连也不读取部署文件。解析错误不带原始配置值。没有新增环境变量。

模板内代理主机改为 `<BROWSER_PROXY_HOST>`；文档地址改为192.0.2.10并明确示例属性。`git grep '192.168.0.202' -- ':!governance'` 为零。布局约定与README仓库链接保持原样。

## 完整性缺口同步收束

E4-2 report 已指出 seeds.toml 未纳入manifest。若把原root签署的proxy迁到未钉住的deploy文件，就会削弱已有保证，因此本单同时处理：`instancePackageFiles()` 是manifest与属主/不可写检查的共同文件表；persona必选，存在的seeds/deploy纳入root域。

新增未签署文件、篡改、删除已签署文件、可写权限均有红例；重新签署恢复绿。不改surface/ENV_PINS/policy-core，不把活规则纳入manifest。本修订已写入order并告知E4-5不重复处理。

## 验证与改动面

`npm run typecheck`、`git diff --check`通过；最终完整 `npm test` 退出0：**1207 tests / 1196 pass / 0 fail / 11 skipped**。新增proxy三例、gate一组完整红绿例；旧实例加载和完整性检查回归通过。

改动：decide/instance、adapter/production及其package声明、gate/manifest/verify、生产profile、browser模板、两份docs、对应测试和本单order/report。manifest域涉及4个src、1个profile及package/lock锚。只新增对现有workspace lykoi-decide的显式依赖，无新外部依赖；prompt/schema不变。

## 给 Kevin 的落地前置

1. 先停稳单写者并按整批步骤备份。将现有真实Telegram代理值写入 `/home/lykoi/runtime/persona/deploy.toml` 的 `[telegram]` 表、`proxy` 键；不要把文档示例地址照抄到生产，也不要把实际值贴入工单。
2. 文件 `root:root`、0444，实例目录0755；可选seeds.toml同法。确认存在deploy.toml且实例解析得到非空代理之后，才能进行manifest签署。不是把浏览器代理写入此文件。
3. 安装依赖并重新签署、执行完整gate，才可启动；检查实际poll连接及真实入站。已有seeds文件也会新增清单项，必须按当前树重新生成manifest。
4. 回滚时保留实例文件并用回滚树重新计算自己的清单，不能把新增文件误当成待删除数据。当前交付没有读取生产值、签署生产manifest、改权限或重启服务。

具体服务器命令在整批落地包汇总，避免各单重复操作同一进程。
