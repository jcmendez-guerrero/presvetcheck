# Claude Code Repository Guide

@AGENTS.md

## What to read, and when (keep context small)

- `AGENTS.md` (imported above) is the operational summary of the constitution: follow it always.
- `.specify/memory/constitution.md` prevails over everything. Read it when a change touches regulation,
  data protection, traceability or language rules, or when `AGENTS.md` and the code disagree.
- `SPEC.md` is large (~90 KB). **Do not read it whole**: open only the section you need (`grep -n '^## ' SPEC.md`).
  Map: §4 domain rules (L149) · §5 integrations (L448) · §6 data model (L567) · §7 API (L618) · §8 screens (L645)
  · §9 security/GDPR (L665) · §10 Azure (L693) · §12 acceptance (L739) · §13 decisions (L789) · Annex A (L817).
- Open decisions and doubts: `docs/dudas.md` is an index of `DUDA-xx` → Jira (KAN-1); the full text lives in Jira.
- Internal documentation (real infra topology, data-protection status, audits) lives in Confluence, space CDE,
  folder **PreVetCheck**. Actionable work goes to Jira (project KAN).
- Spec Kit skills are in `.claude/skills/`; templates and workflows in `.specify/`. Copilot-only files
  (`.github/agents`, `.github/instructions`, `.github/skills`) are optional references; read one only when the task
  matches it.

## Working rules

- In conflict, the constitution prevails; update `AGENTS.md` to stay consistent.
- Do not invent external integration schemas or regulatory rules; use the spec, fixtures and `docs/ref/`.
- Keep domain logic pure and deterministic; inject time; keep legal rules out of AI prompts and UI components.
- Never call real CIMAVet, Siweb360, or Azure services from tests. Use fixtures and mocks.
- This repository is **public**: never commit personal data, real prescriptions, internal Azure resource names,
  IP ranges, tenant/app IDs or personal e-mails. Real values go in ignored local files and Confluence.
- Run `pnpm lint && pnpm typecheck && pnpm test` before considering a task complete.
