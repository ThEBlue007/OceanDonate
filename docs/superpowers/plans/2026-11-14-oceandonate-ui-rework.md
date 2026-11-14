# OceanDonate UI Rework Implementation Plan

> **For agentic workers:** Use this plan task-by-task. Complete one independently reviewable UI area at a time and retain existing application contracts.

**Goal:** Reorganize OceanDonate's public site, account flows, streamer dashboard, donation page, and OBS overlays into a coherent, easy-to-use experience using colors drawn from `Frontendd/logo.png`.

**Architecture:** Keep the existing static HTML/CSS/JavaScript architecture. Add a shared design-token stylesheet and progressively reshape each page without changing API, Socket.IO, payment, authentication, or data behavior. Deliver one independently reviewable page group per task, then check the complete experience at desktop and mobile sizes.

**Tech Stack:** Static HTML, CSS, browser JavaScript, Express static hosting, Node.js `node:test`, and jsdom UI tests.

**Spec:** `docs/superpowers/specs/oceandonate-ui-rework.md`

## Global Constraints

- “Migrating the static HTML/JavaScript application to React or another framework” is out of scope.
- “Changing payment providers, authentication rules, donation confirmation, database schema, OBS protocol, or widget token model” is out of scope.
- “Removing the current Thai/English language option” is out of scope.
- “Keep each overlay's transparent canvas and existing Socket.IO events, widget token behavior, and donation queue.”
- “Do not redesign payment verification or alter backend business rules as part of the visual rework.”
- Validate proposed logo-derived colors against `Frontendd/logo.png` before using them as shared tokens.

## Review Focus

- **Donor mobile flow:** amount, gift, donor details, payment method, and final action remain usable without horizontal overflow or lost input; pin with a UI test and phone-width visual check in Task 4.
- **Dashboard navigation:** every existing settings panel remains reachable after regrouping; pin the navigation targets and rendered tab state in Task 3.
- **Live controls:** pause, resume, skip, timer, and gift controls retain their current events and behavior; pin event payloads in Task 3 and run backend integration tests in Task 6.
- **Payment and auth feedback:** readiness, failures, OAuth linking, and reset-password messages remain understandable; pin current flow behavior in Task 2/4 and run security integration tests in Task 6.
- **OBS compatibility:** overlays keep transparency, token-only access, live updates, and reduced-motion behavior; pin DOM/event behavior in Task 5 and run security integration tests in Task 6.

## File Map

- Create `Frontendd/design-tokens.css` — shared Dark and Light brand colors, type roles, spacing, focus, surfaces, and responsive primitives.
- Create `Frontendd/theme.js` — apply saved theme before interaction, default to Dark, persist the switch, and update its accessible label/state.
- Modify `Frontendd/index.html`, `Frontendd/auth.html`, `Frontendd/dashboard.html`, `Frontendd/donate.html`, `Frontendd/widget.html`, `Frontendd/timer.html`, `Frontendd/goal.html`, `Frontendd/top-donator.html` — load shared tokens and redesign each corresponding experience while preserving IDs and runtime behavior. Add a theme switch to the first four pages; OBS overlays remain transparent and dark-brand.
- Modify `Frontendd/mainstyle.css` — align landing-page shared components with the new tokens; avoid duplicating the token definitions here.
- Modify `Backend/test/ui.test.js` — pin page structure, responsive controls, labels, focus, and preview behavior as the UI is reshaped.
- Modify `Backend/test/security.test.js` only if UI changes touch a contract that requires an integration regression assertion; do not change backend behavior for visual work.
- Modify `List.md` — record each completed design phase and its verification.

---

### Task 1: Establish shared brand system and theme switch

**Files:** Create `Frontendd/design-tokens.css`, `Frontendd/theme.js`; modify all page heads, theme controls in `Frontendd/index.html`, `Frontendd/auth.html`, `Frontendd/dashboard.html`, `Frontendd/donate.html`, and `Frontendd/mainstyle.css`; test `Backend/test/ui.test.js`.

**Interfaces:** CSS custom properties `--od-color-*`, `--od-font-*`, `--od-space-*`, `--od-radius-*`, and shared focus/disabled styles. Preserve each page's existing IDs and JavaScript selectors.

- [ ] **Step 1: Write failing UI assertions** for every public page loading the shared stylesheet, Dark as the unsaved default, Light persistence across pages, and a theme control with an accessible label.
- [ ] **Step 2: Run** `node --test --test-reporter=spec Backend/test/ui.test.js`; confirm the new assertions fail because shared tokens are absent.
- [ ] **Step 3: Add** the logo-checked Deep Sea `#06182E`, Night Current `#0B2744`, Ocean Blue `#1687E8`, Wave Cyan `#38D6EF`, Coin Gold `#FFC83D`, Sea Mist `#F2F7FC`, and Foam `#AFC3D8` tokens and a contrast-checked Light palette, plus typography, focus, spacing, and motion preferences.
- [ ] **Step 4: Add** `theme.js` to apply `localStorage.oceandonate_theme` before paint (default `dark`), keep preference when navigating, and toggle `data-theme` with accurate `aria-pressed` and label state.
- [ ] **Step 5: Link** the shared stylesheet and theme control from each public page; keep OBS pages transparent and dark-brand; replace duplicated shared colors in `mainstyle.css` with tokens.
- [ ] **Step 6: Run** the UI test file and inspect the landing page at 1440 px and 390 px in both themes; confirm contrast, focus, and mobile navigation still work.

### Task 2: Rework landing and account access

**Files:** Modify `Frontendd/index.html`, `Frontendd/auth.html`; test `Backend/test/ui.test.js`.

**Interfaces:** Keep current navigation anchors, locale toggle, login/register/password-reset IDs, OAuth routes, and status regions.

- [ ] **Step 1: Write failing UI assertions** for primary landing action, mobile navigation access, login/register/reset reachability, and social-login feedback.
- [ ] **Step 2: Run** `node --test --test-reporter=spec Backend/test/ui.test.js`; verify the new assertions fail on the current structure.
- [ ] **Step 3: Rebuild** the landing hierarchy around a clear service explanation, one primary sign-up action, concise feature proof, and streamer discovery.
- [ ] **Step 4: Rebuild** account forms as focused, consistently labeled flows with visible provider-link state and non-modal feedback; preserve all existing handlers.
- [ ] **Step 5: Run** UI tests and check keyboard navigation and the Thai/English toggle at desktop and phone widths.

### Task 3: Reorganize the streamer dashboard

**Files:** Modify `Frontendd/dashboard.html`; test `Backend/test/ui.test.js`.

**Interfaces:** Keep existing section IDs, tab/data attributes, socket event names and payloads, save behavior, and chart/history data contracts.

- [ ] **Step 1: Write failing UI assertions** for the proposed destinations: Overview, Donation History, Donation Page, Payments, Widgets & Live, and Account; verify every current settings panel has a reachable destination.
- [ ] **Step 2: Run** `node --test --test-reporter=spec Backend/test/ui.test.js`; confirm navigation/structure assertions fail.
- [ ] **Step 3: Reorganize** the shell with a compact top bar, clear active navigation, a mobile navigation pattern, and consistent page headings/help text. Move existing panels by preserving their IDs and handlers.
- [ ] **Step 4: Simplify** each long settings surface through clear sections, progressive disclosure for advanced options, aligned actions, empty states, and save feedback beside the relevant controls.
- [ ] **Step 5: Run** UI tests and manually verify all destinations at 1440 px and 390 px, including history sorting, alert controls, OBS links, Timer, gift catalog, and account provider links.

### Task 4: Rework the public donation and payment experience

**Files:** Modify `Frontendd/donate.html`; test `Backend/test/ui.test.js`.

**Interfaces:** Keep `/api/streamer/:username`, donation creation and slip-upload routes, preview-mode blocking, gift selection fields, locale behavior, Socket.IO profile updates, and existing input IDs.

- [ ] **Step 1: Write failing UI assertions** for phone-width layout, visible selected-gift details, clear payment instructions, confirmation/result feedback, and preview-mode payment blocking.
- [ ] **Step 2: Run** `node --test --test-reporter=spec Backend/test/ui.test.js`; confirm the new structure/responsiveness assertions fail.
- [ ] **Step 3: Arrange** creator identity and support information before the donation form; present amount/gifts, donor details, payment selection, and final action in a clear reading order.
- [ ] **Step 4: Add** a compact payment summary and contextual help for PromptPay/bank transfer/slip verification without changing payment APIs or verification behavior.
- [ ] **Step 5: Run** UI tests and verify real flow and preview at 1440 px and 390 px; confirm Preview cannot submit real or test payments.

### Task 5: Refresh OBS overlay visuals

**Files:** Modify `Frontendd/widget.html`, `Frontendd/timer.html`, `Frontendd/goal.html`, `Frontendd/top-donator.html`; test `Backend/test/ui.test.js` and existing security assertions.

**Interfaces:** Keep transparent page background, `join_widget` token payloads, event names, element IDs used by renderers, animation/effect timing, and reduced-motion handling.

- [ ] **Step 1: Write failing UI assertions** for transparent canvases, consistent typography, readable money highlights, and all existing overlay event renderers.
- [ ] **Step 2: Run** focused UI tests and verify the assertions expose inconsistent styling or missing behavior.
- [ ] **Step 3: Apply** the shared palette and typography to alert, goal, timer, and leaderboard overlays; reserve gold for amount emphasis and cyan/blue for brand highlights.
- [ ] **Step 4: Keep** gift-specific animation and alert timing distinct, preserve safe text rendering, and respect reduced-motion settings.
- [ ] **Step 5: Run** UI tests and inspect each overlay on both a transparent dark scene and a bright scene.

### Task 6: Cross-page verification and release review

**Files:** All Task 1–5 files; `Backend/test/ui.test.js`, `Backend/test/security.test.js`, `List.md`.

**Interfaces:** No backend or persistence change is introduced by this task.

- [ ] **Step 1: Run** `node --test --test-reporter=spec Backend/test/ui.test.js` and the backend integration suite; confirm existing payment, auth, Socket.IO, widget-token, timer, and queue assertions pass.
- [ ] **Step 2: Check** each customer page at 1440 px, tablet width, and 390 px; check keyboard-only form completion, visible focus, text contrast, and browser zoom to 200%.
- [ ] **Step 3: Check** OBS overlays for transparent backgrounds, visible text, safe-area placement, and reduced-motion behavior.
- [ ] **Step 4: Update** `List.md` with each completed phase and test results.
- [ ] **Step 5: Review** the complete diff for accidental API, localization, persisted-setting, or stream-key changes; release only after each page group is reviewed.
