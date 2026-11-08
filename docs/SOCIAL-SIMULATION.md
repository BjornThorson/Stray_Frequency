# Stray Frequency: NPC social simulation

The system has a **small, real gameplay integration** for the first merchant
greeting. The wider social simulation (memories, gossip, NPC behaviour) remains
a standalone prototype, and its numbers are provisional balancing values.

The early stages below form a chronological implementation record; historical
statements about changes *not yet being deployed* describe those stages at the
time they were written. The current backend rollout is recorded at the end.
The official design scope remains [NPC social simulation](../BACKLOG.md).

## Implemented Stage A: relationships and perception

- `SRC/core/social-types.ts`: social identities, traits, events, observations,
  directional relationship contracts.
- `SRC/data/social-rules.ts`: sample event rules, role-specific changes, value
  bounds and prototype personality weights.
- `SRC/systems/social.ts`: pure event-to-relationship processing, with
  observer-specific idempotency and no automatic universal awareness.

Relationship axes are familiarity, warmth, trust, reliability, respect,
discretion, fear and indebtedness. A's feelings towards B are independent of
B's feelings towards A. Relationships are not friendship levels and do not
grant access or override authored personal boundaries.

## Implemented Stage B, part 1: memory and imperfect knowledge

- `SRC/core/social-cognition-types.ts`: event accounts, local beliefs,
  landmark memories, compact routine history, gossip inputs.
- `SRC/systems/social-cognition.ts`: direct witnessing, explicitly relayed
  rumours, deliberate mistakes in retelling, competing accounts, corrections,
  routine summaries and landmark retention.

An event has an authoritative identity but **each observer has their own
account** of what happened. A character only learns about an event after they
witness it or are explicitly told about it. Gossip can be passed along by NPCs
without ever involving the player. The `retoldAs` option is an explicit
simulation/narrative input, not permission for a browser to declare game facts.

A direct account is considered stronger than an indirect account. More
confident reports can change an opinion. A messenger who later corrects their
own account can revise the listener's belief. Conflicting stories are
preserved as competing accounts, with a contested flag; a currently preferred
belief is not equivalent to objective truth.

Corrections **rebuild the relationship projection** from each observer's
currently preferred account of each event. This is deliberately simple and
deterministic for the small Stage B prototype. It means an inaccurate,
superseded report no longer leaves behind an unjustified fear or trust penalty.
It is **not** a scalable production implementation; reprocessing all beliefs
after each update becomes expensive as the simulated world grows.

Ordinary witnessed conversations add to compact routine histories.
Meaningful non-routine events create individual landmark memories. At most
24 ordinary landmarks are kept per observer in this prototype. Severe threats
directly experienced by the target are protected and are never silently
discarded by that 24-memory cap. The number of protected memories and the
underlying belief/event ledger are **not yet bounded**: production requires
archival, compaction and durable storage design.

## Validation

Run `npm test` (Node.js 22+) to exercise the independent social model and
`npm run build` for the existing TypeScript/Vite production build. Tests
cover directional opinions, independent NPC/NPC history, gossip isolation,
false rumours, multi-hop retelling, corrections, testimony retractions,
bounded ordinary memories, idempotency and immutable JSON-serialisable state.

## Important boundaries

- This is **not connected to gameplay or Supabase**. Existing production
  characters are unchanged. The pure engine does not validate world-line
  visibility, dialogue permissions, character schedules, quests or real
  witness proximity.
- This version has **no** continuous offscreen NPC interaction scheduler, AI,
  dialogue generator, live server action executor, background cron or automatic
  broadcasting of rumours. Pure social choices and interaction transitions are
  testable in isolation only.
- Events, social profiles, eyewitness status, messenger meetings and the
  permitted contents of reports must eventually be verified server-side.
  Browser-provided opinions, timestamps, event IDs and changes are never
  authoritative.
- Memory deletion is not equivalent to removing an event from the social
  knowledge ledger. The latter still drives relationship values until
  production compaction/reconciliation exists.
- Reputation, rumours and interpersonal feelings do not confer professional
  authorization: a character can be fond of a customer and still refuse entry
  to a restricted venue.

## Implemented Stage B, part 2: bounded social intention evaluation

- `SRC/core/social-behaviour-types.ts`: authored drives, explicit personal
  boundaries, weekly UTC activity windows, and social intention contracts.
- `SRC/systems/social-behaviour.ts`: resolves a character's scheduled location
  and activity, then proposes eligible actions when other characters are
  co-located: conversation, information sharing, off-duty invitation, or
  avoidance.
- `tests/social-behaviour.test.mjs`: focused, deterministic decision tests.

The evaluator uses directional perceptions and available knowledge. An invitation
requires sufficient familiarity and warmth, an outgoing disposition, both people
being off-duty, and permission under the initiator's authored boundaries.
Professional friendliness does not automatically imply personal affection.
An explicit no-contact boundary on **either** side prevents all approaches.
Afraid characters may choose to avoid someone they know well.

Only event IDs explicitly marked shareable by an authoritative caller are
eligible gossip proposals. A conflicting account makes a correction worth
proposing, but **a second equally credible rumour does not necessarily convince
the listener**. The actual transmission and reaction are separate operations.
Social contact decisions have a directional cooldown based on records of
previously completed interactions, which must be maintained by a later
authoritative executor.

Scheduling is deliberately coarse: day of week, UTC minute, location, activity.
There is no world simulation ticking continuously or persistent event queue.
No dialogue is generated and no social intention is automatically executed.
A candidate invitation is not a friendship declaration, reciprocal affection
or acceptance. A professional boundary, quest restriction or venue exclusion
must still be enforced by its own authoritative gameplay system.

**Known follow-up:** move beyond a simple priority ordering toward contextual
goals, social opportunity sampling and explicit responses/consent; introduce
world time and district-local schedule handling as needed. The pure evaluator
is intended to be run only when a genuine encounter opportunity arises, not
once per game tick for every NPC in the city.

## Implemented Stage B, part 3: social interaction lifecycle

- `SRC/core/social-interaction-types.ts`: serialisable interaction records,
  lifecycle statuses, selection inputs and trusted host context.
- `SRC/systems/social-interaction.ts`: request verification against currently
  eligible social intentions, responder-only acceptance/refusal, opinion-aware
  NPC response recommendation, authorised completion, explicit expiry sweep.
- `tests/social-interaction.test.mjs`: end-to-end tests of consent,
  relationship effects, gossip, invitations, mutual boundaries, time, privacy
  revocation, duplicated actions and impersonation checks.

A proposal is **not** an event. Acceptance is **not** completion. The recipient
must respond to the proposal, and genuine participation must be verified
before the authoritative host calls completion. A declined invitation is final
and creates no positive/negative relationship deltas. A successfully
completed conversation or off-duty shared-time interaction creates exactly
one ordinary conversation event, witnessed by both participants. Sharing
information creates a reported belief for the recipient only on completion
and only while its event ID remains explicitly shareable.

A personal invitation can be initiated by an NPC independently of the player.
The target's decision can be derived separately from the target's own opinions,
but the recommendation doesn't force acceptance. An NPC can care about someone
who dislikes them, and consent remains a separate action.

Proposals are checked against a newly recomputed eligible-intent list.
Only trusted game-owned caller facts can supply IDs, character presence,
authorisation or public/shareable event IDs. Responses are allowed only from
the target; completion only from the initiator, with late changes to
no-contact boundaries, location and gossip shareability checked again.
After a refusal or completion, per-direction cooldowns apply; unfinished
requests lock the pair, and an explicit expiry pass reclaims old requests.

**Important security and scale limitation:** This is a pure TypeScript
domain-engine prototype, **not** a secure server endpoint or production
authorisation system. The `canActAs` callback is a trusted-host integration
contract, not cryptographic proof. A browser must never be allowed to supply
this callback, mint IDs, claim witnesses, fabricate social actions or certify
completed meetings. The future server/database integration must validate
authenticated ownership, NPC simulation authority, actual completion,
concurrent state transitions, unique IDs, transactionality and persistent
storage. Interaction records and memory ledgers are not yet compacted.

## Next stage: authoritative execution and game integration

Connect the tested pure interaction transitions to an actual trusted game
service. Couple them to meaningful scene opportunities rather than a global
NPC simulation tick. Then establish database ownership, row-level security/RPC
authority, transactional concurrency, sparse persistence, memory compaction,
privacy controls and measurable resource limits before connecting the
simulation to production gameplay. Validate coexisting multiplayer sessions
before exposing state-driven NPC behaviour.

Do not imply a functional, running NPC world from these pure functions alone.

## Stage C.1: authenticated persistence foundation (locally verified)

The first narrow server integration was initially built and verified locally
before its later release to the hosted Supabase database.

- `supabase/migrations/20261107210338_social_conversation_foundation.sql`
  was created with Supabase CLI v3 and defines four tables:
  `social_npc_catalog`, `social_relationships`,
  `social_routines` and `social_encounter_receipts`.
- `social_snapshot()` is an authenticated, per-character read RPC.
- `social_record_visit(p_npc_id, p_request_id)` is an authenticated,
  rate-limited, retry-safe contact RPC that validates the character's current
  location and an explicitly enabled NPC from the server-maintained catalogue.
- `SRC/services/supabase.ts` owns the Supabase RPC calls, and
  `SRC/services/social.ts` validates the returned data and exposes a typed
  application service. Other application layers should call this service,
  not the underlying tables.
- `tests/social-database.test.mjs` executes the **actual migration** in an
  isolated in-process PGlite PostgreSQL-compatible fixture, including a
  simulated `auth.uid()` and restricted authenticated/anon roles. Its
  checks cover cross-account isolation, denied direct table access,
  location validation, disabled NPCs, replay handling, cooldown, and
  directional persistence. PGlite is a pinned, development-only dependency.
- `tests/social-service.test.mjs` exercises the typed response contract.

### Explicit security limits

All new tables have RLS enabled and no direct browser role grants or RLS
policies. Only authenticated callers are granted `EXECUTE` on the two
`SECURITY DEFINER` RPCs, with an empty search path and explicit schema
qualification. The RPCs derive the active character from `auth.uid()`,
not from caller-supplied character IDs. The conversation RPC locks that
character row so concurrent social actions and character movement are
serialized at that boundary. The request UUID is an idempotency key, not a
permission token. **No service-role secret is used in the browser.**

The catalogue contains **no enabled NPCs** in the migration. Thus applying it
alone does not expose a new repeatable social action in the live game.
Character/account ownership and location column assumptions were verified
against existing TypeScript usage and a local schema fixture, **not** the
live database: the Supabase inspection connection timed out twice. The live
schema and function compatibility must be reviewed before applying the SQL.

The limited `social_record_visit` action increments **familiarity by one**
in both directions and summarises the visit. It does *not* modify warmth,
trust or another emotional dimension, and does not claim that a completed
dialogue, invitation or meaningful personal event took place. Even repeated
visits cannot automatically manufacture friendship. These simple factual
contact updates are intentionally narrower than the authored Stage A
`conversation` rule. The authoritatively completed interaction engine's
other events are **not yet persisted**.

### Remaining work before production use

1. Verify the real `public.characters` schema and existing movement RPC
   transaction semantics, including the assumption of one playable character
   per account, before deploying this migration.
2. Test migrations and RLS/RPC behaviour against an isolated Supabase
   project or branch (subject to separate permission for billable resources)
   and concurrent player sessions. PGlite is not a substitute for hosted
   Supabase integration testing.
3. Register an authored NPC and its real room in the NPC catalogue,
   connect the correct scene/dialogue interaction to `recordSocialVisit`,
   and visually inspect that UI on desktop/portrait/compact-landscape.
4. Connect actual completed social interactions, landmark memories and
   NPC-to-NPC shared-world state to trusted server-side persistence.
   Consolidate server data and pure TypeScript rules to prevent long-term
   drift, and design reconciliation/compaction for receipts and beliefs.
5. Ensure any new RPCs perform their own authorisation, atomic outcome
   validation, duplicate-event checks and restricted grants.

At this historical stage the migration had not been applied to production.
Its later application and permissions review are documented below.

## Stage C.2: opt-in Glassmarket merchant encounter (component verified)

The existing vendor **Marrow Kest**, at Glassmarket Transit Concourse,
is the first integration target. No new character or dedicated dialogue
system was invented.

- The social catalogue migration registers `marrow_kest` in
  `glassmarket` with `enabled = false`. This record is deliberately
  inactive until a matching server deployment is independently verified.
- `SRC/ui/interactions.ts` adds an optional contact section to Marrow's
  existing vendor dialog. The section only appears when the built client
  has `VITE_SOCIAL_ENCOUNTERS_ENABLED=true`; the default is off.
- `SRC/ui/social-encounter.ts` loads the current authenticated
  character's social snapshot, submits a greeting with a stable UUID,
  and refreshes that character's history. An uncertain request keeps
  its UUID for safe retry. UI state resets when the active character
  changes.
- `SRC/ui/social-encounter-markup.ts` renders qualitative recognition
  ("new face", "seen you around", "familiar customer", "regular") from
  compact routine history; it does not present friendship meters.
- `tests/social-encounter-markup.test.mjs` checks recognition bands,
  character-specific histories, loading and error states, disabled
  actions and output escaping.
- `tests/visual/social-encounter.html` is a self-contained browser
  inspection fixture using the **real vendor dialog CSS and encounter
  markup**. It is not a substitute for a signed-in full-game screenshot.

### Actual browser inspection

Chromium screenshots were captured and visually inspected at desktop
1440×900, portrait 390×844 and compact-landscape 800×390 viewports.
The initial compact view exposed a real bug: the dialog overflowed
the viewport and the greeting controls were hidden. The dialog now uses
a `100dvh`-based max-height and internal vertical scrolling.

The revised compact view was inspected at both the top and the scrolled
bottom. The greeting section and action are visible after scrolling,
while the dialog's close control remains accessible at the top. Browser
layout assertions also confirmed that the dialog remains in the
viewport at all three sizes, and that the compact greeting button can
be brought into view and clicked. This is **component visual
verification**, not an authenticated end-to-end gameplay test.

### Security and rollout status

- The new UI does not directly read or write social tables. It invokes
  only authenticated social RPCs via the existing Supabase service.
- The initial hosted schema inspection timed out. Later independent
  read-only checks confirmed the character schema and the migration was
  subsequently applied in a separate release step.
- All multi-account isolation tests still use isolated PGlite with
  simulated authentication. They establish domain and migration
  behaviour but **do not establish actual concurrent multiplayer
  correctness or hosted database compatibility**.
- At initial component verification the NPC and build flags were
  disabled. The later rollout is documented below.

A separate hosted test branch was recommended but not required for the
limited first greeting release. Authenticated two-account tests remain a
future post-release validation task.

## Stage C.3: hosted-test readiness and project discovery (2026-11-08)

The connected Supabase project discovery returned one active project used by
Stray Frequency (`aikcmzqdzsbnknvcapvm`) and a separate **inactive,
unrelated** project. The Stray Frequency project has **no preview branches**.
The connected project's management metadata says it is healthy, but both
read-only schema SQL inspection and table listing failed repeatedly with
connection timeouts. A healthy management API response **does not** establish
that the database is reachable through the inspection connection.

At the time of staged-test preparation **no hosted SQL migration had been
run**, no hosted data had been written, no Auth users had been created,
and no billable branch had been created. A Supabase branch is a
separate environment that can incur compute, disk and egress charges, even
when the application's normal spending cap is enabled. Obtain explicit
cost approval before provisioning one.

The sandbox now includes:

- `supabase/verification/social_preflight.sql`: a read-only inspection query
  to compare the real characters schema, character ownership constraints,
  movement/snapshot function signatures and potential social table name
  collisions against the migration's assumptions.
- `scripts/verify-staged-social.mjs`: a **manual** integration test for a
  dedicated hosted branch, with two distinct authenticated accounts and their
  two separate playable characters in Glassmarket. It checks per-character
  history isolation, two simultaneous same-ID retries, server cooldown,
  anonymous function denial, direct-table denial and independent visits.
  The runner refuses the production project ID and requires the exact
  staging ref, an explicit staging-only write acknowledgement and externally
  supplied credentials. Its test output does not print account credentials.
- `tests/staging-safety.test.mjs`: automated regression tests confirming
  that production URLs, missing staging authorisation and absent credentials
  cause immediate local refusal **before any network request**.

For a future hosted run, create an explicitly authorised **non-production**
Supabase branch, apply/review the migration on that branch, enable the
`marrow_kest` catalogue row in that branch only, and prepare two ordinary
staging Auth accounts with one character each in Glassmarket. Supply the
branch's URL, publishable key and Auth credentials using protected sandbox
environment variables, never by committing a .env file or pasting passwords
into the chat. The test runner is deliberately **not** an npm-test default,
because it performs real staging writes.

Do not report this as a completed hosted multiplayer test until the runner
has actually executed against two authenticated sessions in the isolated
hosted environment and passed. The 86 current passing tests are local.

## Release plan: first live encounter

The first production release exposes **only** the limited Marrow Kest
visit/recognition interaction. It does not expose the simulated relationship
AI, landmark memories, gossip or offscreen NPC behaviours. Those remain
standalone, tested prototypes.

### Production flag release (Stage C.3)

The limited Marrow greeting is switched on by the tracked public-only
`.env.production` file, which Vite loads automatically during the existing
GitHub Pages `npm run build` step. This avoids requiring changes to the
GitHub Actions workflow or additional OAuth scopes. Local development builds
remain disabled unless explicitly opted in. An explicitly provided
`VITE_SOCIAL_ENCOUNTERS_ENABLED=false` build environment variable can
override the production file if a rollback build is needed.

`tests/social-production-config.test.mjs` verifies Vite loads the production
opt-in and does not enable it in default development. The second gate is
server-side: `social_npc_catalog.enabled` must also be true. The production
Supabase migration and security permissions have been verified and Marrow's
catalogue row has been enabled.

Stage C.3 exposes only the greeting and persistent routine familiarity,
not gossip, independent NPC AI, or new social actions. The released frontend
is accessible through the existing Glassmarket vendor dialog after login.
The production rollout must be reviewed, merged via PR into protected `main`,
deployed by GitHub Pages, and then inspected on the real site.

Anonymous-access denial and simulated authenticated database tests are
verified. A live signed-in end-to-end test has *not* been completed until
a real player account's greet/reload persistence is inspected.

Security caveat: these SQL RPCs use `SECURITY DEFINER` with fixed schema
qualification, narrow execution grants, authenticated ownership checks,
and no direct table privileges. Production role grants need verification,
not merely a successful application of SQL.


## Production database verification (2026-11-08)

The Stray Frequency Supabase production database was independently checked:
`public.characters` has `uuid` identity columns (`id`,
`account_id`), `text` `location_id`, a primary key on `id` and
a unique constraint on `account_id`. The four social table names were
initially absent. PostgreSQL reported version 17.11.

The additive `social_conversation_foundation` migration was then applied
to the live project using the Supabase migration interface. Verification:
all four tables exist, RLS is enabled, browser roles have no direct
table grants, both RPCs are granted to `authenticated` only, and
`anon` has no RPC execution grant. An unauthenticated HTTP request
to `social_snapshot` and a direct `social_relationships` read both
returned HTTP 401. The Marrow NPC catalogue row initially remained
disabled pending the web release.

The security advisor reported expected informational findings about
private RLS tables with no public policies and warned that the two
intentionally authenticated, permission-gated `SECURITY DEFINER`
RPCs are externally callable by signed-in users. Their ownership
checks and fixed empty search path were reviewed. An unrelated
pre-existing Auth notice concerned leaked-password protection.

**This does not prove authenticated multiplayer safety under real
concurrent players.** Hosted dual-account testing was omitted at the
user's request to avoid the cost of a preview branch. 86 automated
local tests cover the domain model, RLS fixture and HTTP rejection
behaviour, but not real two-account production sessions.

Only Marrow's factual visit/recognition feature is being released.
More complex social simulation systems have not been connected to
live gameplay or persisted in these tables.
