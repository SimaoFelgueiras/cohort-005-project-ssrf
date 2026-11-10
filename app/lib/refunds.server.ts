import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "~/db";
import {
  coupons,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  purchases,
  refunds,
  users,
  videoWatchEvents,
  LessonProgressStatus,
  RefundStatus,
} from "~/db/schema";
import {
  assessRefundEligibility,
  decideRefundRequest,
  type RefundDecision,
  type RefundDecisionRefusal,
  type RefundEligibility,
} from "./refunds";
import { formatPrice } from "./utils";

export function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

function hasRefundRequestWithStatus(purchaseId: number, status: RefundStatus) {
  const row = db
    .select({ id: refunds.id })
    .from(refunds)
    .where(and(eq(refunds.purchaseId, purchaseId), eq(refunds.status, status)))
    .get();

  return row !== undefined;
}

// A seat that came out of a team licence, and has been claimed, belongs to
// the team — the learner cannot hand it back on their own.
function isClaimedTeamSeat(purchaseId: number) {
  const row = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt))
    )
    .get();

  return row !== undefined;
}

function getLessonIdsForCourse(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function getCompletedLessonCount(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return result?.count ?? 0;
}

function getSecondsWatched(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  return db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all()
    .reduce((total, row) => total + row.furthest, 0);
}

/**
 * Refund Eligibility of a Purchase, looked up from the database. The course
 * page and the refund action both call this so they can never disagree.
 */
export function getRefundEligibility(
  userId: number,
  purchase: { id: number; courseId: number; amountPaid: number; createdAt: string },
  now: Date = new Date()
): RefundEligibility {
  const lessonIds = getLessonIdsForCourse(purchase.courseId);

  return assessRefundEligibility(
    {
      purchasedAt: purchase.createdAt,
      amountPaid: purchase.amountPaid,
      hasOpenRefundRequest: hasRefundRequestWithStatus(
        purchase.id,
        RefundStatus.Open
      ),
      hasApprovedRefundRequest: hasRefundRequestWithStatus(
        purchase.id,
        RefundStatus.Approved
      ),
      isClaimedTeamSeat: isClaimedTeamSeat(purchase.id),
      secondsWatched: getSecondsWatched(userId, lessonIds),
      completedLessonCount: getCompletedLessonCount(userId, lessonIds),
      lessonCount: lessonIds.length,
    },
    now
  );
}

// ─── The learner's side: what happened to their Refund Requests ───

const learnerRefundRequestColumns = {
  id: refunds.id,
  status: refunds.status,
  reason: refunds.reason,
  requestedAt: refunds.requestedAt,
  resolvedAt: refunds.resolvedAt,
  amountRefunded: refunds.amountRefunded,
  decisionNote: refunds.decisionNote,
};

/**
 * The most recent Refund Request on a Purchase, in any state, or undefined
 * when the learner never asked.
 */
export function getLatestRefundRequest(purchaseId: number) {
  return db
    .select(learnerRefundRequestColumns)
    .from(refunds)
    .where(eq(refunds.purchaseId, purchaseId))
    .orderBy(desc(refunds.requestedAt), desc(refunds.id))
    .get();
}

/** Every Refund Request a learner has made, newest first. */
export function listLearnerRefundRequests(userId: number) {
  return db
    .select({
      ...learnerRefundRequestColumns,
      amountPaid: purchases.amountPaid,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(purchases.userId, userId))
    .orderBy(desc(refunds.requestedAt), desc(refunds.id))
    .all();
}

// ─── The admin's side: reviewing and deciding Refund Requests ───

/**
 * How far into the course the learner is right now. Shown next to a Refund
 * Request for context only — it never blocks an Admin's decision.
 */
export function getLearnerProgress(userId: number, courseId: number) {
  const lessonIds = getLessonIdsForCourse(courseId);
  return {
    secondsWatched: getSecondsWatched(userId, lessonIds),
    completedLessonCount: getCompletedLessonCount(userId, lessonIds),
    lessonCount: lessonIds.length,
  };
}

/**
 * Refund Requests with the given status. Open ones come oldest first, so the
 * longest-waiting learner is at the top; decided ones newest-decided first.
 */
export function listRefundRequests(status: RefundStatus) {
  const learner = alias(users, "learner");
  const resolver = alias(users, "resolver");

  const rows = db
    .select({
      id: refunds.id,
      status: refunds.status,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      resolvedAt: refunds.resolvedAt,
      amountRefunded: refunds.amountRefunded,
      decisionNote: refunds.decisionNote,
      resolverName: resolver.name,
      purchasedAt: purchases.createdAt,
      amountPaid: purchases.amountPaid,
      learnerId: learner.id,
      learnerName: learner.name,
      learnerEmail: learner.email,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(learner, eq(purchases.userId, learner.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(resolver, eq(refunds.resolvedByUserId, resolver.id))
    .where(eq(refunds.status, status))
    .orderBy(
      status === RefundStatus.Open
        ? asc(refunds.requestedAt)
        : desc(refunds.resolvedAt)
    )
    .all();

  return rows.map((row) => ({
    ...row,
    progress: getLearnerProgress(row.learnerId, row.courseId),
  }));
}

export function countOpenRefundRequests() {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(refunds)
    .where(eq(refunds.status, RefundStatus.Open))
    .get();
  return row?.count ?? 0;
}

/**
 * The email the learner gets once an Admin decides. There is no mail
 * transport yet, so it goes to the server log like the request email.
 */
function buildRefundDecisionEmail(input: {
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  status: "approved" | "declined";
  amountRefunded: number | null;
  decisionNote: string | null;
}) {
  const body =
    input.status === "approved"
      ? [
          `We have approved your refund request for "${input.courseTitle}".`,
          `We will return ${formatPrice(input.amountRefunded)}, the amount you paid. You no longer have access to the course.`,
        ]
      : [
          `We have declined your refund request for "${input.courseTitle}".`,
          "",
          `Our reason: ${input.decisionNote}`,
          "",
          "You keep full access to the course.",
        ];

  return {
    to: input.learnerEmail,
    subject: `Refund ${input.status} — ${input.courseTitle}`,
    body: [`Hi ${input.learnerName},`, "", ...body, "", "— The Cadence team"].join(
      "\n"
    ),
  };
}

export type ResolveRefundRequestResult =
  | { ok: true; status: "approved" | "declined" }
  | { ok: false; reason: RefundDecisionRefusal | "not-found" };

/**
 * Records an Admin's decision on a Refund Request. Approving also takes the
 * course away from the learner: a refunded Purchase no longer grants it.
 */
export function resolveRefundRequest(
  refundRequestId: number,
  adminUserId: number,
  decision: RefundDecision,
  now: Date = new Date()
): ResolveRefundRequestResult {
  const result = db.transaction((tx) => {
    const request = tx
      .select({
        status: refunds.status,
        amountPaid: purchases.amountPaid,
        learnerId: purchases.userId,
        courseId: purchases.courseId,
      })
      .from(refunds)
      .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
      .where(eq(refunds.id, refundRequestId))
      .get();

    if (!request) return { ok: false as const, reason: "not-found" as const };

    const outcome = decideRefundRequest(request, decision);
    if (!outcome.ok) return outcome;

    const updated = tx
      .update(refunds)
      .set({
        status:
          outcome.status === "approved"
            ? RefundStatus.Approved
            : RefundStatus.Declined,
        amountRefunded: outcome.amountRefunded,
        decisionNote: outcome.decisionNote,
        resolvedAt: now.toISOString(),
        resolvedByUserId: adminUserId,
      })
      // Guard against two admins deciding the same request at once.
      .where(
        and(eq(refunds.id, refundRequestId), eq(refunds.status, RefundStatus.Open))
      )
      .run();

    if (updated.changes === 0) {
      return { ok: false as const, reason: "already-decided" as const };
    }

    if (outcome.status === "approved") {
      tx.delete(enrollments)
        .where(
          and(
            eq(enrollments.userId, request.learnerId),
            eq(enrollments.courseId, request.courseId)
          )
        )
        .run();
    }

    return {
      ...outcome,
      learnerId: request.learnerId,
      courseId: request.courseId,
    };
  });

  if (!result.ok) return result;

  const learner = db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, result.learnerId))
    .get();
  const course = db
    .select({ title: courses.title })
    .from(courses)
    .where(eq(courses.id, result.courseId))
    .get();

  if (learner && course) {
    const email = buildRefundDecisionEmail({
      learnerName: learner.name,
      learnerEmail: learner.email,
      courseTitle: course.title,
      status: result.status,
      amountRefunded: result.amountRefunded,
      decisionNote: result.decisionNote,
    });
    console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);
  }

  return { ok: true, status: result.status };
}
