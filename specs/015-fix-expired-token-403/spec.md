# Feature Specification: Expired sign-in answered with "access denied" still returns to Microsoft sign-in

**Feature Branch**: `015-fix-expired-token-403`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "the <np environment>/api/config/publica is providing a 403 when the token is expired"
(the real environment address is kept out of this public repository).

## Context

Spec 009 made the app send staff back to the Microsoft sign-in when their session is no longer valid. It agreed
(clarification of 2026-11-09) that the app's settings address `/api/config/publica` stays protected by the
platform sign-in, and that **when the platform rejects that call, the app treats it as "not signed in"**.

**Observed defect**: in the deployed non-production environment, once the sign-in token has expired the platform
answers the settings request with **"access denied" (403)** instead of **"not signed in" (401)**. The app only
recognises "not signed in", so it reads the 403 as "server not available" and keeps retrying on the
"Conectando…" screen. The user is never sent back to Microsoft and has no way out short of clearing the browser
cookies by hand — the same trap spec 009 set out to remove.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reload with an expired token goes back to sign-in (Priority: P1)

A member of staff opens or reloads the app after their sign-in token has expired. The platform rejects the first
request with "access denied". Instead of staying on the loading screen, the user is sent to the Microsoft sign-in
(or straight back in if Microsoft still recognises them) and lands on the screen they asked for.

**Why this priority**: this is the reported defect; today the app is unusable in this situation.

**Independent Test**: sign in, let the token expire (or simulate the platform answering the settings request with
"access denied"), reload any screen, and confirm the user ends on that screen signed in with no manual cookie
clearing.

**Acceptance Scenarios**:

1. **Given** a browser holding an expired token, **When** the platform answers the settings request with "access
   denied", **Then** the app treats it exactly like "not signed in": it goes to the Microsoft sign-in (subject to the
   once-per-minute limit of spec 009) or shows the sign-in page.
2. **Given** the same situation, **When** the user has just signed out, **Then** the sign-in page is shown and no
   automatic redirection happens (spec 009 behaviour preserved).
3. **Given** a valid session, **When** the user reloads, **Then** the app opens normally with no extra sign-in step.

---

### User Story 2 - Token expires while the app is open (Priority: P2)

The user has the app open and the token expires. The next action is rejected by the platform with "access
denied". The app first tries to renew the session silently, as it already does for "not signed in"; if renewal
fails, it shows the "session expired" notice from spec 009 instead of a generic error.

**Why this priority**: same root cause as story 1, but the user can still recover by reloading, so it is less
severe once story 1 is fixed.

**Independent Test**: with the app open, make the platform answer the next request with "access denied" and
confirm a silent renewal is tried once, and on failure the session-expired notice appears.

**Acceptance Scenarios**:

1. **Given** an open app and an expired token, **When** an action is rejected by the platform with "access denied",
   **Then** one silent renewal is attempted and, if it succeeds, the action is repeated transparently.
2. **Given** the renewal fails, **When** the rejection persists, **Then** the user sees the session-expired notice
   with the option to sign in again; no data they were entering is lost without warning.

---

### User Story 3 - Real "no permission" answers are not confused with an expired session (Priority: P1)

A signed-in user without the right role tries an action the app's own permission rules forbid. They must keep
seeing the "you do not have permission" message, not be sent to sign in again.

**Why this priority**: treating every "access denied" as an expired session would hide permission errors and could
cause sign-in loops for users who are correctly signed in. It must ship together with story 1.

**Independent Test**: sign in as a user lacking a role, perform a forbidden action, and confirm the permission
message is shown and no sign-in redirection happens.

**Acceptance Scenarios**:

1. **Given** a valid session, **When** the app's own rules forbid an action, **Then** the permission message is shown
   and the session is untouched.
2. **Given** a valid session with no role in the app, **When** the app loads, **Then** the "sin acceso" screen of
   spec 009 is shown, not the sign-in page.

### Edge Cases

- The settings address is public inside the app itself, so any "access denied" on it can only come from the
  platform sign-in: it is always read as "not signed in".
- An "access denied" that comes from the platform on any other request (not the app's own permission check) is
  read as "not signed in"; one that comes from the app's own rules is never read that way.
- The platform answers "access denied" repeatedly right after a return from Microsoft: the once-per-minute limit of
  spec 009 applies and the sign-in page is shown instead of looping.
- Server down, server error or no answer remain "server not available" and never trigger a sign-in redirection.
- The paired mobile page (opened from the QR code) also reads the settings address; an "access denied" there must
  not break the mobile page — it simply behaves as if no demo flag were set.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the startup settings request is rejected by the platform sign-in with "access denied", the app
  MUST handle it as "not signed in", following the same path spec 009 defines for "not signed in".
- **FR-002**: When any later request is rejected by the platform sign-in with "access denied", the app MUST attempt
  one silent session renewal and, if it fails, show the session-expired notice — the same path as "not signed in".
- **FR-003**: An "access denied" produced by the app's own permission rules MUST NOT be treated as an expired
  session; the existing permission message MUST still be shown.
- **FR-004**: The once-per-minute redirection limit and the "no automatic redirection after signing out" rule of
  spec 009 MUST apply unchanged to this case.
- **FR-005**: Network failures, server errors and time-outs MUST continue to be treated as "server not available"
  and never as "not signed in".
- **FR-006**: The paired mobile page MUST keep working when the settings request is rejected.
- **FR-007**: No personal data (owner name, phone, ID number, address) and no token contents MUST appear in logs,
  errors or telemetry produced while handling these rejections.
- **FR-008**: Automated tests MUST cover an "access denied" answer from the platform on startup and during use,
  and an "access denied" from the app's own rules, without calling Microsoft or Azure.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of reloads with an expired token, the user reaches either the Microsoft sign-in or the
  sign-in page within 10 seconds; none stays on the loading screen.
- **SC-002**: Zero support requests to clear browser cookies caused by an expired token after release.
- **SC-003**: 100% of permission-denied actions for signed-in users still show the permission message and cause no
  sign-in redirection.
- **SC-004**: No sign-in loop: at most one automatic trip to Microsoft per minute per browser, as in spec 009.

## Assumptions

- The platform sign-in in front of the app answers expired tokens with "access denied" in at least one deployed
  environment; whether it ever answers 401 instead is irrelevant, as both are handled the same.
- The app can tell a platform rejection from its own permission rejection (its own rejections carry the app's
  error code; the platform's do not).
- The settings address stays protected by the platform (spec 009 decision); no infrastructure change is in scope.
- Spec 009's sign-in page, session-expired notice and redirection limits already exist and are reused unchanged.
