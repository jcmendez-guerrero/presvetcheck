# Feature Specification: Mobile pairing dialog always fits on screen

**Feature Branch**: `008-fix-mobile-qr-dialog`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "the movile popup to use the camera to scan is loading over the top so cutting in half and impossible to load"

## Context

Staff open the "Usar el móvil" dialog from the page header to pair a phone with the PC. The phone then works as a
camera to photograph prescriptions and read pack barcodes. The dialog shows a title, a short explanation, the QR
code, the pairing link, the connection status, the expiry time and two buttons ("Desconectar el móvil" and "Cerrar").

**Observed defect**: when the dialog opens, it grows past the top edge of the window. The title, the explanation
and the top part of the QR code are cut off and cannot be reached by scrolling, so the phone cannot read the QR
code and pairing is impossible. The rest of the page is not dimmed behind the dialog. Observed on the admin screen
of the non-production environment.

This is a regression: pairing worked when it was released (2026-10-15) and broke with the page-header redesign of
2026-11-08 (feature 007). The defect affects every window size, not only short windows; short windows make it worse
because the dialog is taller than the space available.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scan the QR code on a short screen (Priority: P1)

A staff member on a laptop with a short browser window opens the mobile pairing dialog and scans the whole QR
code with the phone camera.

**Why this priority**: this is the defect. Without the whole QR code on screen, the phone cannot pair, and the staff
member loses the phone camera for prescriptions and barcodes.

**Independent Test**: open the dialog in a browser window 430 px tall (the height seen in the report) and check that
the whole QR code is visible and that a phone reads it.

**Acceptance Scenarios**:

1. **Given** a browser window shorter than the dialog, **When** the staff member opens the mobile pairing dialog,
   **Then** the top of the dialog (title) is at or below the top edge of the window and the whole QR code can be
   brought into view.
2. **Given** the dialog is taller than the window, **When** the staff member scrolls inside the dialog area,
   **Then** every part of the dialog (title, explanation, QR code, link, status, expiry, buttons) can be reached.
3. **Given** a browser window tall enough for the dialog, **When** the dialog opens, **Then** it is fully visible,
   centred over the whole page, with no scrollbar, like the other dialogs of the app.

---

### User Story 2 - Close or disconnect on a short screen (Priority: P2)

A staff member on a short screen can always reach the "Cerrar" and "Desconectar el móvil" buttons.

**Why this priority**: if the buttons are off screen the staff member is stuck behind the dialog or cannot cut off a
phone they no longer trust.

**Independent Test**: with the dialog open in a 430 px tall window, reach and press "Cerrar" using only the mouse,
then again using only the keyboard.

**Acceptance Scenarios**:

1. **Given** the dialog is open in a short window, **When** the staff member scrolls to the bottom of the dialog,
   **Then** both buttons are visible and work.
2. **Given** the dialog is open in a short window, **When** the staff member moves through it with the Tab key,
   **Then** each focused element scrolls into view.

---

### Edge Cases

- Window resized (or page zoomed) while the dialog is open: the dialog keeps fitting without reopening it.
- Very short window (for example 300 px): content scrolls; nothing is clipped beyond reach.
- Narrow window (phone-sized or split screen): the long pairing link still wraps and the dialog fits the width.
- While the QR code is still being generated ("Preparando el código…") or an error is shown, the dialog also fits.
- The page behind the dialog must not scroll instead of the dialog.
- The phone connects while the staff member has scrolled: the dialog still closes on its own as it does today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The mobile pairing dialog MUST never extend beyond the top or bottom edge of the browser window.
- **FR-002**: When the dialog content is taller than the window, the user MUST be able to scroll to every part of it.
- **FR-003**: The QR code MUST be shown whole and at a size a phone camera can read (no smaller than today's size on
  windows tall enough to fit it).
- **FR-004**: The "Cerrar" and "Desconectar el móvil" buttons MUST always be reachable with mouse, touch and keyboard.
- **FR-005**: On windows tall enough for the whole dialog, it MUST be fully visible and centred with no scrollbar,
  consistent with the other dialogs of the app; its content and actions stay as they are today.
- **FR-009**: While the dialog is open, the whole page behind it MUST be dimmed and not clickable, as with the other
  dialogs.
- **FR-006**: The dialog MUST keep fitting when the window is resized or the page zoom changes while it is open.
- **FR-007**: Other dialogs that share the same layout pattern SHOULD get the same fix, so the defect does not
  reappear elsewhere on short screens.
- **FR-008**: An automated check MUST cover opening the dialog in a short window and asserting that the title, the
  whole QR code and the buttons can be reached.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a window 430 px tall, a phone pairs on the first scan in 100% of attempts during acceptance testing.
- **SC-002**: In windows from 300 px to 1080 px tall, no part of the dialog is outside reach (verified at 300, 430,
  600 and 1080 px).
- **SC-003**: Staff can close the dialog in under 5 seconds on any of those window heights.
- **SC-004**: No new reports of the pairing dialog being cut off after release.

## Assumptions

- The defect is a regression introduced by the page-header redesign (feature 007) and is a layout problem only; QR generation, pairing and session expiry work correctly and stay unchanged.
- Scrolling inside the dialog is acceptable on short windows; shrinking the QR code below a readable size is not.
- The fix applies to every screen that opens the dialog (it lives in the shared header), not only the admin screen.
- No regulatory, data-protection or traceability rules are affected; the QR link and session data are unchanged.
- No new UI text is needed, so no new European Spanish copy has to be reviewed.
