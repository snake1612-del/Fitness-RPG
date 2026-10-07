# Fitness RPG — Decisions

**Status:** Frozen for MVP v0.1

This document is the concise register of durable product, training, gamification and architecture decisions.

Detailed normative specifications live in:

- `docs/TRAINING.md`
- `docs/GAMIFICATION.md`
- `docs/ARCHITECTURE.md`

This file intentionally does not duplicate those specifications.

---

## Product decisions

### P001 — Product identity

Fitness RPG is a mobile-first web application for gym resistance training.

The product is a serious workout tracker first and a gamified product second.

Gamification must not reduce the usefulness, clarity or correctness of workout tracking.

---

### P002 — Core product loop

The MVP core loop is:

```text
Program
→ Workout Template
→ Workout Session
→ Set logging
→ Finish Workout
→ History
→ Progress
→ XP
→ Character
→ Next Workout
```

---

### P003 — MVP training domain

The MVP training domain is gym resistance training.

The primary tracked set inputs are:

- load where applicable;
- reps;
- RIR.

Broader sports and endurance-programming domains are outside MVP scope.

---

### P004 — Mobile-first

The primary product experience is designed for mobile browsers.

Desktop support may exist, but does not determine the primary workout interaction model.

---

### P005 — Sports methodology is independent of gamification

Training semantics and progression are defined by the Training domain.

Gamification may consume Training facts but must not define exercise difficulty, training quality, progression rules or sports methodology.

---

### P006 — Workout rotation instead of calendar scheduling

MVP uses an ordered cyclic Workout Template rotation.

Calendar-based workout scheduling is Post-MVP.

---

### P007 — Deferred major product scope

The following are outside MVP v0.1 unless explicitly introduced by a later decision:

- social features;
- nutrition tracking;
- wearable integrations;
- AI coaching;
- calendar scheduling;
- leaderboards;
- quests;
- advanced character systems;
- inventory/equipment systems;
- unrelated major fitness domains.

---

# Training decisions

### T001 — Program is an ordered cyclic rotation

A Workout Program contains an ordered collection of Workout Templates.

The active Program determines the current workout rotation.

Rotation wraps after the final Template.

---

### T002 — Template is plan; Session is fact

A Workout Template represents planned training.

A Workout Session represents a historical workout fact.

Historical Sessions are not live views of the current Template.

---

### T003 — Start Workout creates a historical snapshot

Starting a workout creates a Workout Session and snapshots the relevant Template state into that Session.

Later Program, Template or Exercise changes must not retroactively change that Session.

---

### T004 — Partial Finished Sessions are valid

A Session may be finished without completing every planned Exercise or Working Set.

`FINISHED` means the user ended and accepted the workout as a historical training event, not that every planned target was achieved.

---

### T005 — Cancelled Sessions are not completed training

A `CANCELLED` Session:

- does not advance workout rotation;
- does not contribute to Progress;
- does not produce PRs;
- does not produce XP;
- is not treated as a completed workout.

---

### T006 — Working and Warm-up Sets

MVP has two Set types:

- `WORKING`;
- `WARM_UP`.

Only Working Sets participate in Working Set completion, PR and XP semantics unless a specification explicitly states otherwise.

---

### T007 — Set completion is explicit

Entering values into a Set does not by itself make the Set completed.

Completion is an explicit user action/state.

Only explicitly completed Sets are canonical completed training facts.

Finishing a Session does not implicitly complete draft Sets.

---

### T008 — RIR

RIR is optional.

When present it is an integer:

```text
0–10
```

Missing RIR does not make an otherwise valid completed Set invalid.

---

### T009 — Exercise load semantics

Every Exercise has one explicit load semantic:

- `WEIGHTED`;
- `BODYWEIGHT`;
- `ASSISTED_BODYWEIGHT`.

`WEIGHTED` records external load.

`BODYWEIGHT` does not use an external load value in the basic bodyweight form.

`ASSISTED_BODYWEIGHT` records assistance; lower assistance represents greater performed difficulty.

The relevant load semantic is preserved in historical Session snapshots.

---

### T010 — Session-only Exercises are allowed

A user may add an Exercise to an active Workout Session even if it was not part of the source Template.

It becomes part of that historical Session without modifying the source Template.

---

### T011 — Finished Session editing is allowed

Finished Sessions may be edited without reopening them into `ACTIVE`.

Derived Progress, PR and XP values must reflect the current canonical contents of the Finished Session after such edits.

---

### T012 — Previous Performance

Previous Performance for an Exercise is derived from the latest prior Finished Session containing completed Working Sets for the same Exercise.

Cancelled Sessions and draft Sets do not qualify.

---

### T013 — PR semantics

PRs are derived only from completed Working Sets in Finished Sessions.

For `WEIGHTED` Exercises MVP supports:

- highest load;
- best reps at a given load;
- estimated 1RM using Epley for sets of 1–10 reps.

For `BODYWEIGHT` Exercises MVP uses maximum completed reps.

For `ASSISTED_BODYWEIGHT` Exercises MVP uses lowest completed assistance.

Warm-up Sets do not create PRs.

There is no separate generic “Best Set” or volume PR in MVP.

---

### T014 — MVP Progress metrics

MVP Progress is derived from Training history and includes:

- Exercise performance history;
- estimated 1RM trend where applicable;
- weighted Working Set volume;
- completed-workout consistency.

Progress is derived rather than treated as new canonical Training input.

---

# Gamification decisions

### G001 — XP source

MVP XP comes only from Finished Workout Sessions.

Cancelled Sessions produce zero XP.

---

### G002 — Planned quota `P`

`P` is the planned Working Set quota frozen in the Workout Session snapshot at Start Workout.

`P` is immutable for that Session.

Session-only Exercises do not increase `P`.

---

### G003 — Completed Working Sets `W`

`W` is the number of all currently completed Working Sets in the Finished Session.

`W` includes completed Working Sets from:

- originally planned Exercises;
- extra Sets;
- session-only Exercises.

Warm-up and incomplete Sets do not count.

---

### G004 — Credited Sets `C`

```text
C = min(W, P)
```

Extra completed Working Sets cannot produce credit above `P`.

---

### G005 — XP eligibility

If:

```text
P < 2
```

or:

```text
C < 2
```

then:

```text
Session XP = 0
```

---

### G006 — Candidate Session XP

For an eligible Session:

```text
Candidate XP = 100 × C / P
```

Candidate XP is rounded to the nearest 5 XP.

An exact halfway value rounds upward.

Maximum Candidate XP is:

```text
100 XP / Session
```

---

### G007 — Stable training-day cap

Training-based XP is capped at:

```text
100 XP / stable training day
```

Multiple Finished Sessions on the same stable training day share that cap.

Allocation is deterministic using original Finish order.

---

### G008 — Performance neutrality

The following do not increase XP:

- weight;
- reps;
- RIR;
- volume;
- workout duration;
- PR;
- Exercise choice;
- Exercise difficulty.

XP measures completion against the frozen planned quota, not athletic performance.

---

### G009 — Warm-up and PR reward

Warm-up Sets produce zero XP.

PRs produce zero additional XP.

---

### G010 — No streak or weekly XP

MVP has:

- no streak XP;
- no weekly XP bonuses.

---

### G011 — Finished Session edits recalculate XP

Edits to a Finished Session recalculate XP when they affect canonical completion facts.

Examples include:

- adding or deleting a completed Working Set;
- changing `WORKING ↔ WARM_UP`;
- changing completion state.

Changing only weight, reps or RIR does not independently increase XP.

---

### G012 — XP is idempotent and rebuildable

Finishing, retrying or reloading the same Session must not create duplicate XP.

Session XP, daily allocation, Total XP and Level are recalculable from canonical facts.

XP is not an append-only immutable reward ledger.

---

### G013 — Level curve

Level 1 begins at 0 Total XP.

XP required to advance from Level `L` is:

```text
XP_next(L) = min(100 + 25 × (L - 1), 500)
```

There is no MVP maximum Level.

---

### G014 — Character v0.1

Character v0.1 contains:

- Character visual;
- current Level;
- XP progress;
- progress toward next Level;
- visual progression milestones.

Initial visual milestone Levels are:

```text
1, 3, 5, 10, 20
```

---

### G015 — Post-MVP character systems

The following are Post-MVP:

- Character Stats;
- formal Achievements;
- inventory;
- equipment;
- skins;
- classes;
- talent trees;
- quests;
- leaderboards.

---

# Architecture decisions

## A001 — Next.js Modular Monolith

Fitness RPG MVP uses a Next.js App Router modular monolith.

Domain logic must not be placed directly in React components or Route Handlers.

---

## A002 — PostgreSQL, Self-hosted Authentication and Runtime DB Boundary

The approved platform is:

- PostgreSQL 17 as the canonical database;
- Neon PostgreSQL for HOSTED;
- plain Docker PostgreSQL 17 for LOCAL;
- self-hosted Better Auth inside Next.js;
- AuthIdentityProvider as the durable application identity boundary;
- Vercel runtime;
- Drizzle ORM + pg.

Production runtime database path:

```text
Vercel
→ Next.js application / AuthIdentityProvider
→ Better Auth
→ Drizzle / pg small application DB pool
→ verified TLS
→ Neon pooled endpoint (transaction mode)
→ PostgreSQL 17
```

Prepared statements must not be used where they are incompatible with transaction pooling.

Hosted migrations use a direct/unpooled connection through trusted local tooling.
`MIGRATION_DATABASE_URL` is not a runtime variable and is never placed in Vercel.
Repository Drizzle migrations own schema history; runtime does not auto-migrate.

Better Auth persistence uses permanent `better_auth.*`; Training stays `public.*`.
Better Auth `user.id` is a UUID used directly for Training ownership, without an
identity mapping table, ID translation or Training FK into Auth tables.

Production database/Auth secrets are server-only and scoped only to Production.
Preview and Development do not receive Production database credentials.

The browser does not write Training tables directly.

Hosted Neon Pilot acceptance has passed. This accepted architecture supersedes
the original Supabase PostgreSQL/Auth choice; the old Supabase Pilot is retained
as paused rollback/archive infrastructure, not an application dependency.

---

## A003 — Domain Dependency Direction

Training is the canonical primary domain.

Progress and Gamification are derived modules.

Training must not depend on Gamification.

---

## A004 — Relational Workout Session Snapshot

At Start Workout, Template state required for historical execution is copied into relational Workout Session / SessionExercise snapshot data.

Historical Sessions do not depend on later live Template state.

---

## A005 — Immutable Planned XP Quota

`P`, the planned Working Set quota used by Gamification, is fixed at Start Workout.

It is immutable for the lifetime of the Session.

---

## A006 — Explicit Exercise Load Semantics

Exercise load semantics are explicit:

- `WEIGHTED`;
- `BODYWEIGHT`;
- `ASSISTED_BODYWEIGHT`.

The applicable semantic is snapshotted in SessionExercise.

---

## A007 — Actual WorkoutSet Model

The database does not create persisted planned placeholder Sets.

WorkoutSet represents an actual user-created or draft Set.

RIR is nullable integer `0–10`.

---

## A008 — Single Active Workout Session

A user may have at most one `ACTIVE` Workout Session.

This is enforced through application logic and a database invariant.

---

## A009 — Workout Session State Machine

Allowed terminal transitions are only:

```text
ACTIVE → FINISHED
ACTIVE → CANCELLED
```

A Finished Session may be edited without reopening it.

---

## A010 — History-derived Workout Rotation

Next Workout is derived from:

- Finished Session history;
- current active Program ordering.

There is no mutable persisted rotation pointer.

---

## A011 — Progress as Derived Read Model

PR, estimated 1RM, volume, consistency and Previous Performance are derived from canonical Training facts.

MVP does not require persisted aggregate Progress state.

---

## A012 — Recalculable XP

`P` is the canonical frozen input.

`W`, `C`, Candidate XP, awarded Session XP, Total XP and Level are derived/recalculable state.

XP is not an immutable ledger.

---

## A013 — Stable Training Day

The first successful Finish records stable historical Finish context including:

- UTC Finish timestamp;
- timezone;
- UTC offset;
- local training day;
- original Finish order.

Historical training day is not recalculated after later timezone changes.

---

## A014 — REST-oriented HTTP API

HTTP interfaces use Next.js Route Handlers with explicit resource/domain actions.

MVP does not use GraphQL or a generic RPC abstraction.

---

## A015 — Exact Canonical Load Storage

Canonical load and assistance values use exact decimal storage in kilograms.

`kg` and `lb` are presentation/input units.

Unit conversion must not change canonical meaning or introduce floating-point canonical storage.

---

## A016 — Historical Independence and Active Program Integrity

Program and Template edits or deletion must not mutate historical Session snapshots.

A user may have at most one Active Program.

Program activation is atomic and backed by a database uniqueness invariant.

---

## A017 — Idempotent Workout Mutations

Retry-sensitive workout mutations must be safe against duplicate canonical facts.

This includes:

- Set creation;
- Set completion;
- Start Workout;
- Finish Workout.

Retries must not produce duplicate Sets, Sessions or XP.

---
