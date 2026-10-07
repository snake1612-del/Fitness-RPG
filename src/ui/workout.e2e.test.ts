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
vi.mock("@/server/auth/better-auth", () => ({
  getIdentityProvider: async () => ({
    currentIdentity: async () => (loggedIn ? { id: userId } : null),
  }),
  getAuth: () => ({
    handler: async (req: Request) => {
      if (new URL(req.url).pathname.endsWith("sign-out")) {
        loggedIn = false;
        return new Response(null);
      }
      const body = await req.json();
      if (body.password !== "pilot-password")
        return new Response(null, { status: 401 });
      loggedIn = true;
      return new Response(null);
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
vi.mock("@/server/training/previous-performance-application", () => ({
  getPreviousPerformanceApplication: () => db.previous,
}));
vi.mock("@/server/training/progress-application", () => ({
  getProgressApplication: () =>
    createProgressApplication(createProgressRepository(db.database)),
}));
vi.mock("@/server/gamification/application", () => ({
  getGamificationApplication: () =>
    createGamificationApplication(createGamificationRepository(db.database)),
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabaseReadinessGateway: () => ({
    check: async () => {
      await db.postgres.query("SELECT 1");
    },
  }),
}));
import { planningDatabase } from "@/test/planning-database";
import { createProgressApplication } from "@/application/training/progress";
import { createProgressRepository } from "@/server/training/progress-repository";
import { createGamificationApplication } from "@/application/gamification";
import { createGamificationRepository } from "@/server/gamification/repository";
import { createExecutionApplication } from "@/application/training/execution";
import { createExecutionRepository } from "@/server/training/execution-repository";
import * as gamification from "@/app/api/gamification/route";
import * as progress from "@/app/api/progress/route";
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
import * as previous from "@/app/api/sessions/[id]/previous-performance/route";

// Only the external Auth identity and HTTP transport are fixtures.
// Browser renders the real Next production build; handlers/application/SQL/migrations are real.
const userId = "00000000-0000-0000-0000-000000000001";
const origin = "http://127.0.0.1:3104";
let loggedIn = false;
let db: Awaited<ReturnType<typeof planningDatabase>>;
let browser: Browser, context: BrowserContext, page: Page, server: ChildProcess;
let lostResponse: RegExp | undefined;
let unavailable = false;
let previousUnavailable = false;
let browserErrors: string[] = [];
type Handler = (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => Response | Promise<Response>;
type Method = "GET" | "POST" | "PATCH" | "DELETE";
const routes: [RegExp, Partial<Record<Method, Handler>>][] = [
  [/^\/api\/gamification$/, gamification],
  [/^\/api\/progress$/, progress],
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
  [/^\/api\/sessions\/([^/]+)\/previous-performance$/, previous],
  [/^\/api\/sessions$/, history],
  [/^\/api\/sessions\/([^/]+)$/, detail],
];
async function transport(route: Route) {
  const incoming = route.request();
  const path = new URL(incoming.url()).pathname;
  if (
    unavailable ||
    (previousUnavailable && path.endsWith("/previous-performance"))
  ) {
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
  previousUnavailable = false;
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
it("Character navigation presents actual zero-history API values and reloads", async () => {
  await login();
  await page.getByRole("link", { name: "Character", exact: true }).click();
  await browserExpect(page).toHaveURL(origin + "/character");
  await browserExpect(page.getByText("Level 1", { exact: true })).toBeVisible();
  await browserExpect(
    page.getByText("0 / 100 XP", { exact: true }),
  ).toBeVisible();
  await browserExpect(
    page.getByText("100 XP remaining", { exact: true }),
  ).toBeVisible();
  await browserExpect(page.getByLabel("Your Character")).toContainText(
    "0 Total XP",
  );
  await browserExpect(page.getByLabel("Visual milestones")).toContainText(
    "Level 1 · Foundation",
  );
  await browserExpect(page.getByLabel("Visual milestones")).toContainText(
    "Level 3 · Form",
  );
  await browserExpect(
    page.getByRole("link", { name: "Character", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await browserExpect(page.getByRole("progressbar")).toHaveAttribute(
    "value",
    "0",
  );
  await page.reload();
  await browserExpect(page.getByText("Level 1", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 812 });
  expect(
    await page.locator(".bottom-nav a").evaluateAll((links) =>
      links.every((link) => {
        const range = document.createRange();
        range.selectNodeContents(link);
        const text = range.getBoundingClientRect(),
          cell = link.getBoundingClientRect();
        return text.left >= cell.left && text.right <= cell.right;
      }),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
it("Character loading/error never show fake or stale XP; retry recovers", async () => {
  await login();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route("**/api/gamification", async (route) => {
    await gate;
    await transport(route);
  });
  await page.getByRole("link", { name: "Character", exact: true }).click();
  await browserExpect(page.getByRole("status")).toHaveText(
    "Loading Character…",
  );
  await browserExpect(page.getByLabel("Your Character")).toHaveCount(0);
  await browserExpect(page.getByText("Level 1", { exact: true })).toHaveCount(
    0,
  );
  release();
  await browserExpect(page.getByText("Level 1", { exact: true })).toBeVisible();
  unavailable = true;
  await page.getByRole("button", { name: "Refresh Character" }).click();
  await browserExpect(
    page
      .getByRole("alert")
      .filter({ hasText: "Could not load your Character" }),
  ).toContainText("Could not load your Character");
  await browserExpect(page.getByLabel("Your Character")).toHaveCount(0);
  await browserExpect(page.getByRole("progressbar")).toHaveCount(0);
  unavailable = false;
  await page.getByRole("button", { name: "Refresh Character" }).click();
  await browserExpect(page.getByText("Level 1", { exact: true })).toBeVisible();
});
it("Character upgrades and downgrades with canonical correction-driven Gamification", async () => {
  const exercise = await db.app.createExercise(userId, {
    name: "Character Press",
    loadType: "WEIGHTED",
  });
  const plan = await db.app.createProgram(userId, {
    name: "Character pilot",
    initialTemplate: {
      name: "A",
      exercises: [
        {
          exerciseId: exercise.id,
          targetWorkingSets: 2,
          targetRepsMin: 1,
          targetRepsMax: 10,
        },
      ],
    },
  });
  let date = new Date("2026-10-01T12:00:00Z");
  const execution = createExecutionApplication(
    createExecutionRepository(db.database),
    () => date,
  );
  async function finishDay(day: number) {
    date = new Date(`2026-10-0${day}T12:00:00Z`);
    const session = (
      await db.workouts.start(userId, { templateId: plan.templates[0].id })
    ).session;
    const sets = [];
    for (let i = 0; i < 2; i++) {
      const s = await execution.createSet(userId, session.exercises[0].id, {
        id: randomUUID(),
        loadKg: "20",
        reps: 8,
        type: "WORKING",
      });
      await execution.completeSet(userId, s.id);
      sets.push(s);
    }
    await execution.finish(userId, session.id, { timeZone: "UTC" });
    return { session, sets };
  }
  await finishDay(1);
  await finishDay(2);
  await login();
  await page.getByRole("link", { name: "Character", exact: true }).click();
  await browserExpect(page.getByText("Level 2", { exact: true })).toBeVisible();
  await browserExpect(page.locator(".character-content")).toHaveAttribute(
    "data-stage",
    "1",
  );
  const third = await finishDay(3);
  await page.getByRole("button", { name: "Refresh Character" }).click();
  await browserExpect(page.getByText("Level 3", { exact: true })).toBeVisible();
  await browserExpect(
    page.getByText("75 / 150 XP", { exact: true }),
  ).toBeVisible();
  await browserExpect(page.getByLabel("Your Character")).toContainText(
    "300 Total XP",
  );
  await browserExpect(page.locator(".character-content")).toHaveAttribute(
    "data-stage",
    "3",
  );
  await browserExpect(page.getByLabel("Visual milestones")).toContainText(
    "Level 5 · Momentum",
  );
  await db.corrections.correct(userId, third.session.id, {
    expected_revision: 0,
    setEdits: [
      {
        id: third.sets[0].id,
        type: "WARM_UP",
        loadKg: "20",
        reps: 8,
        rir: null,
      },
    ],
  });
  await page.getByRole("button", { name: "Refresh Character" }).click();
  await browserExpect(page.getByText("Level 2", { exact: true })).toBeVisible();
  await browserExpect(page.locator(".character-content")).toHaveAttribute(
    "data-stage",
    "1",
  );
  await browserExpect(
    page.getByText("100 / 125 XP", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await browserExpect(page.locator(".character-content")).toHaveAttribute(
    "data-stage",
    "1",
  );
});
it("Progress overview, all load types, archived selector, correction refresh and reload are read-only", async () => {
  const definitions = await Promise.all(
    (["WEIGHTED", "BODYWEIGHT", "ASSISTED_BODYWEIGHT"] as const).map(
      (loadType) => db.app.createExercise(userId, { name: loadType, loadType }),
    ),
  );
  const plan = await db.app.createProgram(userId, {
    name: "Progress pilot",
    initialTemplate: {
      name: "A",
      exercises: definitions.map((e) => ({
        exerciseId: e.id,
        targetWorkingSets: 2,
        targetRepsMin: 8,
        targetRepsMax: 10,
      })),
    },
  });
  let savedSet = "",
    savedSession = "";
  for (let i = 0; i < 2; i++) {
    const active = (
      await db.workouts.start(userId, { templateId: plan.templates[0].id })
    ).session;
    for (const entry of active.exercises) {
      const set = await db.execution.createSet(userId, entry.id, {
        id: randomUUID(),
        type: "WORKING",
        loadKg: entry.loadType === "BODYWEIGHT" ? null : "30.05",
        reps: 6,
        rir: 2,
      });
      await db.execution.completeSet(userId, set.id);
      if (entry.loadType === "WEIGHTED") {
        savedSet = set.id;
        savedSession = active.id;
      }
    }
    await db.execution.finish(userId, active.id, { timeZone: "UTC" });
  }
  const zero = (
    await db.workouts.start(userId, { templateId: plan.templates[0].id })
  ).session;
  await db.execution.finish(userId, zero.id, { timeZone: "UTC" });
  const cancelled = (
    await db.workouts.start(userId, { templateId: plan.templates[0].id })
  ).session;
  await db.execution.cancel(userId, cancelled.id);
  await db.app.changeExercise(userId, definitions[0].id, { archived: true });
  await login();
  await page.getByRole("link", { name: "Progress", exact: true }).click();
  await browserExpect(
    page.getByRole("heading", { name: "Training Overview" }),
  ).toBeVisible();
  await browserExpect(page.locator("dd")).toHaveText(["3", "3", "3"]);
  const select = page.getByLabel("Exercise", { exact: true });
  await select.selectOption(definitions[0].id);
  await browserExpect(
    page.getByRole("heading", { name: "Highest Load" }),
  ).toBeVisible();
  await browserExpect(page.getByText("36.1 kg", { exact: true })).toBeVisible();
  await browserExpect(
    page.getByText("30.05 kg × 6 · RIR 2", { exact: true }),
  ).toBeVisible();
  await browserExpect(page.getByText(/Working Volume: 180.3/)).toHaveCount(2);
  await db.corrections.correct(userId, savedSession, {
    expected_revision: 0,
    setEdits: [
      { id: savedSet, type: "WORKING", loadKg: "40", reps: 6, rir: null },
    ],
  });
  await page.getByRole("button", { name: "Refresh Progress" }).click();
  await browserExpect(page.getByText("48.0 kg", { exact: true })).toBeVisible();
  await select.selectOption(definitions[1].id);
  await browserExpect(
    page.getByRole("heading", { name: "Max Reps" }),
  ).toBeVisible();
  await browserExpect(
    page.getByText("BW × 6 · RIR 2", { exact: true }),
  ).toBeVisible();
  await browserExpect(page.getByText("Working Volume: N/A")).toBeVisible();
  await select.selectOption(definitions[2].id);
  await browserExpect(
    page.getByRole("heading", { name: "Lowest Assistance" }),
  ).toBeVisible();
  await browserExpect(
    page.getByText("Assist 30.05 kg × 6 · RIR 2", { exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await browserExpect(
    page.getByRole("heading", { name: "Training Overview" }),
  ).toBeVisible();
  expect((await db.execution.history(userId)).length).toBe(3);
});
it("Progress empty/ineligible states, fresh no eligible state after correction and service error", async () => {
  await login();
  await page.goto(origin + "/progress");
  await browserExpect(
    page.getByText("No Finished workouts yet."),
  ).toBeVisible();
  await seed();
  const plan = (await db.app.activeProgram(userId))!;
  const active = (
    await db.workouts.start(userId, { templateId: plan.templates[0].id })
  ).session;
  const set = await db.execution.createSet(userId, active.exercises[0].id, {
    id: randomUUID(),
    type: "WORKING",
    loadKg: "80",
    reps: 12,
  });
  await db.execution.completeSet(userId, set.id);
  await db.execution.finish(userId, active.id, { timeZone: "UTC" });
  await page.getByRole("button", { name: "Refresh Progress" }).click();
  await page
    .getByLabel("Exercise", { exact: true })
    .selectOption(active.exercises[0].exerciseId);
  await browserExpect(
    page.getByText("No eligible data", { exact: true }),
  ).toBeVisible();
  await db.corrections.correct(userId, active.id, {
    expected_revision: 0,
    setDeletions: [set.id],
  });
  await page.getByRole("button", { name: "Refresh Progress" }).click();
  await browserExpect(
    page.getByText(/No eligible data for this Exercise/),
  ).toBeVisible();
  await browserExpect(
    page.getByText(/No eligible Exercise occurrences/),
  ).toBeVisible();
  unavailable = true;
  await page.getByRole("button", { name: "Refresh Progress" }).click();
  await browserExpect(page.getByRole("alert")).toBeVisible();
  await browserExpect(
    page.getByRole("heading", { name: "Training Overview" }),
  ).toHaveCount(0);
});
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
it("Progress missing browser timezone is a controlled error, never fallback counts", async () => {
  await login();
  await context.addInitScript(() => {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      return { ...original.call(this), timeZone: "" };
    };
  });
  await page.goto(origin + "/progress");
  await browserExpect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Could not determine your timezone. Progress is unavailable.",
  );
  await browserExpect(
    page.getByRole("heading", { name: "Training Overview" }),
  ).toHaveCount(0);
});
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
it("Previous Performance shows all working Sets and load semantics, survives Resume, and shares SESSION_ONLY history", async () => {
  await seed();
  const p = (await db.app.activeProgram(userId))!;
  const body = await db.app.createExercise(userId, {
    name: "Previous BW",
    loadType: "BODYWEIGHT",
  });
  const assist = await db.app.createExercise(userId, {
    name: "Previous assist",
    loadType: "ASSISTED_BODYWEIGHT",
  });
  const { session: historical } = await db.workouts.start(userId, {
    templateId: p.templates[0].id,
  });
  const bw = await db.execution.addExercise(userId, historical.id, {
    exerciseId: body.id,
  });
  const assisted = await db.execution.addExercise(userId, historical.id, {
    exerciseId: assist.id,
  });
  for (const [entry, loadKg, reps, rir] of [
    [historical.exercises[0], "80.12500000000000000001", 8, 2],
    [historical.exercises[0], "79", 7, null],
    [bw, null, 6, null],
    [assisted, "20.25", 9, 1],
  ] as const) {
    const s = await db.execution.createSet(userId, entry.id, {
      id: randomUUID(),
      type: "WORKING",
      loadKg,
      reps,
      rir,
    });
    await db.execution.completeSet(userId, s.id);
  }
  const warm = await db.execution.createSet(
    userId,
    historical.exercises[0].id,
    { id: randomUUID(), type: "WARM_UP", loadKg: "99", reps: 1 },
  );
  await db.execution.completeSet(userId, warm.id);
  const finished = await db.execution.finish(userId, historical.id, {
    timeZone: "Europe/Moscow",
  });
  await login();
  await startWorkout();
  const previous = page.getByRole("complementary", {
    name: "Previous performance",
  });
  await browserExpect(previous).toContainText(
    "80.12500000000000000001 kg × 8 · RIR 2",
  );
  await browserExpect(previous.locator("li")).toHaveText([
    "80.12500000000000000001 kg × 8 · RIR 2",
    "79 kg × 7",
  ]);
  await browserExpect(previous).toContainText(
    new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(finished.trainingDay + "T00:00:00Z")),
  );
  for (const id of [body.id, assist.id]) {
    await page
      .getByLabel("Session-only exercise", { exact: true })
      .selectOption(id);
    await page
      .getByRole("button", { name: "Add exercise", exact: true })
      .click();
    await browserExpect(page.locator("section.exercise")).toHaveCount(
      id === body.id ? 2 : 3,
    );
  }
  await browserExpect(previous.nth(1)).toContainText("BW × 6");
  await browserExpect(previous.nth(2)).toContainText(
    "Assist 20.25 kg × 9 · RIR 1",
  );
  await page.reload();
  await browserExpect(previous.nth(0)).toContainText("79 kg × 7");
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: "Resume Workout", exact: true }).click();
  await browserExpect(previous.nth(2)).toContainText(
    "Assist 20.25 kg × 9 · RIR 1",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/previous-performance-mobile.png",
    fullPage: true,
  });
});
it("Previous Performance is empty without eligible history and its failure leaves logging usable", async () => {
  await seed();
  await login();
  await startWorkout();
  await browserExpect(
    page.getByText("No previous performance", { exact: true }),
  ).toBeVisible();
  previousUnavailable = true;
  await page
    .getByRole("button", { name: "Refresh saved state", exact: true })
    .click();
  await browserExpect(
    page.getByText("Previous performance unavailable. You can keep logging."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add draft set", exact: true })
    .click();
  await browserExpect(
    page.getByRole("article", { name: "Set 1", exact: true }),
  ).toBeVisible();
  await page.getByLabel("External load (kg)", { exact: true }).fill("25.125");
  await page.getByLabel("Reps", { exact: true }).fill("8");
  await page.getByRole("button", { name: "Save values", exact: true }).click();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await browserExpect(
    page.getByText("Completed", { exact: true }),
  ).toBeVisible();
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
