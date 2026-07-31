# Handoff: Unit Info — machine build component audit

## Overview
Unit Info is a fleet-wide as-is component record system for BB Rail Tech's 37 in-service
railroad machines (T-16 … T-57). The units were built and put in service without complete
component records; the app runs the backlog audit that closes that gap, and becomes the
system of record afterwards.

Three surfaces:
1. **Fleet** — every unit, its record coverage, and open engineering flags.
2. **Unit** — the as-is component list for one unit, by subassembly, with a detail panel.
3. **Audit** — a phone flow: one component line at a time, walking the machine.

The end goal is a trustworthy design BOM per machine. Records are captured offline on a
phone and synced to GitHub + the OneDrive workbook.

## About the design files
The files in this bundle are **design references created in HTML** — a working prototype of
the intended look and behavior, not production code to copy. The task is to **recreate
these designs in the target codebase's environment** using its established patterns and
libraries. There is no app codebase yet (the repo `cotyc-bbrailtech/unit-info` currently
holds only a README and the bundled prototype), so pick the stack:

- Recommended: React + Vite + TypeScript, deployed to GitHub Pages (already the intended host).
- Data layer: the audit must work offline (IndexedDB or localStorage queue) and sync when
  connectivity returns. Writes go to GitHub (commit JSON/CSV to the repo) and to a OneDrive
  spreadsheet (Microsoft Graph).

## Fidelity
**High-fidelity.** Colors, type, spacing, and states are final and come from the bound
"Industry" design system (see Design tokens). Recreate pixel-for-pixel, but source the
tokens from the design system's stylesheet rather than hard-coding values.

## Design system
The prototype consumes `_ds/industry-.../styles.css` — a CSS-only system (its manifest
declares no JS components). Port the token block and the component classes:

- `.blueprint` + four `<i class="corner tl|tr|bl|br">` children — the wireframe frame every
  card, figure, and primary button wears: square corners, 1px divider border, "+" registration
  marks bleeding 6px outside each corner. **Never round these and never drop the marks.**
- `.btn` / `.btn-primary` (solid steel accent, the one filled object) / `.btn-secondary`
  (hairline outline) / `.btn-ghost` / `.btn-block`
- `.tag` / `.tag-accent` / `.tag-neutral` / `.tag-outline`
- `.card` (transparent, hairline, square) with `.card-kicker`, `.card-title`, `.card-meta`
- `.field` + `label` + `.input`, `.seg` + `.seg-opt` (segmented control)
- `.nav` + `.nav-brand`, `.table`, `.duotone` (image wrapper), `.text-muted`

Icons are Lucide at stroke-width 1.5, inline SVG on `currentColor`. Icons used:
`arrow-left` (back), `chevron-right` (group caret, rotated 90° when open), `check`
(mark verified), `flag` (flag for engineering), `camera` (take photo).

## Screens / views

### 1. Top bar (all views)
- `.nav` bar, `justify-content:space-between`, padding `var(--space-3) var(--space-6)`,
  1px bottom divider, `position:sticky; top:0; z-index:20`, background `var(--color-bg)`.
- Left: `.nav-brand` reading `UNIT INFO` (Barlow Condensed 600, 18px).
- Right: sync indicator — 7×7px solid accent square + muted 12px text, e.g.
  "3 queued · last sync 4m ago", or "all records synced" when the queue is empty.
- Right: `.seg` segmented control with two `.seg-opt` radios — **Review** / **Audit**.
  Selected option fills with the accent and reverses type to `--color-bg`.
- On phones (≤760px) the bar wraps, the segmented control moves to its own row (order:3),
  and it takes `env(safe-area-inset-top/left/right)` padding.

### 2. Fleet
Purpose: see where the record backlog is worst and pick the next unit to audit.

- Container: flex column, gap `var(--space-6)`, padding `var(--space-8) var(--space-6) 56px`,
  `max-width:1120px`.
- `<h1>` "Fleet" (Barlow Condensed 600, 42px, letter-spacing -0.015em) + one muted 14px
  summary line: "37 units · N% of component lines on record · N flagged for engineering
  (duplicate serials included)".
- One `.blueprint` panel (padding `var(--space-4)`, corner marks) wrapping a `.table`:
  | Unit (70px) | Chassis VIN (172px) | Subassemblies | Record coverage (200px) | Flags (80px) | Last audit (110px) |
  - Unit: 700 weight, tabular numerals.
  - VIN: muted 12px.
  - Subassemblies: wrapping row of `.tag.tag-neutral` chips, gap 4px; "Vision — " is
    abbreviated to "V: " in chips.
  - Coverage: 6px-tall track `var(--color-neutral-300)` + accent fill at coverage %, then a
    right-aligned 12px tabular percentage in a 34px column.
  - Flags: 700 weight; `var(--color-accent-800)` when > 0, `var(--color-neutral-400)` em-dash when 0.
  - Rows are sorted ascending by coverage (worst first), hover tint
    `color-mix(in srgb, var(--color-text) 4%, transparent)`, whole row clickable → Unit view.
- Phones: `thead` hidden; each `<tr>` becomes a block record with a bottom divider; each
  `<td>` is a flex row rendering its `data-label` as a 10px uppercase muted label on the
  left and the value right-aligned; the unit cell renders at 20px in Barlow Condensed with
  no label.

### 3. Unit
Purpose: review one machine's as-is list and fix a single line.

- Back link: `arrow-left` icon + "Fleet", 12px.
- Header: `<h2>` unit id (32px) + muted 12.5px tabular line
  "VIN <vin> · N lines · N subassemblies · N/N on record", and a primary
  `.btn.btn-primary.blueprint` "Continue audit" on the right.
- Two columns: `minmax(0,1fr) 360px`, gap `var(--space-6)`, `align-items:start`.

**Left — component list** (`.blueprint`, vertical padding `var(--space-4)`, no horizontal padding):
- One collapsible group per subassembly, each separated by a 1px
  `color-mix(in srgb,var(--color-text) 8%,transparent)` rule.
- Group header row: caret icon (rotates 0→90°, 150ms), name in Barlow Condensed 600 17px,
  spacer, muted 12px "verified/total", then a 64×5px coverage track with accent fill.
  Whole header toggles open/closed. First group defaults open.
- Line row grid: `12px 112px minmax(0,1fr) 90px`, gap `var(--space-3)`,
  padding `7px var(--space-4) 7px var(--space-8)`:
  1. 8×8px status square (color per status, below)
  2. part number, 700 weight 13px
  3. description, 13.5px, ellipsis on overflow
  4. status label, right-aligned, 11px uppercase, letter-spacing .06em, muted
  Selected line: background `var(--color-accent-100)` + `inset 2px 0 0 var(--color-accent)`.
- Phones: grid collapses to `12px minmax(0,1fr) 84px`, description hidden.

**Right — detail panel** (`.card.blueprint`, gap `var(--space-4)`, `position:sticky; top:80px`;
static on phones):
- Part number (Barlow Condensed 600, 22px) + description (13.5px), status tag top-right.
- Photo figure: `.blueprint.duotone`, 130px tall, background
  `repeating-linear-gradient(135deg, color-mix(in srgb,var(--color-text) 7%,transparent) 0 1px, transparent 1px 8px)`,
  centered `figcaption` — "field photo · <part>.jpg" or "no photo on record".
  **Replace with a real photo capture/upload control in production.**
- "Rated capacity" block (only when the part carries a spec) — e.g. the Serco 8500:
  `Capacity 1: 12,282 lb @ 5'-0" · Capacity 2: 3,226 lb @ 25'-0"`.
- `.field` + `.input` **Serial number** — editable, placeholder "not recorded".
- 2-column grid of read-only fields: Revision ("rev D"), Location on unit, Subassembly.
- Note block: 10px uppercase muted label + 13px body.
- Two buttons, equal width: `.btn-secondary` "Verified" (check icon) and `.btn-primary` "Flag".

### 4. Audit (phone)
Purpose: walk the machine and clear lines one at a time.

On desktop this renders inside a device mock: 392px wide, 10px `var(--color-neutral-900)`
bezel, 38px outer / 30px inner radius, 740px screen. **On phones (≤760px) the bezel, its
radius, and the fake status bar are removed and the screen fills the viewport** — the mock
is presentation only, not part of the design.

Screen structure, top to bottom:
1. Status bar mock (desktop only): "9:41" / "LTE", 12px tabular.
2. Header: unit id (Barlow Condensed 600, 19px) + muted 11.5px subassembly name, progress
   "7 / 24" right-aligned; below it a 5px track with accent fill at step/total.
3. Body (`flex:1`, padding `var(--space-4)`, gap `var(--space-4)`):
   - `.card.blueprint`: `.card-kicker` location path + status tag; part number at 27px
     Barlow Condensed 600; description 14px; `.tag.tag-neutral` "rev B"; `.field` + `.input`
     serial with placeholder "type or read from the nameplate"; photo figure (104px, same
     treatment as the detail panel); `.btn-secondary.btn-block` "Take photo" / "Retake photo"
     with camera icon.
   - Flag banner (conditional): `.blueprint` with `border-color:var(--color-accent)`,
     `background:var(--color-accent-100)`, a 10px uppercase heading
     ("Duplicate serial — engineering review" or "Flagged for engineering") in
     `--color-accent-800` and the note in `--color-accent-900`.
   - Spacer, then the action stack pinned to the bottom:
     - Row 1: `.btn-primary.blueprint` "Present, as listed" (`flex:1`, padding 14px) +
       `.btn-secondary` "Differs" (104px wide).
     - Row 2: `.btn-secondary` "Back" + `.btn-secondary` "Not present", equal width.
4. Footer bar: 1px top divider; muted "N queued" with a 6px accent square; `.btn-ghost`
   "Sync now". Takes `env(safe-area-inset-bottom)` padding on phones.

Hit targets in the audit flow are ≥44px tall — the primary actions are 14px padding on
14px Barlow Condensed.

## Interactions & behavior

- **Navigation**: fleet row click → Unit view (resets selection, open groups, and audit step).
  Segmented control: Review → Unit view, Audit → phone flow. Back link → Fleet.
- **Group toggle**: click header; caret rotates 90° over 150ms.
- **Line select**: click a line → detail panel shows it. First line of the first group is
  the default selection.
- **Serial entry** (both the detail panel and the audit card): on change, write to the record.
  Duplicate detection runs immediately — see below.
- **Mark verified / Flag** (detail panel): set status; a flag writes an engineering note.
- **Audit actions**:
  - "Present, as listed" — if `requirePhoto` is on and no photo exists, the first press
    captures the photo instead of advancing (guard rail); otherwise mark verified, add a
    note, advance a step, and increment the sync queue.
  - "Differs" — mark flagged with the supersession note; stay on the line.
  - "Not present" — mark absent with the "mounting provisions capped" note and advance.
  - "Back" — previous line (clamped at 0). Steps clamp at the last line.
  - "Sync now" — clears the queue to 0.
- **Responsive**: single breakpoint at 760px, described per screen above.
- No page-level animation beyond the caret rotation; keep it that way — this is a shop-floor tool.

### Status model
| Status | Label | Tag | Square color |
| --- | --- | --- | --- |
| verified | Verified | `.tag.tag-accent` | `var(--color-accent)` |
| dup | Duplicate serial | `.tag.tag-outline` | `var(--color-accent-800)` |
| flagged | Flagged | `.tag.tag-outline` | `var(--color-accent-800)` |
| absent | Not present | `.tag.tag-neutral` | `var(--color-neutral-400)` |
| open | Unverified | `.tag.tag-neutral` | `var(--color-neutral-300)` |

### Duplicate serial rule (important)
A serial number may exist on exactly one line in the whole fleet.

- Maintain an index of `serial → [ "<unit> · <part>", … ]` derived from current records
  (user-entered values override imported ones). Rebuild it whenever any record changes, so
  **both** sides of a collision re-evaluate in the same render.
- Any line whose serial appears elsewhere becomes `dup`, with the note:
  "Serial <s> is also recorded on <unit · part>. A serial can only sit on one unit —
  engineering to resolve."
- Clearing or correcting a serial clears the flag on both sides. Clearing a serial entirely
  drops the line back to `open` — only `absent` and an explicit user flag survive an
  empty serial.
- Coverage counts a line as on record **only** when a real serial exists. Flags count
  `flagged` + `dup`.
- Known collisions in the imported sheet: T-16/T-53 (27431), T-43/T-47 (34946),
  T-24/T-25 (30068), T-25/T-57 (30067). Treat these as data to be resolved, not as bugs.

## State management

Prototype state (port to a store — Zustand/Redux/context — with persistence):
- `view`: 'fleet' | 'machine' | 'phone'
- `unit`: index of the selected unit
- `openGroups`: { [subassemblyCode]: boolean }
- `sel`: selected line key (`"<SUB>:<PART>"`)
- `records`: { `"<unitId>|<lineKey>"`: { status, serial, photo, note } } — the only mutable data
- `step`: current audit line index
- `queue`: count of unsynced records

Derived (memoize; the prototype caches on a version counter because recomputing coverage for
37 units on every render is expensive):
- per-unit coverage { total, verified, flags, pct }
- the fleet-wide serial index

Props exposed as tweaks in the prototype: `startView` (enum), `requirePhoto` (boolean).

Production data requirements:
- Import the master list per unit (subassembly → parts with part number, description, rev,
  location path, whether it carries a serial).
- Persist records offline; queue and push to GitHub (commit JSON/CSV) and to the OneDrive
  workbook via Microsoft Graph. Show the queue count and last-sync time in the top bar.
- Photo capture and storage (the prototype only toggles a boolean).
- Auth/identity: notes are attributed to a person in production.

## Design tokens (from the Industry design system)

Colors
- `--color-bg` #f2f2f3 · `--color-surface` #e9e9ea · `--color-text` #1d1f20
- `--color-accent` #5980a6 (the only accent — do not add decorative color)
- `--color-divider` `color-mix(in srgb, #1d1f20 16%, transparent)`
- accent ramp: 100 #eef6ff · 200 #d6ebff · 300 #b5d9fd · 400 #94bce3 · 500 #749dc4 ·
  600 #597ea3 · 700 #416180 · 800 #2c455d · 900 #1d2d3d
- neutral ramp: 100 #f5f5f8 · 200 #e7e7ea · 300 #d4d4d7 · 400 #b7b7ba · 500 #98989b ·
  600 #7a7a7d · 700 #5d5d60 · 800 #424244 · 900 #2b2b2d
- muted text: `color-mix(in srgb, var(--color-text) 55%, transparent)`

Type
- headings `--font-heading` "Barlow Condensed" weight 600; body `--font-body` "Barlow" 400
- base 15px / 1.55; h1 42 · h2 32 · h3 25 · h4 20 · h5 16 · h6 13 (uppercase, .08em)
- headings line-height 1.12, letter-spacing -0.015em
- tabular numerals on all serials, VINs, counts, and percentages

Spacing (0.85× scale)
- `--space-1` 3.4px · `-2` 6.8 · `-3` 10.2 · `-4` 13.6 · `-6` 20.4 · `-8` 27.2

Radius — `--radius-sm` 2px · `--radius-md` 4px · `--radius-lg` 7px, but the blueprint layer
overrides cards, buttons, inputs, tags, and segmented controls to **0**.

Shadows — `--shadow-sm/md/lg`; the design uses none (line drawings, not elevation).

States (built into the stylesheet — do not restyle per screen)
- `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }`
- primary button hover `--color-accent-600`, active `--color-accent-700`
- secondary hover `color-mix(in srgb, var(--color-text) 7%, transparent)`
- disabled 45% opacity; `::selection` a 30% accent tint

## Data

`data/units.csv` — the real fleet data, transcribed from
`uploads/Unit vin,rail,loader.docx`: 37 units with Mack chassis VIN, DMF-1650 rail gear
front/rear serials, and Serco 8500 loader serial. T-55 and T-56 have no gear or loader
serials recorded (they read 0% coverage — correct, not a bug).

Subassemblies modelled:
- **Common (all units)**: Rail Gear — DMF-1650; Loader — Serco 8500 series; Magnet System
- **Optional (per unit)**: Vision — Tie Detection; Vision — VGR; Robot; Conveyor

Part numbers and descriptions below the top level are **placeholders** except:
- `DMF-1650-F` / `DMF-1650-R` — front/rear rail gear assemblies (serialised)
- `SERCO-8500` — Serco 8500 series loader, main assembly (serialised),
  Capacity 1: 12,282 lb @ 5'-0", Capacity 2: 3,226 lb @ 25'-0"

Replace the rest with the real parts lists before shipping.

## Assets
No bitmap assets. Photo areas are hairline-framed hatch placeholders — wire them to real
capture/upload. Icons are Lucide (stroke 1.5), inline SVG. Fonts are Barlow and Barlow
Condensed from Google Fonts.

## Files in this bundle
- `Unit Info.dc.html` — the prototype (markup + logic in one file). Open in a browser.
- `index.html` — self-contained build of the same prototype, no local dependencies.
- `industry-design-system/styles.css` — the design system stylesheet (tokens + components).
- `industry-design-system/readme.md` — the design system's own usage rules. Read this before styling.
- `data/units.csv` — the real per-unit VIN and serial data.

## Suggested first steps
1. Scaffold the app; port `styles.css` tokens and component classes as-is.
2. Model the data (units, subassemblies, parts, records) and load `units.csv`.
3. Build Fleet → Unit → Audit in that order; the duplicate-serial rule is the first piece of
   real logic worth unit-testing.
4. Then offline persistence and the GitHub / OneDrive sync.
