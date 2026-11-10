import { useEffect, useState } from "react";
import { data, isRouteErrorResponse, Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { AlertTriangle, Check, X } from "lucide-react";
import type { Route } from "./+types/admin.refund-requests";
import { db } from "~/db";
import { RefundStatus, UserRole, users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { cn, formatPrice } from "~/lib/utils";
import {
  DECISION_NOTE_MIN_LENGTH,
  REFUND_COMPLETION_LIMIT,
  REFUND_WATCH_LIMIT_SECONDS,
  type RefundDecisionRefusal,
} from "~/lib/refunds";
import {
  countOpenRefundRequests,
  listRefundRequests,
  resolveRefundRequest,
} from "~/lib/refunds.server";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";

const decisionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("approve"),
    refundRequestId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("decline"),
    refundRequestId: z.coerce.number().int(),
    note: z
      .string()
      .trim()
      .min(
        DECISION_NOTE_MIN_LENGTH,
        "Tell the learner why their refund request was declined."
      )
      .max(1000, "Please keep the reason under 1000 characters."),
  }),
]);

const refusalMessages: Record<RefundDecisionRefusal | "not-found", string> = {
  "already-decided": "This refund request has already been decided.",
  "note-required": "Tell the learner why their refund request was declined.",
  "not-found": "Refund request not found.",
};

const tabs = [
  { status: RefundStatus.Open, label: "Open" },
  { status: RefundStatus.Approved, label: "Approved" },
  { status: RefundStatus.Declined, label: "Declined" },
] as const;

// Only Admins decide Refund Requests — a course's own instructor cannot.
async function requireAdmin(request: Request) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can review refund requests.", { status: 403 });
  }

  return currentUser;
}

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Approve or decline refund requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);

  const statusParam = new URL(request.url).searchParams.get("status");
  const status =
    tabs.find((tab) => tab.status === statusParam)?.status ?? RefundStatus.Open;

  return {
    status,
    refundRequests: listRefundRequests(status),
    openCount: countOpenRefundRequests(),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, decisionSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  const decision =
    parsed.data.intent === "approve"
      ? { kind: "approve" as const }
      : { kind: "decline" as const, note: parsed.data.note };

  const result = resolveRefundRequest(
    parsed.data.refundRequestId,
    admin.id,
    decision
  );

  if (!result.ok) {
    return data(
      { error: refusalMessages[result.reason] },
      { status: result.reason === "not-found" ? 404 : 409 }
    );
  }

  return { success: true as const, status: result.status };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

type RefundRequestRow = Route.ComponentProps["loaderData"]["refundRequests"][number];

function Progress({ progress }: { progress: RefundRequestRow["progress"] }) {
  const watchedTooMuch = progress.secondsWatched >= REFUND_WATCH_LIMIT_SECONDS;
  const completedTooMuch =
    progress.lessonCount > 0 &&
    progress.completedLessonCount / progress.lessonCount >=
      REFUND_COMPLETION_LIMIT;

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      <span className={cn(watchedTooMuch && "font-medium text-amber-600")}>
        Watched {formatDuration(progress.secondsWatched)}
      </span>
      <span className={cn(completedTooMuch && "font-medium text-amber-600")}>
        Completed {progress.completedLessonCount} of {progress.lessonCount}{" "}
        lessons
      </span>
    </div>
  );
}

function DecisionControls({ refundRequest }: { refundRequest: RefundRequestRow }) {
  const fetcher = useFetcher<typeof action>();
  const [isDeclining, setIsDeclining] = useState(false);
  const [note, setNote] = useState("");
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if ("error" in fetcher.data) {
      toast.error(fetcher.data.error);
    } else if (fetcher.data.status === "approved") {
      toast.success(
        `Refund of ${formatPrice(refundRequest.amountPaid)} owed to ${refundRequest.learnerName}.`
      );
    } else {
      toast.success("Refund request declined.");
    }
  }, [fetcher.state, fetcher.data]);

  function approve() {
    const confirmed = window.confirm(
      `Approve a refund of ${formatPrice(refundRequest.amountPaid)} to ${refundRequest.learnerName}? They will lose access to "${refundRequest.courseTitle}". This cannot be undone.`
    );
    if (!confirmed) return;
    fetcher.submit(
      { intent: "approve", refundRequestId: String(refundRequest.id) },
      { method: "post" }
    );
  }

  function decline() {
    fetcher.submit(
      {
        intent: "decline",
        refundRequestId: String(refundRequest.id),
        note,
      },
      { method: "post" }
    );
  }

  if (isDeclining) {
    return (
      <div className="space-y-2">
        <label
          htmlFor={`note-${refundRequest.id}`}
          className="text-sm font-medium"
        >
          Why are you declining? The learner will see this.
        </label>
        <Textarea
          id={`note-${refundRequest.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          autoFocus
        />
        <div className="flex gap-2">
          <Button
            variant="destructive"
            size="sm"
            onClick={decline}
            disabled={
              isSubmitting || note.trim().length < DECISION_NOTE_MIN_LENGTH
            }
          >
            {isSubmitting ? "Declining..." : "Decline refund request"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsDeclining(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={approve} disabled={isSubmitting}>
        <Check className="size-4" />
        {isSubmitting ? "Approving..." : `Approve ${formatPrice(refundRequest.amountPaid)}`}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsDeclining(true)}
        disabled={isSubmitting}
      >
        <X className="size-4" />
        Decline
      </Button>
    </div>
  );
}

function RefundRequestCard({ refundRequest }: { refundRequest: RefundRequestRow }) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-medium">
              {refundRequest.learnerName}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                {refundRequest.learnerEmail}
              </span>
            </p>
            <Link
              to={`/courses/${refundRequest.courseSlug}`}
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              {refundRequest.courseTitle}
            </Link>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">
              Paid {formatPrice(refundRequest.amountPaid)}
            </p>
            <p className="text-muted-foreground">
              Bought {formatDate(refundRequest.purchasedAt)} · asked{" "}
              {formatDate(refundRequest.requestedAt)}
            </p>
          </div>
        </div>

        <blockquote className="border-l-2 border-border pl-3 text-sm italic">
          {refundRequest.reason}
        </blockquote>

        <Progress progress={refundRequest.progress} />

        {refundRequest.status === RefundStatus.Open ? (
          <DecisionControls refundRequest={refundRequest} />
        ) : (
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            {refundRequest.status === RefundStatus.Approved ? (
              <p>
                Refund of {formatPrice(refundRequest.amountRefunded)} owed —
                approved
              </p>
            ) : (
              <p>Declined: {refundRequest.decisionNote}</p>
            )}
            <p className="mt-1 text-muted-foreground">
              by {refundRequest.resolverName ?? "unknown"}
              {refundRequest.resolvedAt &&
                ` on ${formatDate(refundRequest.resolvedAt)}`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminRefundRequests({
  loaderData,
}: Route.ComponentProps) {
  const { status, refundRequests, openCount } = loaderData;

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Approve or decline what learners have asked for. Decisions are final.
        </p>
      </div>

      <div className="mb-6 flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <Link
            key={tab.status}
            to={`?status=${tab.status}`}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
              tab.status === status
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.status === RefundStatus.Open && openCount > 0 && (
              <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                {openCount}
              </span>
            )}
          </Link>
        ))}
      </div>

      {refundRequests.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">
          {status === RefundStatus.Open
            ? "No open refund requests."
            : `No ${status} refund requests yet.`}
        </p>
      ) : (
        <div className="space-y-4">
          {refundRequests.map((refundRequest) => (
            <RefundRequestCard
              key={refundRequest.id}
              refundRequest={refundRequest}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading refund requests.";

  if (isRouteErrorResponse(error)) {
    title = error.status === 403 ? "Access denied" : `Error ${error.status}`;
    message = typeof error.data === "string" ? error.data : message;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
