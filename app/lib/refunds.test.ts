import { describe, it, expect } from "vitest";
import {
  assessRefundEligibility,
  REFUND_WATCH_LIMIT_SECONDS,
  type RefundFacts,
} from "./refunds";

const purchasedAt = new Date(2026, 10, 1, 23, 0).toISOString();

const eligibleFacts: RefundFacts = {
  purchasedAt,
  amountPaid: 7900,
  hasOpenRefundRequest: false,
  isClaimedTeamSeat: false,
  secondsWatched: 0,
  completedLessonCount: 0,
  lessonCount: 10,
};

const dayOfWindow = (day: number) => new Date(2026, 10, 1 + day, 12, 0);

describe("assessRefundEligibility", () => {
  it("offers the Amount Paid as the Refund Amount", () => {
    expect(assessRefundEligibility(eligibleFacts, dayOfWindow(3))).toEqual({
      eligible: true,
      refundAmount: 7900,
      lastDayInWindow: "2026-11-15",
    });
  });

  it("keeps the Refund Window open through its fourteenth calendar day", () => {
    expect(
      assessRefundEligibility(eligibleFacts, dayOfWindow(14)).eligible
    ).toBe(true);
  });

  it("closes the Refund Window on the fifteenth day", () => {
    expect(assessRefundEligibility(eligibleFacts, dayOfWindow(15))).toEqual({
      eligible: false,
      reason: "window-closed",
    });
  });

  it("refuses when a Refund Request is already Open", () => {
    expect(
      assessRefundEligibility(
        { ...eligibleFacts, hasOpenRefundRequest: true },
        dayOfWindow(1)
      )
    ).toEqual({ eligible: false, reason: "open-refund-request" });
  });

  it("refuses a claimed Team Seat", () => {
    expect(
      assessRefundEligibility(
        { ...eligibleFacts, isClaimedTeamSeat: true },
        dayOfWindow(1)
      )
    ).toEqual({ eligible: false, reason: "claimed-team-seat" });
  });

  it("refuses once two hours have been watched", () => {
    expect(
      assessRefundEligibility(
        { ...eligibleFacts, secondsWatched: REFUND_WATCH_LIMIT_SECONDS },
        dayOfWindow(1)
      )
    ).toEqual({ eligible: false, reason: "watched-too-much" });
  });

  it("refuses once half of the lessons are completed", () => {
    expect(
      assessRefundEligibility(
        { ...eligibleFacts, completedLessonCount: 5 },
        dayOfWindow(1)
      )
    ).toEqual({ eligible: false, reason: "completed-too-much" });
  });

  it("allows a refund when just under half of the lessons are completed", () => {
    expect(
      assessRefundEligibility(
        { ...eligibleFacts, completedLessonCount: 4 },
        dayOfWindow(1)
      ).eligible
    ).toBe(true);
  });

  it("ignores the completion limit for a course with no lessons", () => {
    expect(
      assessRefundEligibility(
        { ...eligibleFacts, lessonCount: 0 },
        dayOfWindow(1)
      ).eligible
    ).toBe(true);
  });
});
