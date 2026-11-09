# Feature Specification: Expired session always returns to Microsoft sign-in

**Feature Branch**: `009-fix-session-expiry-sso`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "The system is failing to reload once a cookie already exist in the system and says iniciando session instead of going back to entra to authenticate, evenmore the app is ebign shown, therefore either generate a login page that is capable to go to SSO and also a way that the system detect that is not longer logged or the cookie have expired to redirect to the login sso and then back to the app"

## Context

Staff sign in with their Microsoft work account (Entra ID single sign-on, ADR-06). The browser keeps a session
from that sign-in. When the session is no longer valid (it expired overnight, the token was revoked, or the user
signed out elsewhere) but the browser still holds the old session, reloading the app does not send the user back to
Microsoft to sign in again.

**Observed defect**: after a reload with a stale session, the page stays on the message "Iniciando sesión…"
indefinitely. The page header and side menu of the app are drawn around that message, so the app looks open but
nothing works and there is no way out except clearing the browser's cookies by hand. The same happens when the
session expires while the app is already open: the next action fails silently or with a generic error instead of
asking the user to sign in again.

## Clarifications

### Session 2026-11-09

- Q: Should the platform sign-in keep protecting the app's settings address (`/api/config/publica`), or should
  anonymous visitors be able to read it? → A: Keep it protected. No infrastructure change; when the platform
  rejects that call, the app treats it as "not signed in" (T030 dropped).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reload with an expired session goes back to sign-in (Priority: P1)

A member of staff opens the app (or reloads it) the morning after their last use. Their old session is no longer
valid. Instead of being stuck on "Iniciando sesión…", they are taken to the Microsoft sign-in automatically (or
straight back in, if Microsoft still recognises them), and land on the same screen they asked for.

**Why this priority**: today the app is unusable in this situation and staff need technical help to clear cookies.
This is the reported defect.

**Independent Test**: sign in, invalidate the session (let it expire or revoke it) while keeping the browser
cookies, reload a screen such as the prescriptions list, and confirm the user ends on that screen signed in, with
no manual cookie clearing.

**Acceptance Scenarios**:

1. **Given** a browser holding an expired or revoked session, **When** the user loads or reloads any screen of the
   app, **Then** the user is sent to the Microsoft sign-in and, after signing in, returns to the screen they
   originally requested.
2. **Given** a browser holding an expired session but Microsoft still recognises the user, **When** the user
   reloads, **Then** the user is signed back in without typing credentials and lands on the requested screen.
3. **Given** the user is not signed in, **When** the app is loading, **Then** no app content, menu entries or data
   are shown; only a neutral loading or sign-in screen is visible.
4. **Given** a valid session, **When** the user reloads, **Then** the app opens normally with no extra sign-in step.

---

### User Story 2 - Sign-in page when automatic redirection cannot complete (Priority: P2)

If the automatic trip to Microsoft cannot finish (for example the sign-in was cancelled, it failed, or the app
would otherwise loop between itself and Microsoft), the user sees a simple sign-in page in Spanish with a clear
explanation and a single "Iniciar sesión con Microsoft" button, instead of an endless loading message.

**Why this priority**: it is the safety net that guarantees the user is never trapped, even when the automatic
path fails.

**Independent Test**: make the sign-in fail or be cancelled, and confirm the sign-in page appears with the button;
pressing it starts the Microsoft sign-in and, on success, returns to the requested screen.

**Acceptance Scenarios**:

1. **Given** the automatic sign-in has been attempted recently and the session is still not valid, **When** the app
   loads, **Then** the sign-in page is shown instead of redirecting again.
2. **Given** the sign-in page is shown, **When** the user presses "Iniciar sesión con Microsoft", **Then** the
   Microsoft sign-in starts and, after success, the user returns to the screen they originally requested.
3. **Given** the user's account is valid in Microsoft but has no role in the app, **When** they finish signing in,
   **Then** they see a message saying they do not have access and whom to ask, not the loading message.
4. **Given** the server cannot be reached, answers with a server error, or does not answer the session check in
   time, **When** the app loads, **Then** the user sees "Conectando con el servidor…" while the app keeps retrying
   (current behaviour), and is never sent to the Microsoft sign-in or the sign-in page for that reason.

---

### User Story 3 - Session that expires while working (Priority: P3)

A member of staff leaves the app open and the session expires. On their next action the app detects it, tells them
in plain Spanish that the session has ended, and takes them through sign-in back to the same screen.

**Why this priority**: avoids silent failures mid-task; less frequent than the reload case.

**Independent Test**: with the app open, invalidate the session and perform any action that talks to the server;
confirm the user is asked to sign in again and returns to the same screen.

**Acceptance Scenarios**:

1. **Given** the app is open and the session has expired, **When** any request to the server is rejected because
   the user is not authenticated and the session cannot be renewed silently, **Then** the app shows a notice over
   the current screen saying the session has ended, with a button to sign in again that returns afterwards to the
   same screen.
2. **Given** the user has unsaved data on a form when the session expires, **When** they are asked to sign in
   again, **Then** the message warns that unsaved changes on the current screen may be lost.

---

### Edge Cases

- Sign-in fails or is cancelled repeatedly: the app must never loop between itself and Microsoft; after one
  automatic attempt within a short window it shows the sign-in page.
- Several tabs open when the session expires: each tab ends up signed in or on the sign-in page; none stays on the
  loading message, and once one tab has started the automatic sign-in, the others show the sign-in page instead of
  redirecting again within the short window.
- The requested screen includes a query string or a deep link (e.g. a prescription detail): the return address is
  preserved exactly.
- The return address must only point inside the app; an address to another site is ignored and the user lands on
  the home screen.
- The platform answers a session check with a web page instead of user data (current known behaviour): treated as
  "not signed in".
- The server is slow to start: still shows "Conectando con el servidor…" and retries, as today.
- The platform's own sign-in has expired (for example overnight) and it rejects even the app's settings call made
  before the session check: treated as "not signed in" (automatic sign-in or sign-in page), never as "server
  unreachable".
- Development mode (`AUTH_MODE=dev`): no Microsoft sign-in; the user/role selector keeps working unchanged.
- The mobile companion page (paired phone camera) uses its own pairing session: it must not be sent to Microsoft
  sign-in by this change.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST determine on every load whether the user has a valid session. It MUST treat the session
  check as "not signed in" only when the server rejects it as not authenticated or returns something that is not a
  user. A network failure, a server error, or no answer in time MUST be treated as "server unreachable" (US2
  scenario 4), never as "not signed in".
- **FR-002**: When the user is not signed in, the app MUST start the Microsoft sign-in automatically, carrying the
  address of the screen the user requested so they return to it afterwards.
- **FR-003**: The app MUST limit automatic sign-in attempts so it never loops; when an automatic attempt was made
  recently and the user is still not signed in, it MUST show the sign-in page instead.
- **FR-004**: The app MUST provide a sign-in page in clear European Spanish with a short explanation and an
  "Iniciar sesión con Microsoft" button that starts the sign-in and returns to the requested screen.
- **FR-005**: While the user is not signed in, the app MUST NOT show app menus, navigation, banners with
  operational data, or any screen content; only the loading message or the sign-in page.
- **FR-006**: The message "Iniciando sesión…" MUST be shown only while a session check is in progress and MUST NOT
  remain on screen indefinitely: a session check that has not answered after 15 seconds counts as "server
  unreachable". Once the check concludes, the user is signed in, redirected, on the sign-in page, on the "sin acceso"
  page, or on "Conectando con el servidor…". This also holds in development mode.
- **FR-007**: When any server request during use is rejected because the user is not authenticated and the session
  cannot be renewed silently, the app MUST show the session-expired notice over the current screen (warning that
  unsaved changes may be lost) and offer to sign in again, returning to the current screen. It MUST NOT redirect
  automatically while the user is working.
- **FR-008**: A signed-in user without any app role MUST see a "sin acceso" message explaining whom to contact,
  distinct from the sign-in page.
- **FR-009**: The return address MUST be limited to addresses within the app; anything else falls back to the home
  screen.
- **FR-010**: The server MUST keep rejecting unauthenticated requests on its own; the sign-in page is a usability
  aid, not a security control. This feature MUST NOT widen what anonymous visitors can reach: the platform sign-in
  keeps protecting the same addresses as before, including the app's settings address.
- **FR-011**: Development mode and the mobile companion page MUST keep their current behaviour.
- **FR-012**: Session-expiry and sign-in events MUST NOT write personal data (name, e-mail, tokens) to logs, errors
  or telemetry.
- **FR-013**: The user MUST have a visible way to sign out, after which reloading (any number of times, in any tab
  of the same browser) leads to the sign-in page rather than straight back into the app, until the user chooses to
  sign in again. *(Assumed in scope as the natural counterpart of the sign-in page; see
  Assumptions.)*

### Key Entities

- **Session state** (as seen by the app): one of "checking", "signed in", "not signed in", "signed in without
  access", "server unreachable". Drives which screen is shown.
- **Return address**: the in-app screen the user asked for before being sent to sign in.
- **Automatic sign-in attempt marker**: the time of the last automatic redirection, used to prevent loops.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of tested reloads with an expired or revoked session, the user ends signed in on the requested
  screen or on the sign-in page; never on the loading message.
- **SC-002**: When Microsoft still recognises the user, a reload with an expired app session returns them to the
  requested screen in under 10 seconds without typing credentials.
- **SC-003**: Zero cases where app menus or data are visible to a user who is not signed in.
- **SC-004**: No sign-in loops: at most one automatic redirection per short window before the sign-in page appears.
- **SC-005**: Support requests to "clear cookies" to get back into the app drop to zero after release.

## Assumptions

- Sign-in stays with Microsoft Entra ID through the platform's built-in authentication (ADR-06); no new identity
  provider or own passwords.
- "Short window" for loop protection keeps the current one minute unless planning finds a better value.
- A dedicated sign-in page is shown only as the fallback (FR-003) or after sign-out; expiry found on load goes
  straight to Microsoft for the least friction, while expiry during use shows a notice first (FR-007).
- Sign-out (FR-013) is included because a sign-in page without a sign-out has no clear entry point; it can be
  dropped in planning if a sign-out already exists.
- Losing unsaved form data on expiry is accepted; the app only warns about it (no draft saving in this feature).
- Verified in the non-production environment; real tenant values stay out of the repository.
