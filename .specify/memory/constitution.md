<!--
Sync Impact Report
Version: 1.0.0 → 1.0.1
Change type: PATCH (translation/wording only — no principle added, removed, or redefined;
  no rule changed in substance)
Modified principles: none renamed or redefined; all 5 principles translated from Spanish to
  English (content/rules unchanged, including Principle V's requirement that UI, documentation,
  and development artifacts remain in Spanish)
Added sections: none
Removed sections: none
Templates dependent on this constitution:
  - .specify/templates/plan-template.md — pending manual review (not modified by this command)
  - .specify/templates/spec-template.md — pending manual review (not modified by this command)
  - .specify/templates/tasks-template.md — pending manual review (not modified by this command)
Follow-up TODOs:
  - TODO(RATIFICATION_DATE): still carried over from v1.0.0 — 2026-10-15 was used as the
    ratification date because no earlier documented adoption date exists in the repository.
-->

# Mundo Mascotix · Veterinary Prescription Verification — Constitution

## Core Principles

### I. Code quality
The domain layer (`packages/domain`) MUST be pure: no I/O, no direct reads of the system clock
(always inject a `Clock`), no infrastructure dependencies. Strict TypeScript is mandatory
(`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); implicit `any` is not
allowed, and silencing the compiler requires an explicit justification in the comment itself.
Input/output validation is expressed with zod schemas in `packages/shared`, and types are
inferred from those schemas — never hand-duplicated. Domain errors are typed (`DomainError` with
a stable `code`); no rule-engine decision is ever expressed as a bare boolean — always as
`{ decision, motivos[], evidencias, reglaVersion }`. Money is represented with `decimal.js`
(never `number`), and business dates are always handled in `Europe/Madrid`. Heavy dependencies
(alternative ORMs, additional UI frameworks) are not added without explicit justification in the
PR.

**Why**: the domain models regulatory decisions about dispensing veterinary medicines; a type
error or a hidden side effect there is not a cosmetic bug — it is an incorrect clinical or legal
decision. Type discipline and purity are the only cost-effective way to catch that class of error
before production.

### II. Testing discipline
`pnpm lint && pnpm typecheck && pnpm test` MUST be green before any task is considered done. The
domain is tested with case tables (`it.each`) covering, at minimum, the cases in `SPEC.md` §12.2
and known edge cases (month-end, DST transitions, day `00` in GS1 expiry dates). External
integrations (CIMAVet, Siweb360, Azure) are NEVER called from tests: MSW and versioned fixtures
in `fixtures/` are used instead. If a real sample is missing, the test is left as a skeleton with
an `it.todo` explaining which file is needed — external data structures are never invented.
Critical integration flows (outbox, reconciliation) include explicit error cases: 5xx, timeout,
differently-cased fields, unknown new fields, stock conflicts. The main flow (prescription →
dispensing) has end-to-end smoke coverage with Playwright (`EXTRACTOR=fake`).

**Why**: the system depends on external services (CIMAVet, Siweb360) outside our control and on
rules that change over time (`reglaVersion`); only deterministic tests against real fixtures let
us trust a change without re-verifying the whole flow by hand.

### III. Security and data protection
Personal data about the pet owner (name, phone, ID number, address) is never logged, surfaced in
error messages, or sent to telemetry, under any circumstance. A defect classified as
`BLOQUEANTE_DURO` (hard blocker) can NEVER be forced/bypassed, and that rule is enforced in the
API — not only in the UI. No `UPDATE`/`DELETE` is performed on finalized records
(`dispensacion`, finalized `recepcion_linea`, `audit_event`); any correction is expressed as a
counter-movement, preserving full traceability. Legal/regulatory rules are never embedded in AI
prompts or UI components: they live in `packages/domain` and in `config/rules/*.yaml`, versioned
and auditable. There are no static access keys in app configuration; access to Azure
infrastructure (Key Vault, Blob, PostgreSQL) uses managed identity. `AUTH_MODE=dev` (the
no-real-auth user selector) MUST be impossible to enable when `NODE_ENV=production`. Every
required environment variable is validated with zod at startup; the application refuses to start
in production if one is missing.

**Why**: the system handles health/identity-adjacent personal data and decisions with legal
effect (dispensing medicines, including psychotropics); a personal-data leak or a bypassed hard
blocker is not a minor technical incident — it is a regulatory breach with consequences for the
establishment and its customers.

### IV. Maintainability
Every environment variable is documented in `.env.example` with a description and default value.
Open decisions from `SPEC.md` §13 are implemented as configuration with the indicated default and
an explicit, greppable `TODO(decision D-xx)` — never as an implicit assumption buried in code.
Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`…); one PR corresponds to one block
of spec section 12.1, avoiding unrelated changes mixed into the same PR. The glossary
(`docs/glosario.md`) is kept up to date with any new or reused domain term.

**Why**: this repository changes as much because of external regulatory decisions (CIMAVet,
Siweb360, AEMPS) as because of new features; without explicit configuration, traceable open
decisions, and tightly scoped PRs, every future change costs more to understand than to
implement.

### V. Spanish for product and development, English for this constitution
Development and product artifacts are in Spanish: UI copy, user-facing documentation,
`docs/dudas.md`, ADRs (`docs/adr/`), and code comments explaining domain behavior are all written
in European Spanish, clear for non-technical staff and free of jargon (e.g., "CN" is shown as
"Código nacional"). Generic code identifiers, with no regulatory meaning of their own, are
written in technical English (`OutboxDispatcher`, `parseGs1`). Regulatory domain terms with no
exact translation, or whose translation would introduce ambiguity against the regulation or
external systems (CIMAVet, Siweb360), stay in Spanish (`receta`, `nregistro`, `cn`, `garante`,
`dispensacion`) and are documented in `docs/glosario.md` at the moment they are introduced. Any
user-facing error message translates the domain's typed `code` into a Spanish message; the
`code` itself stays stable (English/uppercase) so it does not break integrations or telemetry.
This constitution document itself is the one exception kept in English, so that governance text
is directly reviewable without translation; it does not change what language product work is
done in.

**Why**: the people operating the system (employees, the responsible veterinarian,
administration) work in Spanish and are not technical; mixing languages in the UI or leaving
regulatory terms without a glossary entry raises the risk of misreading a dispensing decision.
The constitution itself is kept in English purely so it can be reviewed and amended consistently
alongside the rest of the Spec Kit tooling, independent of product language.

## Regulatory compliance and traceability

Regulatory correctness and traceability outrank delivery speed or code aesthetics: when shipping
fast conflicts with preserving full traceability of a dispensing decision, traceability wins.
Every write to Siweb360 goes through the outbox pattern and respects `SIWEB_STOCK_WRITE_MODE`
(default `off`); stock outflows are never written from the app (the POS ticket decrements them).
Personal data older than 5 years is deleted (not anonymized) by the `retention-sweep` job, per
the current retention policy. Every rule-engine decision is tied to the rule version
(`reglaVersion`) in effect at the time, so a past decision can be audited even if the rules have
since changed.

## Workflow and quality gates

Before any task is considered done: `pnpm lint && pnpm typecheck && pnpm test` must be green;
`pnpm test:int` is added when the change touches integrations covered by Testcontainers. PRs
touching `packages/domain` or `config/rules/*.yaml` require explicit review of their associated
test case tables, not just the production code. ADRs (`docs/adr/`) document any architecture
decision with lasting impact, written before or alongside the change that implements it, not
after. Real services (CIMAVet, Siweb360, Azure) are never used from CI; workflows in
`.github/workflows/` depend only on fixtures and local containers.

## Governance

This constitution supersedes any other individual convention or preference within the
repository, including `AGENTS.md`, which holds the detailed operational guidance (commands,
concrete conventions) derived from these principles; in case of conflict between the two
documents, this constitution prevails and `AGENTS.md` must be updated to resolve the discrepancy.

Amendments to this constitution require: (1) a documented proposal with the motivation for the
change, (2) an update to this file together with its corresponding Sync Impact Report, and (3) a
review of dependent documents (`AGENTS.md`, Spec Kit templates) to keep them consistent.

Versioning follows semantic versioning: MAJOR for backward-incompatible removal or redefinition
of an existing principle; MINOR for adding a new principle or materially expanding existing
guidance; PATCH for wording clarifications or corrections that do not change a principle's
meaning (including language/translation changes to this document, as with this amendment).

Every PR and code review MUST verify compliance with the principles above; any added complexity
(a new dependency, an exception to a rule in this constitution) must be explicitly justified in
the PR description.

**Version**: 1.0.1 | **Ratified**: 2026-10-15 | **Last Amended**: 2026-10-15
