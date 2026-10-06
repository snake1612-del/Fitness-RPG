# Fitness RPG

Fitness RPG is a mobile-first web application for gym resistance training.

The product is designed as a serious workout tracker first, with lightweight RPG-style progression layered on top.

## Product goal

The core product loop is:

```text
Program
→ Workout
→ Log Sets
→ Finish Workout
→ History
→ Progress
→ XP
→ Character
→ Next Workout
```

The MVP focuses on gym resistance training and tracks performed Sets using load where applicable, reps and optional RIR.

## Current status

The MVP v0.1 product, Training, Gamification and Architecture semantics have completed documentation freeze.

The first usable workout, repeatable workout flow, Finished Session corrections
and Previous Performance are implemented through reviewed slices.

LOCAL uses plain Docker PostgreSQL 17 with Better Auth and Next.js. The hosted
Neon Pilot has passed real Auth, PostgreSQL and browser acceptance, including
cold wake. Progress Foundation has passed independent review, LOCAL and hosted
acceptance. XP & Level Foundation has passed LOCAL acceptance and is ready for
independent review; Character remains later work.

## Chosen stack

- Next.js App Router
- React
- TypeScript
- Drizzle ORM
- PostgreSQL 17 (plain Docker LOCAL; Neon HOSTED)
- Self-hosted Better Auth inside Next.js
- Vercel

Architecture style:

```text
Next.js modular monolith
```

## Documentation

Canonical project specifications:

- [`docs/DECISIONS.md`](docs/DECISIONS.md) — durable project decisions
- [`docs/TRAINING.md`](docs/TRAINING.md) — Training Model v0.1
- [`docs/GAMIFICATION.md`](docs/GAMIFICATION.md) — Gamification Model v0.1
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Architecture & Data Model v0.1

When implementation behavior conflicts with these documents, the conflict should be resolved explicitly rather than silently introducing a new product or architecture decision.

## Development phase

Current phase:

```text
Documentation Freeze v0.1
→ Controlled MVP Implementation
```

Implementation should proceed through small vertical slices rather than attempting the full workout loop in one PR.

Current local setup and hosted runtime boundaries are documented below.

## Foundation development setup

For the current Docker Desktop + plain PostgreSQL 17 workflow, see
[`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md).
LOCAL and the hosted Fitness RPG Pilot are separate environments.

The application provides a server-side identity boundary and database readiness
check in addition to Planning, Workout and History UI.

Use Node.js 22.13+ (22.x), 24.x or 26+ and pnpm 11.25.0. Validation was performed with Node.js 24.19.0.

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm db:check
pnpm build
pnpm start
```

Copy `.env.example` to an uncommitted environment file for hosted configuration.
Supply server-only BETTER_AUTH_URL (exact HTTPS origin), BETTER_AUTH_SECRET and
DATABASE_URL. For LOCAL use the guarded wrappers in docs/LOCAL_DEVELOPMENT.md.
Production requires only these three server environment variables. Keep
Production credentials out of Preview, Development and LOCAL. Supabase variables
and its legacy CA are not used by the current hosted runtime.

The provider-neutral pg pool retains one connection per warm instance, unnamed
queries and verified TLS (rejectUnauthorized=true), using the Neon pooled
PostgreSQL endpoint in HOSTED. Safe sslmode=require/verify-full intent is stripped before pg;
other URL driver overrides are rejected. Optional DATABASE_SSL_CA supplies a trusted
PEM root (literal backslash-n escapes accepted). LOCAL_DEV alone permits loopback
plaintext development; it is rejected in production.

Foundation endpoints:

- `GET /api/health`: application liveness, independent of external credentials.
- `GET /api/ready`: database readiness; returns a safe 503 when unavailable.
- `GET /api/foundation/me`: verifies a validated Better Auth database session UUID, then checks
  database readiness through the application boundary and Drizzle. Returns 401
  without an authenticated session and a safe 503 for configuration failures.

Identity remains behind AuthIdentityProvider; login/logout use the Better Auth HTTP
handler with same-origin protection and forwarded cookies. No private Server
Component response is cached.

Drizzle schema declarations are located in `src/server/db/schema.ts`; the
configured migration output directory is `drizzle/`. Canonical migrations
0000–0008 are applied and verified on LOCAL PostgreSQL and the hosted Neon Pilot.
Migration tooling uses a separate `MIGRATION_DATABASE_URL` for a trusted direct,
unpooled connection; application runtime never reads it and it is never added to
Vercel. Runtime, including Better Auth, never auto-migrates.

Unit and browser fixtures use adapters/mocks or PGlite. They complement the
accepted real LOCAL and hosted Better Auth/PostgreSQL checks, not replace them.

## Training planning developer workflow

Planning is available through `/setup` and authenticated server APIs. All payloads use camelCase; ownership comes
from the verified application identity, never from request payloads.

| Method | Endpoint | Capability |
| --- | --- | --- |
| GET / POST | `/api/exercises` | Available catalog / create custom Exercise |
| GET / PATCH | `/api/exercises/:id` | Read / rename or archive own custom Exercise |
| GET / POST | `/api/programs` | Own Programs / create Program with first Template |
| GET | `/api/programs/active` | Full ordered Active Program, or explicit `null` |
| GET / PATCH | `/api/programs/:id` | Full ordered plan / rename |
| POST | `/api/programs/:id/activate` | Atomic activation |
| POST | `/api/programs/:id/templates` | Append Template |
| POST | `/api/programs/:id/templates/reorder` | Reorder Templates |
| PATCH | `/api/templates/:id` | Rename Template |
| POST | `/api/templates/:id/exercises` | Append planned Exercise entry |
| POST | `/api/templates/:id/exercises/reorder` | Reorder planned entries |
| PATCH | `/api/template-exercises/:id` | Update targets/notes |

Create an Exercise with `{ "name": "Press", "loadType": "WEIGHTED" }`.
Program creation requires `{ "name": "Plan", "initialTemplate": { "name": "A" } }`;
the initial Template may also contain an `exercises` array. Templates may initially
contain zero entries, but a persisted Program always has at least one Template.

Entry creation requires `exerciseId`, `targetWorkingSets`, `targetRepsMin` and
`targetRepsMax`. Optional fields are `targetLoadKg`, `targetRir`,
`targetRestSeconds` and `notes`. Target kg must be a decimal **string**, for
example `"72.5"`; optional fields may be `null`. BODYWEIGHT accepts no target
load; ASSISTED_BODYWEIGHT interprets positive target kg as assistance.
Rest uses non-negative integer seconds. PATCH on an entry accepts partial
targets/notes. Exercise `loadType` is immutable; archive uses `{ "archived": true }`.

Reorder payloads are `{ "ids": ["...", "..."] }`, listing every current child
exactly once. Positions are assigned by the server and normalized to `0..n-1`
transactionally. Unknown payload fields (including ownership fields) are rejected.
Missing/foreign resources return 404; invalid input returns 400; unavailable
infrastructure returns a safe 503. All planning endpoints require cookie Auth.

`pnpm db:generate --name=training_planning` and `pnpm db:check` have been run.
The migrations in `drizzle/` are applied to an isolated in-memory PGlite
PostgreSQL engine during `pnpm test`, which exercises the production Drizzle
repository through a node-postgres-compatible test bridge. This checks schema,
constraints and persistence without project credentials. It does not verify
hosted networking/TLS or concurrent connections across server instances.

Hosted migration application and hashes/order have been verified on Neon.
Use `MIGRATION_DATABASE_URL` only through reviewed, trusted migration tooling.
Planning tables enable RLS and revoke browser
role grants; the server DB role must have trusted table privileges and RLS bypass
(or table ownership). Direct browser table access is intentionally unavailable.
No built-in catalog seed is included.

## Start and Resume developer workflow

Slice 3 adds relational `WorkoutSession` and `SessionExercise` snapshots.
Authenticated `POST /api/sessions/start` accepts `{ "templateId": "<uuid>" }`.
A new Start requires an owned Template in the current Active Program and returns
201 with `{ "session": { ... }, "resumed": false }`. If an ACTIVE Session already
exists, Start returns that saved Session with 200 and `resumed: true`, including
when a different valid Template ID is supplied.

`GET /api/sessions/active` returns the Session object directly, or JSON `null`
when no ACTIVE Session exists. The Session contains source
IDs and name snapshots, `status`, `startedAt`, `plannedWorkingSetQuota` (`P`) and
ordered `exercises`. Each entry contains the saved Exercise identity/name/load
type, `plannedWorkingSets`, rep range, exact decimal-string `targetLoadKg`,
nullable integer `targetRir`, rest and notes. Resume reads only these saved rows.
Later planning edits or Exercise archival do not change the snapshot or `P`.

Start and planning mutations share a user-scoped transaction advisory lock.
Session creation and all snapshot rows commit atomically; a partial unique index
allows at most one ACTIVE Session per user. A uniqueness race resumes the winning
Session after rollback. Database triggers freeze `P` and validate the initial
snapshot quota at commit. Empty Templates start with `P = 0`.

These endpoints require cookie Auth and reject ownership fields in payloads.
Unauthenticated requests return 401, malformed input 400, unavailable/foreign
Templates 404, controlled conflicts 409 and infrastructure failures a safe 503.
Responses are not cached. PR #4B provides the workout UI described below.
The execution and lifecycle APIs are described below.

Migrations `0002_workout_snapshot.sql` and `0003_workout_snapshot_integrity.sql`
add only the two snapshot tables and their integrity rules. They enable RLS and
revoke browser role access, including execution of the new SQL helpers. The
isolated PGlite tests cover snapshots, retry/race recovery, rollback and historical
independence. Real LOCAL PostgreSQL tests cover independent-connection behavior;
the hosted Neon Pilot separately verifies the deployed Auth/database path.

## Workout execution and lifecycle developer workflow

PR #4A adds actual/draft Sets, active corrections, Finish/Cancel and saved History.
All routes require the existing verified cookie identity and server-side ownership.

| Method | Endpoint | Capability |
| --- | --- | --- |
| POST | `/api/session-exercises/:id/sets` | Create/retry an actual draft Set |
| PATCH / DELETE | `/api/sets/:id` | Correct active values / remove an erroneous Set |
| POST | `/api/sets/:id/complete` | Explicitly complete a valid Set |
| POST | `/api/sets/:id/uncomplete` | Return a Set to draft |
| POST | `/api/sessions/:id/finish` | Accept a partial or full workout |
| POST | `/api/sessions/:id/cancel` | Cancel the attempt and release the ACTIVE slot |
| GET | `/api/sessions` | Finished History, newest original Finish order first |
| GET | `/api/sessions/:id` | Own Finished snapshot and actual Sets |

Create payload: `{ "id": "<client-generated-uuid>", "type": "WORKING",
"loadKg": "72.5", "reps": 8, "rir": null }`. Only `id` is required;
type defaults to WORKING and values may be null while draft. WARM_UP is supported.
Positions are assigned by the server. No planned placeholder Sets are created.
PATCH accepts only type/loadKg/reps/rir. Numeric inputs are exact decimal strings;
reps, when supplied, must be positive integers and RIR is nullable integer 0–10.

Create returns 201 with the saved Set, including on retry. Reusing that UUID for
the same entry returns the current Set without overwriting subsequent corrections.
Reusing it for a different entry or after deletion returns a controlled conflict.
Deletion retains a UUID tombstone (`deleted_at`) so delayed create retries cannot
resurrect removed Sets. Deleted Sets are excluded from Resume and History; their
positions are not reused. DELETE returns 204 and is idempotent while ACTIVE.

Values do not imply completion. Complete requires reps and, for WEIGHTED, a load
(zero is valid). BODYWEIGHT has no external load. ASSISTED_BODYWEIGHT requires
positive assistance. Validation uses only the saved SessionExercise load type.
Repeated Complete preserves the original completedAt. Active edits to completed
Sets must remain valid; uncomplete first to clear required values. All Set writes
require an owned ACTIVE Session; terminal Session writes return 409.

Finish accepts `{ "timeZone": "Europe/Moscow" }`, validated by Intl. It returns
the saved Session, freezing finishedAt, timezone, UTC offset in seconds, local
trainingDay and original finishOrder exactly once. finishOrder is a BIGINT
sequence represented as a JSON string, with no floating-point conversion.
Repeated Finish preserves that context even when a different valid timezone is
supplied. Drafts remain drafts; partial/empty Finish is valid. Cancel is retry-safe
and cannot convert a Finished Session. Finish cannot convert a Cancelled Session.

Resume now includes non-deleted actual Sets ordered inside each snapshot entry.
History uses only saved snapshot/Set facts. Its list returns Session headers;
detail returns the full aggregate. Cancelled/ACTIVE Sessions are excluded from
completed History (detail returns 404). History supplies the Finished facts used
by rotation, Previous Performance, derived Progress Foundation and XP & Level
Foundation. Character UI remains outside the current implementation.

Migrations `0004_workout_execution.sql` and
`0005_workout_execution_integrity.sql` add Set/lifecycle fields, the Finish order
sequence, checks/indexes, terminal-identity protection and active Set integrity.
New helpers and sequence revoke browser-role privileges. The trusted runtime role
needs sequence USAGE as well as table privileges/RLS bypass (or ownership).
Existing migration files
and frozen specifications are unchanged. PGlite tests cover these migrations and
production repositories, including route-handler composition, rollback and
snapshot-independent History. Real LOCAL independent-connection checks and
hosted Neon browser/runtime acceptance complement these fixture tests.

## First usable workout UI / pilot (PR #4B)

The mobile UI uses the Planning and Workout APIs. Later reviewed slices add
history-derived rotation, session-only Exercises, Skip/Undo, Finished corrections
and Previous Performance. Progress Foundation adds a read-only `/progress` screen;
XP & Level Foundation provides a derived read API; Character UI remains outside
the current implementation.

- `/login`: email/password login for an existing Better Auth account.
  `POST /api/auth/login` and `POST /api/auth/logout` use the Better Auth HTTP handler and forward cookies; credentials remain outside URLs. Auth actions require the
  same Origin and return no-store responses. API identity checks validate database sessions and return UUIDs. Pages contain only a public shell until
  the protected API read succeeds; no private Server Component data is cached.
- `/setup`: create custom exercises, create a Program with its first Template,
  activate a Program, add Templates and add Exercises with planned targets.
  The backend activates the first Program. Later Programs require activation.
- `/`: Start the derived Next Template from the Active Program, or Resume the
  existing saved ACTIVE Session.
- `/workout`: snapshot targets are separated from actual Sets. Add a draft,
  enter exact kg strings/reps/optional RIR, save values, then Complete explicitly.
  Active corrections, Uncomplete, warm-up type and confirmed deletion are supported.
  Bodyweight has no load field; assisted bodyweight labels the value as assistance.
- Finish and Cancel require confirmation. Finish accepts partial workouts and
  keeps drafts incomplete. Unsaved edits are explicitly disclosed in the
  confirmation. A finished result opens `/history/:id`; Cancel is not History.
- `/history` lists only Finished Sessions. Detail renders saved snapshots and
  actual Sets without performance analytics or XP.

Refresh/reload reads canonical server state. A synchronous submission lock avoids
duplicate clicks while saving. Draft creation persists a UUID in sessionStorage
scoped to user/Session/Exercise before transmission and retains it until the
saved state has been read. Retrying after a lost response or reload reconciles
that same Set. Deleting it clears any pending client retry identity.
Finish reconciles a lost response against saved History; other mutation errors
offer explicit refresh/retry without background resubmission. SessionStorage is
only a retry identity cache; this is not offline synchronization.

### Automated browser acceptance

Install the Chromium test browser once, then run against the production build:

```sh
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```

The E2E suite starts an isolated Next production server on port 3104 and renders
the actual UI at a 375px viewport. Playwright intercepts the API transport to
invoke real Route Handler exports, applications and Drizzle repositories against
PGlite with all migrations. Only external Auth identity is a fixture.
This does **not** exercise real Better Auth sessions, cookie issuance over HTTPS,
the deployed runtime or the transaction-mode pooler.

Coverage: login errors/logout/auth expiry, first-use with all three load types,
Start, exact decimal logging, draft/completed distinction, correction,
Uncomplete, deletion, reload/Resume, partial Finish with a remaining draft,
History/reload, lost create/Finish/Cancel responses, Cancel and service recovery.
Screenshots are written to ignored `test-results/`. `PLAYWRIGHT_CHANNEL` may
select an installed browser (for example `msedge`) instead of downloaded Chromium.

### Live pilot gate

**Hosted Neon Pilot acceptance: PASSED.** The live chain is Browser → Vercel /
Next.js → self-hosted Better Auth → Drizzle / pg → Neon pooled PostgreSQL 17.
Canonical migrations 0000–0008 and their hashes/order were verified. Acceptance
covered login/session recovery, exact decimal Set persistence, ACTIVE reload /
Resume, partial Finish, History, Cancel/rotation, session-only Exercises,
Skip/Undo, Previous Performance, Finished corrections and genuine cold wake.
The old Supabase Pilot is paused and retained only for rollback/archive purposes.

For a fresh hosted environment, configure the existing server environment
(`BETTER_AUTH_URL`, server-only `BETTER_AUTH_SECRET`, pooled `DATABASE_URL`,
and TLS CA where needed), apply migrations with trusted tooling, and provision a
pilot account through the trusted server-side Better Auth API. Public signup
remains disabled; registration/password recovery UI is
outside this minimal pilot flow.

For future hosted regression checks on the non-production HTTPS deployment, run:
login → create exercise/Program/Template/targets → Start → save and Complete Set
→ Finish → reload → open History. Also reload an ACTIVE workout and Resume,
then verify Cancel is excluded from completed History. Confirm the runtime
actually uses the configured pooled PostgreSQL endpoint. Record live
evidence separately; automated fixtures cannot mark this gate as passed.

---

## Progress Foundation developer workflow

`/progress` reads corrected canonical FINISHED history through authenticated
`GET /api/progress?timeZone=<IANA zone>&exerciseId=<optional UUID>`.
Identity is server-derived; foreign/no eligible Exercise data returns an empty
selection. Every response is `no-store`. There is no Progress ledger, migration,
cache or direct browser DB access; canonical migrations remain 0000–0008.

Overview counts all Finished Sessions, including zero-set workouts. Effective
today is the server instant's calendar date in the current browser IANA timezone.
Last 7/30 include today and the previous 6/29 calendar date labels. Missing or
unsupported zones produce validation errors, never a UTC/server-local fallback.
Historical `training_day` remains immutable, including after travel/corrections.

Exercise Progress uses stable Exercise IDs across PLANNED/SESSION_ONLY history;
archived historical definitions remain selectable. Only live completed WORKING
Sets in non-deleted Finished occurrences qualify. Ordering is original Finish
order, then deterministic Exercise/Set position; training day is calendar metadata.
Records retain the earliest historical achiever on ties. Latest shows every eligible Set and
Recent Trend selects the latest eight eligible occurrences.

WEIGHTED shows Highest Load, Best Epley e1RM, exact Working Volume and max reps
at exact loads present in Latest. e1RM uses reps 1–10, exact integer/rational
arithmetic and half-up rounding/comparison to 0.1 kg. BODYWEIGHT shows Max Reps;
ASSISTED shows Lowest Assistance (lower is better). Volume is N/A for both.
Corrections recompute the projection on the next read; editing remains in History.

Focused tests cover calendar/decimal boundaries, eligibility, ties, corrections,
SESSION_ONLY reassignment/deletion, last eight and ownership. `REAL_LOCAL_AUTH=true`
runs the same relational cases against isolated plain PostgreSQL 17 databases,
alongside real Better Auth integration. Hosted acceptance of this feature follows
independent review and merge; this PR does not deploy or change hosted resources.

## XP & Level Foundation developer workflow

Authenticated `GET /api/gamification` returns fresh/no-store `totalXp`, `level`,
`xpIntoLevel`, `xpForNextLevel` and `xpRemaining`. It consumes current corrected
FINISHED history without a timezone request, ledger, mutable counters or cache.
One grouped canonical read uses immutable Session `planned_working_set_quota`
for P and counts live completed WORKING Sets for W, including extra/SESSION_ONLY
work but excluding drafts, warm-ups and tombstones/deleted occurrences. P is
never reconstructed from current Planning or multiplied by actual Set joins.

C = min(W, P). P/C below two yields zero XP; otherwise 100*C/P is rounded to
multiples of five with exact integer-rational half-up arithmetic. Award allocation
uses saved training_day groups and original finish_order, with 100 XP/day cap.
Corrections recompute all same-day allocations on the next read; performance-only
edits remain neutral. Total XP and Level can decrease after canonical corrections.
Level requirements grow from 100 by 25 to a 500 cap, with no maximum Level.

Domain/internal application results include per-Session P/W/C/candidate/award
for tests; public API exposes only the bounded summary. Ownership comes from
Better Auth via AuthIdentityProvider. There is no Gamification UI, migration 0009
or new dependency; canonical migrations remain 0000–0008. Focused cases also run
on real LOCAL PostgreSQL with `REAL_LOCAL_AUTH=true`. Hosted XP acceptance follows
independent review and merge. Finished corrections do not add generic Uncomplete.
