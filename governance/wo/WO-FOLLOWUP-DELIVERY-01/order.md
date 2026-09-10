# WO-FOLLOWUP-DELIVERY-01

Kevin authorized structural repair of the deployed one-shot delayed Telegram follow-up on 2026-09-11. Baseline origin/main d98d426, isolated branch wo/followup-delivery-01. No merge, production write/restart or new Telegram message is implied by repair authorization.

Confirmed trace: the requested user Task was created, waited until due, then requested messenger.read. Its E1 approval message passed kernel but the resource classified reply_to=null as proactive and rejected it at daily_cap. The task remained waiting/approval without a delivery. Private production records stay outside Git.

Scope: retain foreground request provenance and exact receipt time while keeping the delegated goal as execution scope; supply Task with current clock and explicit host-owned completion delivery facts; propagate kernel-validated message budget exemption through the existing resource dispatch boundary; retain ordinary proactive quota and deny rules; expose approval-request delivery failure in persistent task state with existing explicit resume recovery. Kernel change is deliberate and restricted to carrying existing E1/E2/E3 coverage, not adding authority. Review must check spoofed model params, peer-bound E2, denied actions, budget exhaustion, and actual outbound transport.

No regex promise recognizer, hardcoded 60-second timer, permission expansion, polling hack or second scheduling/delivery system. Verify deterministic clock boundaries, restart/exactly-once delivery accounting, real model choosing due/completion from context, and actual BotApiTransport reception on controlled HTTP. Production Telegram acceptance remains distinct.
