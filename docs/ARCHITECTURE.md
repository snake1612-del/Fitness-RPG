# Fitness RPG — Architecture & Data Model v0.1

**Status:** Frozen  
**Scope:** MVP v0.1

## Current runtime baseline

Application Auth is self-hosted Better Auth inside Next.js. AuthIdentityProvider
validates a database session and exposes only the UUID. Auth persistence uses
permanent better_auth.*; Training stays public.*, without Auth FK, mapping or
ID translation. LOCAL uses plain Docker PostgreSQL 17, Better Auth and Next.js.
Supabase is no longer a LOCAL dependency; old local volumes are retained as
rollback/debug residue. HOSTED uses Neon PostgreSQL 17 with Vercel unchanged.
The hosted Neon Pilot has passed real Auth, PostgreSQL and browser acceptance.
Drizzle + pg, verified TLS, small pool and Training transactions remain.
Canonical migrations 0000–0008 own schema history; 0008 owns Auth DDL.
Runtime never auto-migrates. The former Supabase backend is superseded and is
retained only as paused rollback/archive infrastructure, outside the live path.

This document defines the approved implementation architecture.

It does not redefine Training or Gamification semantics.

---

## 1. Architecture style

Fitness RPG MVP is a:

```text
Next.js App Router modular monolith
```

High-level runtime:

```text
Mobile-first Browser
        ↓ HTTPS
Next.js / Vercel
 ├─ React UI
 ├─ Route Handlers
 ├─ Application layer
 ├─ Training module
 ├─ Progress module
 └─ Gamification module
        ↓
Application / AuthIdentityProvider
        ↓
Better Auth (self-hosted inside Next.js)
        ↓
Drizzle ORM / pg
        ↓ verified TLS / pooled endpoint
Neon PostgreSQL 17
```

LOCAL runtime:

```text
Browser
→ Next.js localhost
→ application / AuthIdentityProvider
→ Better Auth
→ Drizzle / pg
→ plain Docker PostgreSQL 17
```

There is no separate backend service in MVP.

---

## 2. Technology stack

### Application

- Next.js App Router
- React
- TypeScript

### Persistence

- PostgreSQL 17
- Neon PostgreSQL for HOSTED; plain Docker PostgreSQL for LOCAL
- Drizzle ORM + pg

### Authentication

- Self-hosted Better Auth 1.7.7 inside Next.js
- Permanent `better_auth.*` persistence; UUID user identity
- AuthIdentityProvider is the durable application identity boundary

### Runtime / deployment

- Vercel

---

## 3. Application boundaries

React components handle presentation and interaction.

Route Handlers are HTTP adapters.

Domain logic belongs in application/domain modules rather than directly in:

- React components;
- `route.ts` handlers;
- database adapters.

Conceptual flow:

```text
UI
→ Route Handler
→ Application use case
→ Domain logic
→ Repository / Drizzle
→ PostgreSQL
```

---

## 4. Domain dependency direction

Training is canonical.

```text
Training
   ↓
Progress

Training
   ↓
Gamification
```

Progress and Gamification may consume Training facts.

Training must not depend on either.

Gamification must not redefine Training methodology.

---

## 5. Conceptual entities

MVP Training persistence is based around:

```text
Exercise
Program
WorkoutTemplate
TemplateExercise
WorkoutSession
SessionExercise
WorkoutSet
```

Authentication identity comes from a validated Better Auth database session
through AuthIdentityProvider. Better Auth `user.id` is a UUID used directly for
Training ownership; no mapping table, ID translation or Training → Auth FK exists.

---

## 6. Exercise

Exercise contains the stable identity and load semantics required by Training.

Conceptually relevant state includes:

- identity;
- name;
- load semantic;
- built-in or user-owned/custom status;
- archived state where applicable.

Load semantic is explicit:

```text
WEIGHTED
BODYWEIGHT
ASSISTED_BODYWEIGHT
```

A custom Exercise already required by historical data must not be destructively removed in a way that invalidates that history.

Archival is preferred when historical references require preservation.

---

## 7. Program

Program is user-owned planning state.

Conceptually it contains:

- identity;
- user ownership;
- name;
- active state.

A user may have at most one Active Program.

Activation must be atomic.

The database must enforce the single-active-Program invariant in addition to application checks.

---

## 8. WorkoutTemplate

A WorkoutTemplate belongs to a Program.

Its ordering within the Program determines cyclic workout rotation.

Template planning data is mutable.

Mutating it affects future Sessions only.

---

## 9. TemplateExercise

TemplateExercise represents one ordered Exercise entry in a Template.

Conceptually it contains:

- Exercise reference;
- position/order;
- target Working Set count;
- target rep range;
- optional target load;
- optional target RIR;
- optional rest target;
- optional notes.

It represents planning state, not performed Sets.

---

## 10. WorkoutSession

WorkoutSession is the historical workout aggregate.

Conceptually relevant state includes:

- user ownership;
- optional source Program/Template references;
- source names or required snapshot labels;
- status;
- Start/Finish lifecycle timestamps;
- immutable planned quota `P`;
- stable training-day metadata after first Finish;
- original Finish order.

Historical meaning must survive source planning changes or deletion.

---

## 11. SessionExercise

SessionExercise is a relational snapshot of one Exercise inside a Session.

It preserves the information required to interpret the Session independently of the current Template or Exercise definition.

Conceptually this includes:

- Exercise identity/reference where still available;
- Exercise name snapshot where needed;
- Exercise order;
- load semantic snapshot;
- planned targets;
- origin.

Exercise origin distinguishes at least:

```text
PLANNED
SESSION_ONLY
```

Session-only Exercise planned quota is zero for `P`.

---

## 12. WorkoutSet

WorkoutSet represents an actual user-entered Set.

It is never a generated planned placeholder.

Conceptually relevant state includes:

- SessionExercise;
- stable position/order;
- Set type;
- load or assistance where applicable;
- reps;
- nullable RIR;
- explicit completion state/time.

Set types:

```text
WORKING
WARM_UP
```

RIR is:

```text
nullable integer 0–10
```

---

## 13. Snapshot boundary

Start Workout performs a transactional historical snapshot.

Template planning rows needed for execution are copied into Session/SessionExercise state.

After Start:

- Template edits do not alter Session Exercises;
- Program edits do not alter the Session;
- Exercise definition changes do not reinterpret historical load semantics;
- `P` does not change.

---

## 14. No planned WorkoutSet placeholders

Planned Working Set counts belong to Template/SessionExercise planning data.

They must not be materialized as fake persisted WorkoutSets at Start.

WorkoutSet exists only when actual Set interaction creates one.

This keeps:

```text
plan ≠ fact
```

---

## 15. Active Session invariant

A user may have at most one:

```text
ACTIVE WorkoutSession
```

The invariant must be protected by:

- application logic;
- database-level uniqueness.

Start Workout must therefore be retry-safe and race-safe.

---

## 16. Session state machine

Allowed transitions:

```text
ACTIVE → FINISHED
ACTIVE → CANCELLED
```

No other state transition is part of MVP.

Editing a Finished Session does not reopen it.

---

## 17. History-derived workout rotation

No mutable `next_template_id` or rotation pointer is canonical.

The next Template is derived from:

- active Program;
- Program Template ordering;
- Finished Session history.

Cancelled Sessions are ignored.

If no relevant Finished history exists, use the first Template.

If the most recently Finished source Template exists in the active Program, select its successor and wrap cyclically.

If it no longer exists in the current Program, fall back to the first Template.

---

## 18. Progress architecture

Progress is a derived read model over Training facts.

Examples:

- Previous Performance;
- PR;
- estimated 1RM;
- weighted Working volume;
- consistency.

MVP does not require persisted aggregate Progress tables as canonical state.

Derived values may be calculated on read or through non-canonical optimizations later without changing their semantics.

---

## 19. Gamification architecture

Gamification consumes Finished Training facts.

Canonical frozen input:

```text
P
```

Derived:

```text
W
C
Candidate XP
awarded Session XP
Total XP
Level
Character progress
```

XP is rebuildable.

MVP does not require an immutable XP ledger.

---

## 20. Stable training day

At the first successful Finish, the system freezes the historical Finish context required for deterministic daily XP.

This includes:

- UTC Finish timestamp;
- timezone;
- UTC offset;
- local training day;
- original Finish order.

Later changes to the user's current timezone must not relocate historical Sessions between training days.

Finished Session content may be edited, but this stable Finish identity remains fixed.

---

## 21. Daily XP recalculation

Finished Session edits may affect Candidate XP.

When this happens, XP allocation for the affected stable training day is recalculated in immutable original Finish order.

The result must remain deterministic and must respect:

```text
≤ 100 training XP / training day
```

---

## 22. HTTP API style

MVP uses REST-oriented Route Handlers with explicit actions/resources.

Examples of architectural style:

```text
Programs
Templates
Sessions
Sets
Finish
Cancel
```

The implementation should prefer explicit use cases over a generic database CRUD transport.

MVP does not introduce:

- GraphQL;
- generic RPC.

---

## 23. Canonical units

Load and assistance are canonically stored in kilograms using exact decimal numeric representation.

User-facing input/display may be:

```text
kg
lb
```

Conversions occur at the application boundary.

Canonical Training calculations must not rely on binary floating-point values for load.

---

## 24. Production database boundary

Production path:

```text
Vercel runtime
→ Drizzle / pg small application DB pool
→ verified TLS
→ Neon pooled endpoint (transaction mode)
→ PostgreSQL 17
```

The runtime configuration must be compatible with transaction pooling.

Runtime uses unnamed queries and one pooled connection per warm instance.
Named prepared statements must not be introduced where incompatible with
transaction pooling. TLS certificate validation remains enabled.

---

## 25. Direct database access

Direct database connections are for trusted tooling such as:

- migrations;
- administration;
- controlled development workflows.

They are not the normal application runtime path.

Hosted migrations use the direct/unpooled Neon endpoint through trusted local
tooling and `MIGRATION_DATABASE_URL`. Repository Drizzle history is canonical;
Better Auth generation tooling may generate schema, but runtime does not apply
DDL. `MIGRATION_DATABASE_URL` is never configured in Vercel.

Production has server-only `DATABASE_URL`, `BETTER_AUTH_URL` and
`BETTER_AUTH_SECRET`. Production database credentials are not shared with Preview
or Development. Public signup is disabled; pilot accounts use trusted server-side
Better Auth bootstrap. LOCAL_DEV is restricted to loopback development.

---

## 26. Browser data-access boundary

The browser does not directly write Training tables.

Training writes flow through the application server boundary.

Better Auth handles login/logout/session inside Next.js. The browser uses
same-origin HTTP APIs and cookies; it receives no database credentials and has
no direct database access.

---

## 27. Historical independence

Planning deletion must not invalidate historical Sessions.

Deleting or editing:

- Program;
- Template;
- TemplateExercise;

must not mutate historical Session snapshots.

Historical source references may therefore be optional/non-owning once their source planning object no longer exists.

---

## 28. Exercise lifecycle

If deleting a custom Exercise would invalidate historical references or future interpretation, it must instead remain historically identifiable, for example through archival and Session snapshot data.

Historical records are more important than destructive cleanup of planning/catalog entities.

---

## 29. Active Program integrity

At most one Program is Active per user.

Program activation is treated as one atomic operation:

```text
deactivate previous
+ activate selected
```

The database must protect against concurrent requests leaving multiple active Programs.

---

## 30. Idempotent mutations

Retry-sensitive canonical mutations must be idempotent.

At minimum:

- Start Workout;
- Set creation;
- Set completion;
- Finish Workout.

A network retry or repeated request must not produce:

- duplicate WorkoutSessions;
- duplicate Sets;
- duplicate completion events;
- duplicate XP.

The implementation mechanism may vary, but the resulting domain behavior is mandatory.

---

## 31. Canonical vs derived summary

Canonical planning state:

```text
Exercise
Program
WorkoutTemplate
TemplateExercise
```

Canonical historical Training state:

```text
WorkoutSession snapshot
SessionExercise snapshot
WorkoutSet facts
stable Finish metadata
P
```

Derived state:

```text
Next Workout
Previous Performance
PR
e1RM
volume
consistency
W
C
Candidate XP
awarded XP
Total XP
Level
Character progress
```

Derived state must always remain reconstructable from the appropriate canonical facts.

---
