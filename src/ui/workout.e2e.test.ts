import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import {
  chromium,
  expect as browserExpect,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/supabase", () => ({
  getSupabaseIdentityProvider: async () => ({
    currentIdentity: async () => (loggedIn ? { id: userId } : null),
  }),
  getSupabaseAuthClient: async () => ({
    auth: {
      signInWithPassword: async ({ password }: { password: string }) => {
        if (password !== "pilot-password")
          return { error: new Error("invalid") };
        loggedIn = true;
        return { error: null };
      },
      signOut: async () => {
        loggedIn = false;
        return { error: null };
      },
    },
  }),
}));
vi.mock("@/server/training/application", () => ({
  getPlanningApplication: () => db.app,
}));
vi.mock("@/server/training/workout-application", () => ({
  getWorkoutApplication: () => db.workouts,
}));
vi.mock("@/server/training/execution-application", () => ({
  getExecutionApplication: () => db.execution,
}));
vi.mock("@/server/training/correction-application", () => ({
  getCorrectionApplication: () => db.corrections,
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabaseReadinessGateway: () => ({
    check: async () => {
      await db.postgres.query("SELECT 1");
    },
  }),
}));
import { planningDatabase } from "@/test/planning-database";
import * as authLogin from "@/app/api/auth/login/route";
import * as authLogout from "@/app/api/auth/logout/route";
import * as me from "@/app/api/foundation/me/route";
import * as exercises from "@/app/api/exercises/route";
import * as programs from "@/app/api/programs/route";
import * as activeProgram from "@/app/api/programs/active/route";
import * as activate from "@/app/api/programs/[id]/activate/route";
import * as templates from "@/app/api/programs/[id]/templates/route";
import * as entries from "@/app/api/templates/[id]/exercises/route";
import * as activeSession from "@/app/api/sessions/active/route";
import * as nextSession from "@/app/api/sessions/next/route";
import * as sessionExercises from "@/app/api/sessions/[id]/exercises/route";
import * as skip from "@/app/api/session-exercises/[id]/skip/route";
import * as renameTemplate from "@/app/api/templates/[id]/route";
import * as editEntry from "@/app/api/template-exercises/[id]/route";
import * as reorderTemplates from "@/app/api/programs/[id]/templates/reorder/route";
import * as reorderEntries from "@/app/api/templates/[id]/exercises/reorder/route";
import * as start from "@/app/api/sessions/start/route";
import * as sets from "@/app/api/session-exercises/[id]/sets/route";
import * as set from "@/app/api/sets/[id]/route";
import * as complete from "@/app/api/sets/[id]/complete/route";
import * as uncomplete from "@/app/api/sets/[id]/uncomplete/route";
import * as finish from "@/app/api/sessions/[id]/finish/route";
import * as cancel from "@/app/api/sessions/[id]/cancel/route";
import * as history from "@/app/api/sessions/route";
import * as detail from "@/app/api/sessions/[id]/route";
import * as corrections from "@/app/api/sessions/[id]/correct/route";

// Only the external Auth identity and HTTP transport are fixtures.
// Browser renders the real Next production build; handlers/application/SQL/migrations are real.
const userId = "00000000-0000-0000-0000-000000000001";
const origin = "http://127.0.0.1:3104";
let loggedIn = false;
let db: Awaited<ReturnType<typeof planningDatabase>>;
let browser: Browser, context: BrowserContext, page: Page, server: ChildProcess;
let lostResponse: RegExp | undefined;
let unavailable = false;
let browserErrors: string[] = [];
type Handler = (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => Response | Promise<Response>;
type Method = "GET" | "POST" | "PATCH" | "DELETE";
const routes: [RegExp, Partial<Record<Method, Handler>>][] = [
  [/^\/api\/auth\/login$/, authLogin],
  [/^\/api\/auth\/logout$/, authLogout],
  [/^\/api\/foundation\/me$/, me],
  [/^\/api\/exercises$/, exercises],
  [/^\/api\/programs$/, programs],
  [/^\/api\/programs\/active$/, activeProgram],
  [/^\/api\/programs\/([^/]+)\/activate$/, activate],
  [/^\/api\/programs\/([^/]+)\/templates$/, templates],
  [/^\/api\/templates\/([^/]+)\/exercises$/, entries],
  [/^\/api\/sessions\/active$/, activeSession],
  [/^\/api\/sessions\/next$/, nextSession],
  [/^\/api\/sessions\/([^/]+)\/exercises$/, sessionExercises],
  [/^\/api\/session-exercises\/([^/]+)\/skip$/, skip],
  [/^\/api\/templates\/([^/]+)$/, renameTemplate],
  [/^\/api\/template-exercises\/([^/]+)$/, editEntry],
  [/^\/api\/programs\/([^/]+)\/templates\/reorder$/, reorderTemplates],
  [/^\/api\/templates\/([^/]+)\/exercises\/reorder$/, reorderEntries],
  [/^\/api\/sessions\/start$/, start],
  [/^\/api\/session-exercises\/([^/]+)\/sets$/, sets],
  [/^\/api\/sets\/([^/]+)$/, set],
  [/^\/api\/sets\/([^/]+)\/complete$/, complete],
  [/^\/api\/sets\/([^/]+)\/uncomplete$/, uncomplete],
  [/^\/api\/sessions\/([^/]+)\/finish$/, finish],
  [/^\/api\/sessions\/([^/]+)\/cancel$/, cancel],
  [/^\/api\/sessions\/([^/]+)\/correct$/, corrections],
  [/^\/api\/sessions$/, history],
  [/^\/api\/sessions\/([^/]+)$/, detail],
];
async function transport(route: Route) {
  const incoming = route.request();
  const path = new URL(incoming.url()).pathname;
  if (unavailable) {
    await route.fulfill({
      status: 503,
      json: { error: "service_unavailable" },
    });
    return;
  }
  const match = routes.find(([pattern]) => pattern.test(path));
  const handler = match?.[1][incoming.method() as Method];
  if (!match || !handler)
    throw new Error(`Unexpected API request ${incoming.method()} ${path}`);
  const request = new Request(incoming.url(), {
    method: incoming.method(),
    headers: incoming.headers(),
    ...(incoming.postData() ? { body: incoming.postData()! } : {}),
  });
  const response = await handler(request, {
    params: Promise.resolve({ id: match[0].exec(path)?.[1] ?? "" }),
  });
  if (incoming.method() === "POST" && lostResponse?.test(path)) {
    lostResponse = undefined;
    await route.abort("failed");
    return;
  }
  await route.fulfill({
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  });
}
beforeAll(async () => {
  db = await planningDatabase();
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3104",
    ],
    { stdio: "pipe", windowsHide: true },
  );
  let serverLogs = "";
  server.stdout?.on("data", (data) => {
    serverLogs += String(data);
  });
  server.stderr?.on("data", (data) => {
    serverLogs += String(data);
  });
  const deadline = Date.now() + 45000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(serverLogs);
    try {
      const result = await fetch(origin);
      if (result.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Server is still starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready)
    throw new Error("Next server did not become ready: " + serverLogs);
  browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {},
  );
  await mkdir("test-results", { recursive: true });
});
beforeEach(async () => {
  await db.reset();
  loggedIn = false;
  lostResponse = undefined;
  unavailable = false;
  browserErrors = [];
  context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await context.route("**/api/**", transport);
  page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(error.message));
});
afterEach(async () => {
  await context?.close();
  expect(browserErrors).toEqual([]);
});
afterAll(async () => {
  await browser?.close();
  server?.kill();
  await db?.close();
});
async function login() {
  await page.goto(origin);
  await browserExpect(page).toHaveURL(origin + "/login");
  await page.getByLabel("Email", { exact: true }).fill("pilot@example.test");
  await page.getByLabel("Password", { exact: true }).fill("pilot-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await browserExpect(
    page.getByRole("heading", { name: "Make this set count." }),
  ).toBeVisible();
}
async function seed() {
  const exercise = await db.app.createExercise(userId, {
    name: "Press",
    loadType: "WEIGHTED",
  });
  await db.app.createProgram(userId, {
    name: "Pilot",
    initialTemplate: {
      name: "Workout A",
      exercises: [
        {
          exerciseId: exercise.id,
          targetWorkingSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 12,
        },
      ],
    },
  });
}
async function startWorkout() {
  await page
    .getByRole("button", { name: "Start Workout", exact: true })
    .click();
  await browserExpect(
    page.getByRole("heading", { name: "Workout A", exact: true }),
  ).toBeVisible();
  await browserExpect(
    page.getByRole("button", { name: "Add draft set" }).first(),
  ).toBeVisible();
}
it("Finished corrections save local edits atomically, retain drafts, survive reload/login and leave rotation unchanged", async () => {
  const pressDefinition = await db.app.createExercise(userId, {
    name: "Press",
    loadType: "WEIGHTED",
  });
  const other = await db.app.createExercise(userId, {
    name: "Other",
    loadType: "BODYWEIGHT",
  });
  const body = await db.app.createExercise(userId, {
    name: "Forgotten Squat",
    loadType: "BODYWEIGHT",
  });
  await db.app.createProgram(userId, {
    name: "Pilot",
    initialTemplate: {
      name: "Workout A",
      exercises: [pressDefinition, other].map((e) => ({
        exerciseId: e.id,
        targetWorkingSets: 2,
        targetRepsMin: 8,
        targetRepsMax: 12,
      })),
    },
  });
  await login();
  await startWorkout();
  const cards = page.locator("section.exercise");
  const press = cards.filter({
    has: page.getByRole("heading", { name: "Press", exact: true }),
  });
  for (let i = 0; i < 2; i++) {
    await press
      .getByRole("button", { name: "Add draft set", exact: true })
      .click();
    const set = press.getByRole("article", {
      name: `Set ${i + 1}`,
      exact: true,
    });
    await set.getByLabel("External load (kg)", { exact: true }).fill("22.5");
    await set.getByLabel("Reps", { exact: true }).fill("8");
    await set.getByRole("button", { name: "Save values", exact: true }).click();
    await set.getByRole("button", { name: "Complete", exact: true }).click();
    await browserExpect(
      set.getByText("Completed", { exact: true }),
    ).toBeVisible();
  }
  await press
    .getByRole("button", { name: "Add draft set", exact: true })
    .click();
  await browserExpect(
    press.getByRole("article", { name: "Set 3", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Finish Workout", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm finish", exact: true })
    .click();
  await browserExpect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  const original = await db.execution.historyDetail(
    userId,
    (await db.execution.history(userId))[0].id,
  );
  const next = await db.workouts.next(userId);
  let saves = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/correct")) saves++;
  });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await browserExpect(
    page.getByText("Edit Finished Workout", { exact: true }),
  ).toBeVisible();
  const first = press.getByRole("article", { name: "Set 1", exact: true });
  await first
    .getByLabel("External load (kg)", { exact: true })
    .fill("23.75000000000000001");
  await first.getByLabel("Reps", { exact: true }).fill("9");
  await first.getByLabel("Set type").selectOption("WARM_UP");
  await first.getByLabel("RIR (optional)").fill("0");
  await press
    .getByRole("article", { name: "Set 2", exact: true })
    .getByRole("button", { name: "Delete Set", exact: true })
    .click();
  const draft = press.getByRole("article", { name: "Set 3", exact: true });
  await browserExpect(draft.getByLabel("Reps", { exact: true })).toHaveCount(0);
  await browserExpect(
    draft.getByRole("button", { name: /Complete/ }),
  ).toHaveCount(0);
  await press.getByRole("button", { name: "Add Set", exact: true }).click();
  const forgotten = press.getByRole("article", { name: "Set 4", exact: true });
  await forgotten.getByLabel("External load (kg)", { exact: true }).fill("25");
  await forgotten.getByLabel("Reps", { exact: true }).fill("10");
  await cards
    .filter({ has: page.getByRole("heading", { name: "Other", exact: true }) })
    .getByRole("checkbox", { name: "Skipped", exact: true })
    .check();
  await page
    .getByLabel("Forgotten Exercise", { exact: true })
    .selectOption(body.id);
  await page.getByRole("button", { name: "Add Exercise", exact: true }).click();
  const squat = cards.filter({
    has: page.getByRole("heading", { name: "Forgotten Squat", exact: true }),
  });
  await squat.getByRole("button", { name: "Add Set", exact: true }).click();
  await squat.getByLabel("Reps", { exact: true }).fill("6");
  expect(saves).toBe(0);
  expect(await db.execution.historyDetail(userId, original.id)).toEqual(
    original,
  );
  await page
    .getByRole("button", { name: "Save corrections", exact: true })
    .click();
  await browserExpect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  expect(saves).toBe(1);
  const saved = await db.execution.historyDetail(userId, original.id);
  expect(saved).toMatchObject({
    status: "FINISHED",
    correctionRevision: 1,
    finishOrder: original.finishOrder,
    finishedAt: original.finishedAt,
    plannedWorkingSetQuota: 4,
  });
  expect(saved.exercises[0].sets).toHaveLength(3);
  expect(saved.exercises[0].sets[1].completedAt).toBeNull();
  expect(saved.exercises[1].skipped).toBe(true);
  expect(saved.exercises[2]).toMatchObject({
    origin: "SESSION_ONLY",
    plannedWorkingSets: 0,
    sets: [{ reps: 6 }],
  });
  expect(await db.workouts.next(userId)).toEqual(next);
  await page.reload();
  await browserExpect(
    page.getByText("23.75000000000000001", { exact: false }),
  ).toBeVisible();
  await browserExpect(
    page.getByText("Draft — incomplete", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/finished-corrections-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await press
    .getByRole("article", { name: "Set 1", exact: true })
    .getByLabel("Reps", { exact: true })
    .fill("11");
  page.once("dialog", (d) => void d.dismiss());
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await browserExpect(
    page.getByText("Edit Finished Workout", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (d) => void d.dismiss());
  await page
    .getByRole("button", { name: "Cancel editing", exact: true })
    .click();
  await browserExpect(
    page.getByText("Edit Finished Workout", { exact: true }),
  ).toBeVisible();
  // A cancelled browser Back must retain local input, not merely reload detail.
  page.once("dialog", (d) => void d.dismiss());
  await page.goBack();
  await browserExpect(
    page.getByText("Edit Finished Workout", { exact: true }),
  ).toBeVisible();
  await browserExpect(
    press
      .getByRole("article", { name: "Set 1", exact: true })
      .getByLabel("Reps", { exact: true }),
  ).toHaveValue("11");
  page.once("dialog", (d) => void d.accept());
  await page
    .getByRole("button", { name: "Cancel editing", exact: true })
    .click();
  await browserExpect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  expect(await db.execution.historyDetail(userId, original.id)).toEqual(saved);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await login();
  await page.getByRole("link", { name: "History", exact: true }).click();
  await page.locator(`a[href="/history/${original.id}"]`).click();
  await browserExpect(
    page.getByText("23.75000000000000001", { exact: false }),
  ).toBeVisible();
});
it.each(["edit", "delete"])(
  "Finished editor recovers from stale Save after confirmed refresh (external %s); session-only delete requires confirmation",
  async (externalChange) => {
    await seed();
    const plan = (await db.app.activeProgram(userId))!;
    const { session } = await db.workouts.start(userId, {
      templateId: plan.templates[0].id,
    });
    const e = await db.execution.addExercise(userId, session.id, {
      exerciseId: plan.templates[0].exercises[0].exerciseId,
    });
    const s = await db.execution.createSet(userId, e.id, {
      id: randomUUID(),
      loadKg: "20",
      reps: 8,
    });
    await db.execution.completeSet(userId, s.id);
    const draft = await db.execution.createSet(userId, e.id, {
      id: randomUUID(),
    });
    await db.execution.finish(userId, session.id, { timeZone: "UTC" });
    await login();
    await page.getByRole("link", { name: "History", exact: true }).click();
    await page.locator(`a[href="/history/${session.id}"]`).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const sessionOnly = page
      .locator("section.exercise")
      .filter({ has: page.getByLabel("Exercise identity", { exact: true }) });
    page.once("dialog", (d) => void d.dismiss());
    await sessionOnly
      .getByRole("button", { name: "Delete Exercise", exact: true })
      .click();
    await browserExpect(sessionOnly).toHaveCount(1);
    await sessionOnly.getByLabel("Reps", { exact: true }).fill("9");
    // Local add/delete state must also be discarded by the successful refresh.
    await sessionOnly
      .getByRole("article", { name: "Set 2", exact: true })
      .getByRole("button", { name: "Delete Set", exact: true })
      .click();
    await sessionOnly
      .getByRole("button", { name: "Add Set", exact: true })
      .click();
    const localAddition = sessionOnly.getByRole("article", {
      name: "Set 3",
      exact: true,
    });
    await localAddition
      .getByLabel("External load (kg)", { exact: true })
      .fill("20");
    await localAddition.getByLabel("Reps", { exact: true }).fill("6");
    await db.corrections.correct(userId, session.id, {
      expected_revision: 0,
      ...(externalChange === "edit"
        ? {
            setEdits: [
              { id: s.id, type: "WORKING", loadKg: "21", reps: 10, rir: null },
            ],
          }
        : { setDeletions: [s.id] }),
    });
    await page
      .getByRole("button", { name: "Save corrections", exact: true })
      .click();
    await browserExpect(page.locator("main").getByRole("alert")).toContainText(
      "saved state has changed",
    );
    const canonical = await db.execution.historyDetail(userId, session.id);
    expect(canonical.correctionRevision).toBe(1);
    if (externalChange === "edit")
      expect(canonical.exercises[1].sets[0]).toMatchObject({
        reps: 10,
        loadKg: "21",
      });
    else
      expect(canonical.exercises[1].sets.map((set) => set.id)).toEqual([
        draft.id,
      ]);
    await browserExpect(
      sessionOnly
        .getByRole("article", { name: "Set 1", exact: true })
        .getByLabel("Reps", { exact: true }),
    ).toHaveValue("9");
    await browserExpect(localAddition).toBeVisible();
    await browserExpect(
      page.getByText("Edit Finished Workout", { exact: true }),
    ).toBeVisible();
    // A declined refresh retains the stale local input and revision.
    page.once("dialog", (dialog) => void dialog.dismiss());
    await page
      .getByRole("button", { name: "Refresh saved state", exact: true })
      .click();
    await browserExpect(
      sessionOnly
        .getByRole("article", { name: "Set 1", exact: true })
        .getByLabel("Reps", { exact: true }),
    ).toHaveValue("9");
    page.once("dialog", (dialog) => void dialog.accept());
    await page
      .getByRole("button", { name: "Refresh saved state", exact: true })
      .click();
    await browserExpect(
      page.getByText("Saved state refreshed.", { exact: true }),
    ).toBeVisible();
    await browserExpect(localAddition).toHaveCount(0);
    await browserExpect(
      sessionOnly.getByRole("article", { name: "Set 2", exact: true }),
    ).toBeVisible();
    await browserExpect(
      page.getByRole("button", { name: "Save corrections", exact: true }),
    ).toBeDisabled();
    await browserExpect(page.locator("main").getByRole("alert")).toHaveCount(0);
    if (externalChange === "edit") {
      const refreshed = sessionOnly.getByRole("article", {
        name: "Set 1",
        exact: true,
      });
      await browserExpect(
        refreshed.getByLabel("Reps", { exact: true }),
      ).toHaveValue("10");
      await refreshed.getByLabel("RIR (optional)", { exact: true }).fill("1");
    } else {
      await browserExpect(
        sessionOnly.getByRole("article", { name: "Set 1", exact: true }),
      ).toHaveCount(0);
      await sessionOnly
        .getByRole("button", { name: "Add Set", exact: true })
        .click();
      const added = sessionOnly.getByRole("article", {
        name: "Set 3",
        exact: true,
      });
      await added.getByLabel("External load (kg)", { exact: true }).fill("25");
      await added.getByLabel("Reps", { exact: true }).fill("12");
    }
    await page
      .getByRole("button", { name: "Save corrections", exact: true })
      .click();
    await browserExpect(
      page.getByRole("button", { name: "Edit", exact: true }),
    ).toBeVisible();
    const saved = await db.execution.historyDetail(userId, session.id);
    expect(saved.correctionRevision).toBe(2);
    expect(
      saved.exercises[1].sets.some(
        (set) => set.id === draft.id && !set.completedAt,
      ),
    ).toBe(true);
    if (externalChange === "edit")
      expect(
        saved.exercises[1].sets.find((set) => set.id === s.id),
      ).toMatchObject({ reps: 10, rir: 1 });
    else {
      expect(saved.exercises[1].sets.some((set) => set.id === s.id)).toBe(
        false,
      );
      expect(
        saved.exercises[1].sets.find((set) => set.completedAt),
      ).toMatchObject({ position: 2, reps: 12, loadKg: "25" });
    }
  },
);
it("mobile user logs in, prepares all load types, starts, corrects/completes sets, finishes partial, reloads History and logs out", async () => {
  await page.goto(origin + "/login");
  await page.getByLabel("Email", { exact: true }).fill("pilot@example.test");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await browserExpect(page.locator("main").getByRole("alert")).toHaveText(
    "Email or password was not accepted.",
  );
  await page.getByLabel("Password", { exact: true }).fill("pilot-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Set up first workout" }).click();
  for (const [name, type] of [
    ["Press", "WEIGHTED"],
    ["Pull-up", "BODYWEIGHT"],
    ["Assisted pull-up", "ASSISTED_BODYWEIGHT"],
  ]) {
    await page.getByLabel("Exercise name", { exact: true }).fill(name);
    await page.getByLabel("Load type", { exact: true }).selectOption(type);
    await page.getByRole("button", { name: "Create exercise" }).click();
    await browserExpect(page.locator(".compact-list")).toContainText(name);
  }
  await page.getByLabel("Program name", { exact: true }).fill("Pilot");
  await page
    .getByLabel("First template name", { exact: true })
    .fill("Workout A");
  await page.getByRole("button", { name: "Create program" }).click();
  await browserExpect(page.getByText("Active Program:")).toBeVisible();
  for (const name of ["Press", "Pull-up", "Assisted pull-up"]) {
    await page
      .getByLabel("Exercise", { exact: true })
      .selectOption({ label: name });
    await page.getByRole("button", { name: "Add to template" }).click();
    await browserExpect(page.locator(".plan-preview")).toContainText(name);
  }
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await startWorkout();
  const sections = page.locator("section.exercise");
  const press = sections.filter({
    has: page.getByRole("heading", { name: "Press", exact: true }),
  });
  await press.getByRole("button", { name: "Add draft set" }).click();
  const editor = press.getByRole("article", { name: "Set 1", exact: true });
  await browserExpect(editor.getByText("Draft", { exact: true })).toBeVisible();
  await editor
    .getByLabel("External load (kg)", { exact: true })
    .fill("72.50000000000000000001");
  await editor.getByLabel("Reps", { exact: true }).fill("8");
  await editor.getByLabel("Set type").selectOption("WARM_UP");
  await editor.getByRole("button", { name: "Save values" }).click();
  await browserExpect(editor.getByText("Draft", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Complete", exact: true }).click();
  await browserExpect(
    editor.getByText("Completed", { exact: true }),
  ).toBeVisible();
  await editor.getByRole("button", { name: "Uncomplete", exact: true }).click();
  await editor.getByLabel("Set type").selectOption("WORKING");
  await editor.getByLabel("Reps", { exact: true }).fill("9");
  await editor.getByLabel("RIR (optional)").fill("10");
  await editor.getByRole("button", { name: "Save values" }).click();
  await editor.getByRole("button", { name: "Complete", exact: true }).click();
  await page.reload();
  await browserExpect(
    press.getByText("Completed", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await browserExpect(page).toHaveURL(origin + "/");
  await page.reload();
  await page.getByRole("link", { name: "Resume Workout", exact: true }).click();
  const bodyweight = sections.filter({
    has: page.getByRole("heading", { name: "Pull-up", exact: true }),
  });
  await bodyweight.getByRole("button", { name: "Add draft set" }).click();
  await browserExpect(bodyweight.getByLabel("External load (kg)")).toHaveCount(
    0,
  );
  await bodyweight.getByLabel("Reps", { exact: true }).fill("6");
  await bodyweight.getByRole("button", { name: "Save values" }).click();
  await bodyweight
    .getByRole("button", { name: "Complete", exact: true })
    .click();
  const assisted = sections.filter({
    has: page.getByRole("heading", { name: "Assisted pull-up", exact: true }),
  });
  await assisted.getByRole("button", { name: "Add draft set" }).click();
  await assisted.getByLabel("Assistance (kg)", { exact: true }).fill("20.25");
  await assisted.getByLabel("Reps", { exact: true }).fill("7");
  await assisted.getByRole("button", { name: "Save values" }).click();
  await assisted.getByRole("button", { name: "Complete", exact: true }).click();
  await press.getByRole("button", { name: "Add draft set" }).click();
  const deleted = press.getByRole("article", { name: "Set 2", exact: true });
  await deleted.getByRole("button", { name: "Delete", exact: true }).click();
  await deleted
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await browserExpect(deleted).toHaveCount(0);
  await press.getByRole("button", { name: "Add draft set" }).click();
  await page.screenshot({
    path: "test-results/workout-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Finish Workout", exact: true })
    .click();
  expect((await db.workouts.active(userId))?.status).toBe("ACTIVE");
  lostResponse = /\/finish$/;
  await page
    .getByRole("button", { name: "Confirm finish", exact: true })
    .click();
  await browserExpect(page).toHaveURL(/\/history\/[0-9a-f-]+$/);
  await browserExpect(
    page.getByText("Workout saved.", { exact: false }),
  ).toBeVisible();
  await browserExpect(
    page.getByText("Draft — incomplete", { exact: true }),
  ).toHaveCount(1);
  await browserExpect(page.getByText("Completed", { exact: true })).toHaveCount(
    3,
  );
  await browserExpect(
    page.getByText("72.50000000000000000001", { exact: false }),
  ).toBeVisible();
  const original = (await db.execution.history(userId))[0];
  await page.reload();
  await browserExpect(
    page.getByText("Workout saved.", { exact: false }),
  ).toBeVisible();
  expect(await db.execution.history(userId)).toHaveLength(1);
  expect((await db.execution.history(userId))[0].finishOrder).toBe(
    original.finishOrder,
  );
  await page.getByRole("link", { name: "All History", exact: true }).click();
  await browserExpect(page.locator(".history-link")).toHaveCount(1);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await browserExpect(page).toHaveURL(origin + "/login");
  await page.goto(origin + "/workout");
  await browserExpect(page).toHaveURL(origin + "/login");
});
it("lost create response and reload retain the retry UUID without a second canonical set", async () => {
  await seed();
  await login();
  await startWorkout();
  lostResponse = /\/session-exercises\/[^/]+\/sets$/;
  await page.getByRole("button", { name: "Add draft set" }).click();
  await browserExpect(page.locator("main").getByRole("alert")).toContainText(
    "may have been saved",
  );
  expect((await db.workouts.active(userId))?.exercises[0].sets).toHaveLength(1);
  await page.reload();
  await browserExpect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Add draft set" }).click();
  await browserExpect(page.getByRole("status")).toContainText("already saved");
  expect((await db.workouts.active(userId))?.exercises[0].sets).toHaveLength(1);
  // A later erroneous draft can be deleted before its lost-response retry.
  lostResponse = /\/session-exercises\/[^/]+\/sets$/;
  await page.getByRole("button", { name: "Add draft set" }).click();
  await browserExpect(page.locator("main").getByRole("alert")).toBeVisible();
  await page.reload();
  const erroneous = page.getByRole("article", { name: "Set 2", exact: true });
  await erroneous.getByRole("button", { name: "Delete", exact: true }).click();
  await erroneous.getByRole("button", { name: "Confirm delete" }).click();
  await browserExpect(erroneous).toHaveCount(0);
  await page.getByRole("button", { name: "Add draft set" }).click();
  await browserExpect(page.getByRole("article")).toHaveCount(2);
});
it("Cancel requires confirmation, supports a lost-response retry and never creates History", async () => {
  await seed();
  await login();
  await startWorkout();
  await page
    .getByRole("button", { name: "Cancel Workout", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Keep training", exact: true })
    .click();
  expect((await db.workouts.active(userId))?.status).toBe("ACTIVE");
  await page
    .getByRole("button", { name: "Cancel Workout", exact: true })
    .click();
  lostResponse = /\/cancel$/;
  await page
    .getByRole("button", { name: "Confirm cancel", exact: true })
    .click();
  await browserExpect(page.locator("main").getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm cancel", exact: true })
    .click();
  await browserExpect(
    page.getByRole("heading", { name: "No active workout" }),
  ).toBeVisible();
  await page.reload();
  await browserExpect(
    page.getByRole("heading", { name: "No active workout" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open History", exact: true }).click();
  await browserExpect(
    page.getByText("No finished workouts yet."),
  ).toBeVisible();
  expect(await db.execution.history(userId)).toEqual([]);
});
it("service failure has a recovery action and expired auth hides private content", async () => {
  await login();
  unavailable = true;
  await page.reload();
  await browserExpect(page.locator("main").getByRole("alert")).toContainText(
    "unavailable",
  );
  unavailable = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await browserExpect(
    page.getByRole("link", { name: "Set up first workout" }),
  ).toBeVisible();
  loggedIn = false;
  await page.getByRole("button", { name: "Refresh saved state" }).click();
  await browserExpect(page).toHaveURL(origin + "/login");
  await browserExpect(page.getByRole("navigation")).toHaveCount(0);
});

it("repeatable mobile flow: planning edits/order, Next, session-only logging, Skip, partial Finish and Cancel rotation", async () => {
  await seed();
  const plan = (await db.app.activeProgram(userId))!;
  const b = await db.app.createTemplate(userId, plan.id, { name: "Workout B" });
  const c = await db.app.createTemplate(userId, plan.id, { name: "Workout C" });
  const extra = await db.app.createExercise(userId, {
    name: "Extra pull-up",
    loadType: "BODYWEIGHT",
  });
  await login();
  await browserExpect(
    page.getByRole("heading", { name: "Next Workout: Workout A" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Program", exact: true }).click();
  const aCard = page.locator(".plan-preview").filter({
    has: page.getByRole("heading", { name: "Workout A", exact: true }),
  });
  await aCard.getByText("Edit targets for Press", { exact: true }).click();
  await aCard.getByLabel("Working sets", { exact: true }).fill("4");
  await aCard
    .getByRole("button", { name: "Save targets", exact: true })
    .click();
  await browserExpect(aCard).toContainText("4 working sets");
  await page
    .getByRole("button", { name: "Move Workout C up", exact: true })
    .click();
  await browserExpect(page.locator(".plan-preview h3")).toHaveText([
    "Workout A",
    "Workout C",
    "Workout B",
  ]);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await startWorkout();
  const planned = page
    .locator("section.exercise")
    .filter({ has: page.getByRole("heading", { name: "Press", exact: true }) });
  await planned
    .getByRole("button", { name: "Skip exercise", exact: true })
    .click();
  await browserExpect(
    planned.getByText("Skipped", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Session-only exercise", { exact: true })
    .selectOption(extra.id);
  await page.getByRole("button", { name: "Add exercise", exact: true }).click();
  const added = page.locator("section.exercise").filter({
    has: page.getByRole("heading", { name: "Extra pull-up", exact: true }),
  });
  await browserExpect(
    added.getByText("Session-only · no planned targets", { exact: true }),
  ).toBeVisible();
  await added
    .getByRole("button", { name: "Add draft set", exact: true })
    .click();
  await added.getByLabel("Reps", { exact: true }).fill("10");
  await added.getByRole("button", { name: "Save values", exact: true }).click();
  await browserExpect(
    added.getByRole("button", { name: "Complete", exact: true }),
  ).toBeEnabled();
  await added.getByRole("button", { name: "Complete", exact: true }).click();
  await browserExpect(
    added.getByText("Completed", { exact: true }),
  ).toBeVisible();
  await browserExpect(
    added.getByRole("button", { name: "Skip exercise", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await browserExpect(
    planned.getByText("Skipped", { exact: true }),
  ).toBeVisible();
  await browserExpect(
    added.getByText("Completed", { exact: true }),
  ).toBeVisible();
  const active = (await db.workouts.active(userId))!;
  expect(active.plannedWorkingSetQuota).toBe(4);
  expect(active.exercises[0].sets).toHaveLength(0);
  expect(active.exercises[1]).toMatchObject({
    origin: "SESSION_ONLY",
    plannedWorkingSets: 0,
    sets: [{ reps: 10 }],
  });
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: "Resume Workout", exact: true }).click();
  await page
    .getByRole("button", { name: "Finish Workout", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm finish", exact: true })
    .click();
  await browserExpect(
    page.getByText("Workout saved.", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await browserExpect(page.getByText("Skipped", { exact: true })).toBeVisible();
  await browserExpect(
    page.getByText("Session-only · no planned targets", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await browserExpect(
    page.getByRole("heading", { name: "Next Workout: Workout C" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start Workout", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel Workout", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm cancel", exact: true })
    .click();
  await browserExpect(
    page.getByRole("heading", { name: "No active workout" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await browserExpect(
    page.getByRole("heading", { name: "Next Workout: Workout C" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start Workout", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Finish Workout", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm finish", exact: true })
    .click();
  await browserExpect(
    page.getByText("Workout saved.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await browserExpect(
    page.getByRole("heading", { name: "Next Workout: Workout B" }),
  ).toBeVisible();
  expect(
    (await db.app.activeProgram(userId))?.templates.map(
      (template) => template.id,
    ),
  ).toEqual([plan.templates[0].id, c.id, b.id]);
  expect(
    (await db.app.activeProgram(userId))?.templates[0].exercises,
  ).toHaveLength(1);
});
