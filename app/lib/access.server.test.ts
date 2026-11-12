import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { eq } from "drizzle-orm";

// The database and the cookie are the two things access resolution reads.
// Both are swapped for test doubles; the access rules themselves are real.
const state = vi.hoisted(() => ({
  db: undefined as unknown as ReturnType<
    typeof import("~/test/setup").createTestDb
  >,
  currentUserId: null as number | null,
  country: null as string | null,
}));

vi.mock("~/db", () => ({
  get db() {
    return state.db;
  },
}));

vi.mock("~/lib/session", () => ({
  getCurrentUserId: vi.fn(async () => state.currentUserId),
}));

vi.mock("~/lib/country.server", () => ({
  resolveCountry: vi.fn(async () => state.country),
}));

import {
  getAccess,
  requireAdmin,
  requireContentAccess,
  requireInstructorOrAdmin,
  requireStaff,
  requireUserId,
} from "./access.server";

const request = new Request("http://localhost:3000");

async function expectHttpError(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => {
      throw new Error("expected the call to throw");
    },
    (caught) => caught
  );
  expect(error).toMatchObject({ init: { status } });
  return error as { data: unknown; init: { status: number } };
}

let base: ReturnType<typeof seedBaseData>;
let admin: typeof schema.users.$inferSelect;
let otherInstructor: typeof schema.users.$inferSelect;

function insertUser(
  name: string,
  role: (typeof UserRole)[keyof typeof UserRole]
) {
  return state.db
    .insert(schema.users)
    .values({ name, email: `${name}@example.com`, role })
    .returning()
    .get();
}

function enroll(userId: number, courseId: number) {
  return state.db
    .insert(schema.enrollments)
    .values({ userId, courseId })
    .returning()
    .get();
}

function makeCoursePppEnabled(courseId: number) {
  state.db
    .update(schema.courses)
    .set({ price: 10000, pppEnabled: true })
    .where(eq(schema.courses.id, courseId))
    .run();
}

beforeEach(() => {
  state.db = createTestDb();
  state.currentUserId = null;
  state.country = null;
  base = seedBaseData(state.db);
  admin = insertUser("admin", UserRole.Admin);
  otherInstructor = insertUser("other-instructor", UserRole.Instructor);
});

describe("getAccess", () => {
  it("is signed out with no rights when no one is signed in", async () => {
    const access = await getAccess(request, base.course.id);

    expect(access.userId).toBeNull();
    expect(access.canViewContent).toBe(false);
    expect(access.isStaff).toBe(false);
  });

  it("is signed out when the session points at a user that no longer exists", async () => {
    state.currentUserId = 99999;

    const access = await getAccess(request, base.course.id);

    expect(access.userId).toBeNull();
    expect(access.canViewContent).toBe(false);
  });

  it("gives a Platform Admin staff rights over every course", async () => {
    state.currentUserId = admin.id;

    const access = await getAccess(request, base.course.id);

    expect(access.isAdmin).toBe(true);
    expect(access.isStaff).toBe(true);
    expect(access.isOwningInstructor).toBe(false);
    expect(access.canViewContent).toBe(true);
  });

  it("gives the owning instructor staff rights over their own course only", async () => {
    state.currentUserId = base.instructor.id;

    const own = await getAccess(request, base.course.id);
    expect(own.isOwningInstructor).toBe(true);
    expect(own.isStaff).toBe(true);
    expect(own.canViewContent).toBe(true);

    state.currentUserId = otherInstructor.id;
    const notOwn = await getAccess(request, base.course.id);
    expect(notOwn.isOwningInstructor).toBe(false);
    expect(notOwn.isStaff).toBe(false);
    expect(notOwn.canViewContent).toBe(false);
  });

  it("lets a student read content only once enrolled", async () => {
    state.currentUserId = base.user.id;

    const before = await getAccess(request, base.course.id);
    expect(before.enrolled).toBe(false);
    expect(before.canViewContent).toBe(false);

    enroll(base.user.id, base.course.id);

    const after = await getAccess(request, base.course.id);
    expect(after.enrolled).toBe(true);
    expect(after.canViewContent).toBe(true);
  });

  it("blocks an enrolled student whose discounted purchase is used from another country", async () => {
    makeCoursePppEnabled(base.course.id);
    enroll(base.user.id, base.course.id);
    state.db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 3000,
        country: "IN",
      })
      .run();

    state.currentUserId = base.user.id;
    state.country = "US";

    const access = await getAccess(request, base.course.id);

    expect(access.pppBlocked).toBe(true);
    expect(access.pppBlockedCountry).toBe("US");
    expect(access.pppPurchaseCountry).toBe("IN");
    expect(access.canViewContent).toBe(false);
  });

  it("never applies the PPP block to staff", async () => {
    makeCoursePppEnabled(base.course.id);
    enroll(admin.id, base.course.id);
    state.db
      .insert(schema.purchases)
      .values({
        userId: admin.id,
        courseId: base.course.id,
        amountPaid: 3000,
        country: "IN",
      })
      .run();

    state.currentUserId = admin.id;
    state.country = "US";

    const access = await getAccess(request, base.course.id);

    expect(access.pppBlocked).toBe(false);
    expect(access.canViewContent).toBe(true);
  });
});

describe("requireUserId", () => {
  it("returns the signed-in user's id", async () => {
    state.currentUserId = base.user.id;
    expect(await requireUserId(request)).toBe(base.user.id);
  });

  it("throws 401 when signed out", async () => {
    await expectHttpError(requireUserId(request), 401);
  });
});

describe("requireAdmin", () => {
  it("throws 401 when signed out, without consulting the role", async () => {
    await expectHttpError(requireAdmin(request), 401);
  });

  it("throws 403 for a student", async () => {
    state.currentUserId = base.user.id;
    await expectHttpError(requireAdmin(request), 403);
  });

  it("throws 403 for an instructor, who is not a Platform Admin", async () => {
    state.currentUserId = base.instructor.id;
    await expectHttpError(requireAdmin(request), 403);
  });

  it("returns the admin's user row", async () => {
    state.currentUserId = admin.id;
    const user = await requireAdmin(request);
    expect(user.id).toBe(admin.id);
    expect(user.role).toBe(UserRole.Admin);
  });

  it("uses the caller's message for the 403", async () => {
    state.currentUserId = base.user.id;
    const error = await expectHttpError(
      requireAdmin(request, "Only Platform Admins can review refunds."),
      403
    );
    expect(error.data).toBe("Only Platform Admins can review refunds.");
  });
});

describe("requireInstructorOrAdmin", () => {
  it("lets instructors and admins through", async () => {
    state.currentUserId = base.instructor.id;
    await expect(requireInstructorOrAdmin(request)).resolves.toMatchObject({
      isAdmin: false,
    });

    state.currentUserId = admin.id;
    await expect(requireInstructorOrAdmin(request)).resolves.toMatchObject({
      isAdmin: true,
    });
  });

  it("turns students away with 403", async () => {
    state.currentUserId = base.user.id;
    await expectHttpError(requireInstructorOrAdmin(request), 403);
  });
});

describe("requireContentAccess", () => {
  it("throws 401 when signed out", async () => {
    await expectHttpError(
      requireContentAccess(request, base.course.id),
      401
    );
  });

  it("throws 403 for a signed-in user who is not enrolled", async () => {
    state.currentUserId = base.user.id;
    await expectHttpError(
      requireContentAccess(request, base.course.id),
      403
    );
  });

  it("returns access for an enrolled student", async () => {
    enroll(base.user.id, base.course.id);
    state.currentUserId = base.user.id;

    const access = await requireContentAccess(request, base.course.id);
    expect(access.canViewContent).toBe(true);
  });
});

describe("requireStaff", () => {
  it("throws 401 when signed out", async () => {
    await expectHttpError(requireStaff(request, base.course.id), 401);
  });

  it("throws 403 for an enrolled student", async () => {
    enroll(base.user.id, base.course.id);
    state.currentUserId = base.user.id;
    await expectHttpError(requireStaff(request, base.course.id), 403);
  });

  it("throws 403 for another course's instructor", async () => {
    state.currentUserId = otherInstructor.id;
    await expectHttpError(requireStaff(request, base.course.id), 403);
  });

  it("lets the owning instructor and admins through", async () => {
    state.currentUserId = base.instructor.id;
    await expect(requireStaff(request, base.course.id)).resolves.toMatchObject(
      { isOwningInstructor: true }
    );

    state.currentUserId = admin.id;
    await expect(requireStaff(request, base.course.id)).resolves.toMatchObject(
      { isAdmin: true }
    );
  });
});
