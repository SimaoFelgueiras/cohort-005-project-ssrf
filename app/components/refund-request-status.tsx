import { RefundStatus } from "~/db/schema";
import { cn, formatPrice } from "~/lib/utils";

export interface LearnerRefundRequest {
  status: string;
  requestedAt: string;
  resolvedAt: string | null;
  amountRefunded: number | null;
  decisionNote: string | null;
}

const badgeStyles: Record<string, { label: string; className: string }> = {
  [RefundStatus.Open]: {
    label: "Open",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  [RefundStatus.Approved]: {
    label: "Approved",
    className:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  [RefundStatus.Declined]: {
    label: "Declined",
    className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function RefundStatusBadge({ status }: { status: string }) {
  const style = badgeStyles[status];
  if (!style) return null;

  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
        style.className
      )}
    >
      {style.label}
    </span>
  );
}

/** One line telling the learner where their Refund Request stands. */
export function RefundOutcome({
  refundRequest,
}: {
  refundRequest: LearnerRefundRequest;
}) {
  const decidedOn = refundRequest.resolvedAt
    ? ` on ${formatDate(refundRequest.resolvedAt)}`
    : "";

  switch (refundRequest.status) {
    case RefundStatus.Approved:
      return (
        <p className="text-sm">
          Refunded{decidedOn}: {formatPrice(refundRequest.amountRefunded)} is
          on its way back to you. You no longer have access to this course.
        </p>
      );
    case RefundStatus.Declined:
      return (
        <div className="text-sm">
          <p>Your refund request was declined{decidedOn}.</p>
          {refundRequest.decisionNote && (
            <p className="mt-1 text-muted-foreground">
              Our reason: {refundRequest.decisionNote}
            </p>
          )}
        </div>
      );
    default:
      return (
        <p className="text-sm text-muted-foreground">
          Refund request sent {formatDate(refundRequest.requestedAt)}. We are
          reviewing it and will email you when it is decided.
        </p>
      );
  }
}
