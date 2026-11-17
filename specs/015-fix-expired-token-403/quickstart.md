# Quickstart: validating 015

Nothing here calls Microsoft or Azure.

## 1. Unit table

```bash
pnpm --filter @mmx/web test -- sesion
```

Expected: the `esRechazoDePlataforma` cases in [the contract](contracts/rechazo-plataforma.md) pass alongside the
existing `rutaRetorno` / `puedeRedirigir` tables.

## 2. End-to-end session flows (Playwright, simulated Entra)

```bash
pnpm --filter @mmx/web test:e2e -- e2e/sesion.spec.ts
```

Expected, using the existing route mocks in `apps/web/e2e/sesion.spec.ts` extended with a 403 HTML answer:

| Scenario                                                       | Expected outcome                                  |
|----------------------------------------------------------------|---------------------------------------------------|
| `/api/config/publica` → 403 HTML on load                        | redirected to the (mocked) Microsoft sign-in      |
| Same, second load within one minute                             | sign-in page with «Iniciar sesión con Microsoft»  |
| Same, after the user signed out                                 | sign-in page, no redirection                      |
| App open, a request → 403 HTML, refresh OK                      | request repeated, user sees no error              |
| App open, a request → 403 HTML, refresh fails                   | session-expired notice                            |
| App open, a request → 403 `{ error: { code: 'PROHIBIDO' } }`    | permission message, no redirection                |
| `/api/config/publica` → 503                                     | stays on «Conectando…» and retries (unchanged)    |

## 3. Paired mobile page

Open `/movil?t=<token>` with `/api/config/publica` mocked to 403 HTML: the page loads normally, no demo banner.

## 4. Gate

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## 5. Deployed check (manual, non-production)

Sign in, then either wait for the token to expire (e.g. leave the tab overnight) or sign out of Microsoft in another
tab, and reload: you land on Microsoft sign-in or straight back in, never stuck on «Conectando…».
