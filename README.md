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

Implementation is now entering a controlled sequence of small reviewable slices.

The repository should not be interpreted as containing a complete or usable Fitness RPG product until the relevant implementation slices have actually been completed.

## Chosen stack

- Next.js App Router
- React
- TypeScript
- Drizzle ORM
- PostgreSQL
- Supabase PostgreSQL
- Supabase Auth
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

Setup and deployment instructions will be added only when they correspond to repository functionality that actually exists.

## Foundation development setup

Slice 1 provides a minimal application, server-side identity boundary and database readiness check.

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

Copy `.env.example` to `.env.local` and supply your project's `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY` and `DATABASE_URL` before checking external services.
These variables are server-side configuration. Do not use a Supabase secret or
service-role key in place of the publishable key.

In production, `DATABASE_URL` must point to a Supabase transaction-mode pooler
on port 6543. The application uses one connection per warm instance and enforces
TLS certificate validation. Leave SSL query parameters out of the URL so they
cannot override the pool's TLS configuration. node-postgres queries are unnamed;
no persistent prepared statements are required.
Both shared and dedicated transaction poolers are supported. If the server
certificate requires a project root, set `DATABASE_SSL_CA` to the PEM certificate
downloaded from Supabase Database settings (literal `\n` escapes are accepted).

Foundation endpoints:

- `GET /api/health`: application liveness, independent of external credentials.
- `GET /api/ready`: database readiness; returns a safe 503 when unavailable.
- `GET /api/foundation/me`: verifies cookie-based Supabase identity, then checks
  database readiness through the application boundary and Drizzle. Returns 401
  without an authenticated session and a safe 503 for configuration failures.

The identity endpoint can refresh cookies in its Route Handler. No login UI or
authenticated Server Component flow is implemented yet.

Drizzle schema declarations are located in `src/server/db/schema.ts`; the
configured migration output directory is `drizzle/`. Slice 2 adds only the four
planning tables and their migrations. Migration tooling uses a separate
`MIGRATION_DATABASE_URL` for a trusted tooling connection; application runtime
never reads it. No external migration command has been executed.

Unit tests use adapters and mocks. Live Supabase Auth and PostgreSQL integration
must be verified separately with project credentials.

## Training planning developer workflow

Planning is available through authenticated server APIs. No planning UI or
workout execution is implemented. All payloads use camelCase; ownership comes
from the verified Supabase identity, never from request payloads.

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
Supabase networking/TLS or concurrent connections across server instances.

External migration application remains unverified because database credentials
are unavailable. Use `MIGRATION_DATABASE_URL` only for a reviewed, trusted
non-production migration workflow. Planning tables enable RLS and revoke browser
role grants; the server DB role must have trusted table privileges and RLS bypass
(or table ownership). Direct browser table access is intentionally unavailable.
No built-in catalog seed is included.


---
