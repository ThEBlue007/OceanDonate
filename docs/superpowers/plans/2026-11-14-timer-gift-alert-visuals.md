# Timer, Gift, and Alert Visuals Implementation Plan

> **For implementation:** Work one independently reviewable workstream at a time. Use test-first changes, update `List.md`, and do not deploy production without an explicit release instruction.

**Goal:** Make Timer setup easier to use, expand the built-in gift and Alert style galleries, and add a larger Thai-capable font selection for Alerts.

**Architecture:** Extend the existing dashboard, server settings allowlists, and OBS widgets without changing payment confirmation or donation accounting. Keep gift icons, effects, fonts, and themes selected from server-enforced allowlists. Store only bounded Timer appearance settings alongside existing Timer configuration.

**Tech Stack:** Static HTML/CSS/JavaScript, Express/Socket.IO/Mongoose, Node test runner, jsdom, MongoDB memory replica set.

**Spec:** User-provided Timer, gifts, and Alert reference screenshots in the conversation; retain previously confirmed timer and donation invariants.

## Constraints

- A gift is still one fixed-price selection per donation and server-side pricing remains authoritative.
- Only confirmed donations affect real totals and Timer rewards.
- Timer has no maximum; stopped-time changes remain banked for the next stream; reaching zero stops at zero.
- A gift-specific Timer action overrides amount-band rules.
- No paid Pro tier or user-uploaded animations are introduced.
- All new styling values are allowlisted on the server and behave safely in OBS.
- Update `List.md` and Change Log.

## Review Focus

- Legacy settings still load and unknown font/theme values fall back safely.
- Timer appearance changes persist and reach owner and Timer widget without changing timer state.
- Gift bulk controls update only current catalog entries; zero search results have an explanatory empty state.
- Alert presets apply consistently to Dashboard preview and OBS; reduced-motion users do not receive extra animation.

## Workstreams

1. Add integration tests for Timer appearance, alert font/theme allowlists, expanded gift catalog validation, and static UI controls.
2. Extend the Alert font and preset galleries with synchronized Dashboard preview and OBS styling.
3. Add Timer “รูปแบบ” / “กฎการโดเนท” tabs, appearance controls, and OBS-rendered appearance settings.
4. Expand the gift gallery with searchable/filterable cards, bulk enable/disable, additional built-in icons/effects, and accessible previews.
5. Update `List.md`, run the backend integration suite and frontend checks, inspect the final diff, and commit the changes on the current feature branch.
