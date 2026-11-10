---
status: accepted
---

# Approving a Refund hard-deletes the Enrollment but keeps progress

When an Admin approves a Refund Request, the learner loses the course by having their Enrollment row deleted outright. Their lesson progress, watch history and quiz attempts are left untouched: those are keyed by learner and lesson, not by Enrollment, so they were never part of it. We chose a hard delete because an Enrollment means "has the course right now", and the history of what happened already lives in the Purchase and the Approved Refund Request.

## Considered Options

- **Hard-delete the Enrollment** (chosen). One delete, and access is gone everywhere, because every page that asks "can they see this course?" asks whether an Enrollment exists. Only `enrolledAt` and `completedAt` are lost, not progress.
- **Soft-delete the Enrollment** (a `revokedAt` column). Rejected: around fourteen places query enrollments, and each would need a "not revoked" filter. One missed filter quietly hands a refunded learner the course back. Buying again would also have to un-revoke the old row instead of creating a new one.
- **Retain the Enrollment for N days.** Rejected: a grace period exists to allow an undo, but an Approved Refund Request is final. It would also need a scheduled cleanup job, and the app has no scheduler.

## Consequences

- **Progress comes back if the learner buys again.** A new Purchase creates a new Enrollment, and the old lesson progress shows up again.
- **Earlier watching counts against a later Purchase.** Refund Eligibility adds up everything the learner has watched and completed in the course, including before an earlier Refund. This is deliberate: otherwise a learner could buy, watch, refund and repeat, and get the whole course for free. Do not "fix" it by counting from the latest Purchase only.
- **Refunded learners leave enrollment counts after the fact.** They disappear from the instructor's student list, and analytics that count by `enrolledAt` drop them, so past numbers can shrink. Historical sales figures should come from Purchases, not Enrollments.
- **Lists of courses only include Enrollments.** The "Recent courses" sidebar is built from progress joined to Enrollments, so a refunded course drops off it even though its progress is kept.
- **Revenue follows the same rule.** Approved Refunds are subtracted from the Purchase they belong to, on the day it was bought, in every revenue panel. Past numbers can shrink after a refund, the same as enrollment counts. The fee treatment is recorded in ADR 0002.
