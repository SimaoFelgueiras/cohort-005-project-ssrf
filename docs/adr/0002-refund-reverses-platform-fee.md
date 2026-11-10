---
status: accepted
---

# An approved Refund reverses the whole sale, including the platform fee

When an Admin approves a Refund Request, the sale is undone for both sides: the Refund Amount comes off the Purchase's gross revenue, and the 20% platform fee and the instructor's net are recalculated from what remains. The platform gives back its fee along with the instructor's share. We chose this because the learner gets back everything they paid, and keeping the fee would make the platform profit from money it returned to the learner.

## Considered Options

- **Reverse the whole sale** (chosen). Net is `splitRevenue(gross − refunded)`, so the fee falls with the sale. Reports show gross, refunded, platform fee and net, and all four agree.
- **The platform keeps its fee.** Rejected: the instructor's net drops by the full amount, but the platform would keep 20% of money it returned to the learner. Its fee would then be income on a sale that never completed.

## Consequences

- **Platform revenue drops after a refund.** Fee income for a period goes down when a Refund is approved for a Purchase in that period.
- **The instructor's net and the platform fee move together.** Anyone reconciling the two sees the same change on both sides.
- **Refunds reduce gross at the Purchase's date, not at approval.** This follows ADR 0001.
