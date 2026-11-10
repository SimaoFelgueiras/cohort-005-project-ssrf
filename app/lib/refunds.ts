/**
 * Refund Eligibility, as defined in GLOSSARY.md. This module holds only the
 * rules; the database lookups that gather the facts live in
 * refunds.server.ts.
 */

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;
export const REFUND_COMPLETION_LIMIT = 0.5;

export type RefundIneligibleReason =
  | "refund-already-requested"
  | "claimed-team-seat"
  | "window-closed"
  | "watched-too-much"
  | "completed-too-much";

export type RefundEligibility =
  | { eligible: true; refundAmount: number; lastDayInWindow: string }
  | { eligible: false; reason: RefundIneligibleReason };

export interface RefundFacts {
  purchasedAt: string;
  amountPaid: number;
  hasRequestedRefund: boolean;
  isClaimedTeamSeat: boolean;
  secondsWatched: number;
  completedLessonCount: number;
  lessonCount: number;
}

// The Refund Window is counted in whole calendar days, not hours — someone
// who buys at 23:00 still gets the whole of their fourteenth day.
export function calendarDay(when: Date): string {
  const year = when.getFullYear();
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function lastDayInRefundWindow(purchasedAt: string): string {
  const deadline = new Date(purchasedAt);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  return calendarDay(deadline);
}

export function assessRefundEligibility(
  facts: RefundFacts,
  now: Date
): RefundEligibility {
  if (facts.hasRequestedRefund) {
    return { eligible: false, reason: "refund-already-requested" };
  }

  if (facts.isClaimedTeamSeat) {
    return { eligible: false, reason: "claimed-team-seat" };
  }

  const today = calendarDay(now);
  const lastDayInWindow = lastDayInRefundWindow(facts.purchasedAt);
  const purchasedDay = calendarDay(new Date(facts.purchasedAt));

  if (today < purchasedDay || today > lastDayInWindow) {
    return { eligible: false, reason: "window-closed" };
  }

  if (facts.secondsWatched >= REFUND_WATCH_LIMIT_SECONDS) {
    return { eligible: false, reason: "watched-too-much" };
  }

  if (
    facts.lessonCount > 0 &&
    facts.completedLessonCount / facts.lessonCount >= REFUND_COMPLETION_LIMIT
  ) {
    return { eligible: false, reason: "completed-too-much" };
  }

  // The Refund Amount is always what the learner was charged, never the
  // course's current list price.
  return { eligible: true, refundAmount: facts.amountPaid, lastDayInWindow };
}
