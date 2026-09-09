# 清理范围与保留理由

| 项目 | 处理 |
| --- | --- |
| 学习层截取 JSON、provider recovery 重叠 | 删除截取修复；Integration/Focus 请求 JSON，由 lykoi-llm 唯一恢复 |
| 非法 concern weight、assessment pull、thought charge_hint | 删除字符串强转、夹值与坏值默认；缺省可选 hint 的初始值保持产品约定 |
| thought 写入异常伪装容量拒绝 | 删除广域 catch；真实容量不足仍返回明确拒绝 |
| focus 坏输出改成 no_progress、最终写入失败、建议血缘失败假成功 | 明确传播失败；已入队建议保留 ID，不重放已发生写入 |
| 缺 transport 的成功替身 | 从生产入口删除；显式 archive transport 只供测试 |
| token／主动开口／未送达账本清空、损坏游标跳过待发项 | 删除恢复正常的假象，保留损坏字节并报错 |
| Python repr/舍入模拟、prompt SHA、固定 import 数量、历史注释钉死 | 删除；保留当前拒绝、身份注入和数值精度测试 |
| 审批权限、审计、发送歧义、真实预算、持久化格式、数据迁移 | 保留：真实信任边界、不可逆副作用或已有数据契约 |
| 语义重述、缓存读取失败、遥测失败隔离 | 按用途保留：不重放已提交操作，不由框架改成角色选择 |

历史源码与被退休断言可从 [清理前基线 9beca13](https://github.com/Kevinwu901113/lykoi/tree/9beca13/packages) 恢复，不复制全量历史注释和机器清单。

P0 以减负为验收范围。服务重新分层、Character Instance、统一 Cognition、Task/Resolver、能力扩展属于后续工程；路线是当前规划，不能作为永久实现不变量。
