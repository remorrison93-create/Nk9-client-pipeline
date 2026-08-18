# Nitro K-9 Pipeline Tracker

A shared, at-a-glance kanban board for tracking every lead/client through the
Nitro K-9 sales and training pipeline — from a website form submission
through active training to graduation or alumni status.

Single-page app, plain HTML/CSS/JS, no build step, no backend. Data lives in
the browser's `localStorage` on whatever device you're using; see
**Sharing data between devices** below.

## Running it

Just open `index.html` in a browser, or serve the folder statically (e.g.
via GitHub Pages, or `python3 -m http.server` for local testing). There's no
build step and no dependencies to install.

## Features

- **Dashboard** (the default landing view) — this month's stats (sign-ups,
  assessments held, conversions, conversion rate), a To-Do preview, and a
  table of everyone who converted (sold after assessment) this month.
- **Board view** — 7 pipeline-stage sections (New Lead → Contacted →
  Assessment Scheduled → Assessment Outcome → Onboarding → Active Client →
  Program Review). On mobile these stack vertically as collapsible
  sections; on wider screens they lay out as a traditional side-by-side
  kanban board. Click a card to open the full client profile.
- **To-Do (Needs Action)** — a flat, urgency-sorted list pulled from every
  timer across the board: unowned leads, assessments due/overdue for an
  outcome, "Unsure" re-evaluations, and unsigned-contract / unpaid-invoice
  follow-ups.
- **Not a Fit / Alumni tabs** — searchable archives outside the main board
  flow. Alumni can be reactivated back into Onboarding for a new package.
- **Client profile** — full field set, onboarding checklist, threaded notes,
  and a full activity log (who did what, when) so anyone can pick up where
  someone left off. Opens full-screen on mobile.
- **CSV export/import** — a full snapshot export, a filtered "onboarding
  to-do" export (sorted by what's still outstanding), and CSV import to
  restore or share state between devices.
- **Tools menu** — export/import, sample data for exploring the app, and a
  full data reset.

## Design

Mobile-first, built for a phone in the field as much as a desktop at the
front desk. The placeholder brand palette (dark charcoal chrome + an amber
accent) lives entirely in `:root` custom properties at the top of
`styles.css` — swap those for exact brand hex codes (and drop in a real
logo in place of the "N9" mark in `index.html`) whenever you have them; no
other CSS needs to change.

## Sharing data between devices

This app has no shared backend — each device's `localStorage` is its own
copy. CSV export/import is the workaround: whoever made changes exports a
CSV and sends it to the next person, who imports it *before* making their
own edits. **Import replaces all local data** with the file's contents
(no merge), so the most recently exported file is the source of truth. For
a two-to-three-person team passing a file back and forth this keeps things
simple; it just means opening the app on a different device won't show
someone else's changes until you import their export.

## A couple of implementation notes vs. the spec

- **Assessment Outcome** is reached automatically (for display purposes)
  once a scheduled assessment's date has passed and no outcome has been
  recorded yet — no separate manual step needed to "enter" the decision
  point. Marking a client **Unsure** persists a literal `assessment_outcome`
  stage with a 7-day re-evaluation timer.
- **Onboarding auto-advance**: per the CSV section of the spec, a client
  moves from Onboarding to Active Client as soon as *"Training schedule
  built"* is checked, regardless of whether every other checklist item is
  also checked yet — outstanding paperwork can still be chased via Needs
  Action follow-ups after the client is active.
- **CSV columns**: the full/onboarding exports include all of the spec's
  suggested columns, plus a few extra ones (notes, activity log, and raw
  timer timestamps, JSON-encoded) so that an export → import round trip on
  a different device doesn't silently drop history.

## Data model

See `app.js` for the full `Client` object shape — it follows the spec's
rough data model in section 8, with a few extra timestamp fields
(`stageEnteredAt`, `contractSentAt`, `invoiceSentAt`, `unsureSetAt`) used to
drive the Needs Action timers.
