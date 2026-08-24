/**
 * 策略豁免标记 —— **re-export of lykoi-kernel/exemption**。
 *
 * M2 时本文件是接口位真身（kernel 未生）；M3-W1 kernel 落地后实现迁入
 * lykoi-kernel/src/exemption.ts —— 消费位（approval.check 第⑨步，SK-47/48）
 * 与类型必须同居一模块，covers 的 instanceof 判定才有唯一的类身份。本文件
 * 保持原路 re-export，既有 import 面（'lykoi-converse' 的 exemption 出口）
 * 一字不变 —— 与活体 kernel/redaction.py re-export shared 同一手法。
 */
export {
  approvalMachinery,
  covers,
  EXEMPT_ACTION_TYPES,
  Exemption,
  inPresenceReply,
  label,
  upstreamBudgetedDelivery,
  type ExemptionCategory,
} from 'lykoi-kernel'
