# OceanDonate UI Rework — Design Direction

## Goal

Reorganize OceanDonate's public pages, streamer dashboard, donation checkout, and OBS widgets so first-time users can understand what to do, while giving the product one consistent visual identity derived from `Frontendd/logo.png`.

## Audience and primary jobs

- Streamers: configure payments and their donation page, control a live stream, and understand donation activity without hunting through long settings pages.
- Donors: recognize the streamer, choose an amount or gift, enter a message, and understand the payment steps and result.
- New members: understand the service and create or access an account without confusing social-login or password-reset paths.
- OBS viewers: see clear alerts, timers, goals, and rankings; overlays must remain transparent and free of dashboard controls.

## Brand tokens (proposed from the logo)

Logo colors are represented by approximate UI tokens; implementation should compare each value against the actual logo before applying it. Dark is the default theme. A site-wide Dark/Light switch saves the visitor's choice and keeps it when moving between pages. The OBS overlays stay transparent and brand-dark because a background theme would interfere with the stream scene.

| Token | Proposed value | Role |
|---|---|---|
| Deep Sea | `#06182E` | Main dark page background |
| Night Current | `#0B2744` | Navigation and elevated surfaces |
| Ocean Blue | `#1687E8` | Primary actions, links, focus indicators |
| Wave Cyan | `#38D6EF` | Selected states, live indicators, secondary highlights |
| Coin Gold | `#FFC83D` | Donation amounts and earned-value highlights |
| Sea Mist | `#F2F7FC` | Primary text on dark surfaces |
| Foam | `#AFC3D8` | Supporting text and dividers |

Use red only for destructive/error states and green only for successful/verified states. Avoid the current unrelated purple/pink accents. Check text/action contrast before shipping.

### Light theme equivalents

| Token | Proposed value | Role |
|---|---|---|
| Sea Glass | `#F2F8FC` | Main light page background |
| Cloud Surface | `#FFFFFF` | Forms and primary surfaces |
| Deep Ink | `#102A43` | Main text on light surfaces |
| Muted Current | `#4F6B82` | Supporting text on light surfaces |
| Ocean Blue (light) | `#0879C9` | Primary actions and focus |
| Wave Cyan (light) | `#087F97` | Selected states with readable contrast |

Coin Gold remains a small money highlight; use a darker gold for text on light backgrounds when contrast requires it.

The theme switch appears on the landing page, account page, dashboard, and public donation page. Default to Dark when there is no saved choice, persist a manual choice in local storage, and apply it before first paint. Keep the existing Thai/English switch separate.

## Type and visual language

- Use IBM Plex Sans Thai for body text and form labels; use Kanit for headings, large amounts, and timer numerals.
- Keep Thai line-height generous and labels sentence-case. Explain fields at the point of entry with short examples.
- Use clear hierarchy, aligned form edges, and a small number of surfaces with distinct jobs. Do not put every control in an identical card.
- Use cyan/blue to indicate what is interactive; reserve gold for money-related emphasis.
- Keep motion tied to user actions, respect reduced-motion settings, and retain visible keyboard focus.

## Layout direction

### Streamer dashboard

Desktop: compact top bar, stable left navigation, one page heading with an explicit task description, then a content column capped around 1,360 px. Keep live status and the primary action visible near the top. Separate overview, donation history, payment setup, donation-page appearance, OBS widgets/live controls, and account access into navigable destinations instead of one long scrolling surface. Preserve deep links and all existing saved settings.

Mobile: compact top bar and horizontally scrollable or collapsible navigation; use one content column, full-width fields, and accessible touch targets. Keep save feedback beside the action and do not hide essential status in tooltips.

### Donation page

Desktop: creator identity and recent supporter summary beside a clearly ordered donation form. Keep amount/gift selection, donor details, payment method, and final action visually distinct. Show a concise amount/payment summary before the final action.

Mobile: one readable column, creator identity compact at the top, no narrow centered form, donation options visible as cards with previews, and the final donate action easy to reach without obscuring form fields.

### Landing and account access

Use the same header, logo treatment, typography, and button language. Landing should explain the service and lead to one primary action. Login, registration, OAuth linking, and password reset should be plain, focused forms with clear success/error feedback.

### OBS overlays

Keep each overlay's transparent canvas and existing Socket.IO events, widget token behavior, and donation queue. The visual refresh applies to alert presentation and timer/goal/top-donor typography and effects; it must not add dashboard chrome to the capture area or change alert timing.

## Interaction rules

- Use direct labels such as “ช่องทางรับเงิน”, “หน้ารับโดเนท”, and “ตั้งค่าวิดเจ็ต” consistently.
- Show required steps and account/payment readiness before a streamer publishes a donation page.
- Explain whether an action affects live behavior, saved configuration, or preview.
- Preserve realtime queue, confirmed-payment, timer, gift, and authentication behavior exactly.
- Do not redesign payment verification or alter backend business rules as part of the visual rework.

## Out of scope

- Migrating the static HTML/JavaScript application to React or another framework.
- Changing payment providers, authentication rules, donation confirmation, database schema, OBS protocol, or widget token model.
- Removing the current Thai/English language option.

## Acceptance criteria

- All customer-facing pages use the shared logo-derived token set and consistent typography.
- Landing, account, dashboard, and donation pages default to Dark, offer Light, and preserve the chosen theme while navigating between them.
- A new streamer can find payment setup, donation-page appearance, live controls, history, and account access by their plain-language labels.
- A donor can complete the existing amount/details/payment flow on phone and desktop without horizontal overflow or losing entered information.
- All existing backend contracts, Socket.IO event names, preview restrictions, and transparent OBS behavior remain intact.
- Keyboard focus, form labels, error/success status, and reduced-motion behavior remain accessible.
