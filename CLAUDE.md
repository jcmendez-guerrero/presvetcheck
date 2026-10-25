# Claude Code Repository Guide

Before changing code or project artifacts, read and follow these sources:

1. **`.specify/memory/constitution.md`** — governing principles. It takes precedence over all other repository conventions.
2. **`SPEC.md`** — functional and technical requirements, including unresolved decisions in §13.
3. **`AGENTS.md`** — English-language operational guidance, stack commands, domain conventions, testing requirements, and links to the repository's AI resources.

## AI resources

- **Claude/Spec Kit skills:** `.claude/skills/`. These provide the local Spec Kit workflows for specifying, clarifying, planning, task generation, implementation, analysis, and related activities.
- **Spec Kit configuration and templates:** `.specify/`, including `memory/constitution.md`, `templates/`, and `workflows/`.
- **GitHub Copilot custom agents:** `.github/agents/*.agent.md`. These are Copilot agent profiles; use them as project-specific references where useful, but do not assume Claude Code activates them as subagents.
- **GitHub Copilot path-specific instructions:** `.github/instructions/*.instructions.md`. Consult the matching instruction file when working in its `applyTo` scope.
- **GitHub Copilot Agent Skills:** `.github/skills/<skill-name>/SKILL.md`. Read the relevant skill and any referenced bundled files when the task matches its purpose.

## Working rules

- Preserve the constitution's regulatory, data-protection, traceability, and language requirements. In case of conflict, the constitution prevails and `AGENTS.md` should be updated to remain consistent.
- Do not invent external integration schemas or regulatory rules. Use the specification, fixtures, and reference files named in `AGENTS.md`.
- Keep domain logic pure and deterministic; inject time and keep legal rules out of AI prompts and UI components.
- Never call real CIMAVet, Siweb360, or Azure services from tests. Use fixtures and mocks.
- Follow the commands and completion gates in `AGENTS.md`; run `pnpm lint && pnpm typecheck && pnpm test` before considering a task complete.
