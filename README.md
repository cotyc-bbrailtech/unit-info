# Unit Info

Fleet-wide as-is component record system for BB Rail Tech's 37 in-service railroad machines
(T-16 … T-57). Runs the backlog audit that closes the component-record gap, then becomes the
system of record.

Five surfaces: **Fleet** (record coverage across the fleet), **Unit** (one machine's as-is
component list), **Audit** (a phone flow, one component line at a time), **Vue licences** (the
Apera Vue vision inventory), and **Subassemblies** (admin only — design the master parts lists).
The last two are reached from the Fleet header.

## Stack

React 19 + Vite + TypeScript, Zustand for state, Vitest for tests. Deploys to GitHub Pages
via `.github/workflows/deploy.yml`.

```bash
npm install
npm run dev
```

`npm test` runs the duplicate-serial and coverage rules. `npm run build` typechecks and builds.

## Layout

| Path | What's in it |
| --- | --- |
| `src/styles/industry.css` | The Industry design system, verbatim. Do not edit per-screen. |
| `src/styles/app.css` | Layout only — every value reads from the design system's tokens. |
| `src/data/units.csv` | The real fleet data: chassis VIN, rail gear front/rear serials, loader serial. |
| `src/data/vue-licenses.csv` | The Apera Vue vision inventory, from "Vue license notes.docx". |
| `src/data/subassemblies.ts` | The parts list per subassembly. |
| `src/lib/records.ts` | Serial index, duplicate rule, coverage. The core logic. |
| `src/lib/vue.ts` | Vue licence parsing and the machine → vision-system mapping. |
| `src/lib/overrides.ts` | Admin edits layered over the imported data. |
| `src/lib/xlsx/` | Dependency-free OOXML read/write (zip, xml, read, write). |
| `src/lib/master/` | The workbook contract, export, and import validation. |
| `src/components/SubsView.tsx` | The admin subassembly design page. |
| `src/store/useStore.ts` | App state, persisted to localStorage. |

## The duplicate-serial rule

A serial number may exist on exactly one line in the whole fleet. `resolveFleet()` rebuilds the
`serial → lines` index on every record change, so both sides of a collision re-evaluate in the
same render. Flags count `flagged` + `dup`.

## What counts as verified

This **deviates from the handoff**, which says a line counts only when a real serial exists.
Taken literally that made the audit pointless: only four part types carry serials
(`DMF-1650-F`, `-R`, `SERCO-8500`, `APERA-VUE-*`), so roughly three lines in twenty could ever
be verified, and "Present, as listed" was a silent no-op on all the rest. The rule is now split
by whether the part can carry a serial at all:

- **Parts with a serial slot** — the serial is the evidence. No serial, no verified standing,
  and clearing a serial drops the line back to `open` exactly as the handoff describes.
- **Parts without one** — the auditor confirming it on the machine *is* the evidence, so an
  explicit verify stands on its own.

So coverage means "lines confirmed", and walking a machine moves it. Expect percentages to climb
as auditing starts; they are not comparable to figures from before this change.

Known collisions in the imported sheet — data to be resolved, not bugs:
T-16/T-53 (27431), T-43/T-47 (34946), T-24/T-25 (30068), T-25/T-57 (30067).

## Admin mode

The **Admin** button in the top bar takes a 4-digit PIN (`4471`, in
`src/store/useStore.ts`) and unlocks editing:

- **Parts** — part number, description, revision, and location, on the **master list**. Editing
  a part on one machine changes it for every machine carrying that subassembly; the editor says
  so. Also add and remove parts.
- **Fitment** — fit or strike a whole subassembly on a single machine. This is how to replace
  the hash-derived Robot/Conveyor guesses with real data.
- **Machine identity** — chassis VIN and the imported rail gear / loader serials.

Edits are stored as an overlay (`Overrides`) rather than by rewriting the source data, so the
CSVs stay the record of what was imported and any edit can be traced or reset
(`resetOverrides`). The fleet is rebuilt from `buildFleet(overrides)` on every change.

Parts carry a stable `id` separate from the part number, so **renaming a part number does not
orphan the records already captured against it**. Built-in parts adopt their part number as
their id the first time a subassembly is edited.

### Master data workbook

Admin mode exports and imports the master data as a single `.xlsx`. Seven sheets, in reading
order:

| Sheet | What it is |
| --- | --- |
| `0 Read Me` | The contract, and the provenance stamp the importer checks. |
| `1 Subassemblies` | **Editable.** Which subassemblies exist, and their names. Add a row to create one. |
| `2 Parts` | **Editable.** The master parts lists — one row per part. |
| `3 Part Variants` | **Editable.** Revision-dependent parts (the rev A / rev B camera). |
| `4 Units` | **Editable.** Per machine: VIN, imported serials, and an `X` per fitted subassembly. |
| `5 Unit Lines (read-only)` | Every machine's full line list, flattened. What the audit walks. |
| `6 Vue Licences (read-only)` | The Apera Vue inventory. |

The `fit_*` columns on `4 Units` are generated from whatever subassemblies exist, so creating one
on sheet 1 adds its column on the next export. Sheet 1 is the authority: a `2 Parts` row or a
`fit_` column for a code it does not declare is rejected.

Two rules keep it self-documenting, and the importer enforces them rather than holding a second
list: **a sheet whose name ends `(read-only)` is never read back**, and **a column whose header
starts `derived_` is never read back**.

`part_id` is the load-bearing column. It is the identity audit records are keyed to, so renaming
`part_number` is safe and renaming `part_id` detaches every serial and note captured against that
part. The Read Me sheet says so; `2 Parts` shows the id greyed beside the editable number.

**Import replaces everything.** The workbook fully determines the result — a part or a fitment
mark absent from the file is removed. There is no undo; export first if you want a way back.
Two things temper that:

- **It validates before it writes.** Wrong provenance, unknown schema version, a missing sheet or
  column, an unknown `sub_code` or `serial_slot`, a duplicate `part_id`, a blank `part_number`, an
  orphan variant, an unknown machine, or a *missing* machine — any of these rejects the whole file
  and nothing is written. Replacing with a malformed file is corruption, not replacement.
- **It writes a minimal diff.** A subassembly or machine the workbook did not actually change gets
  no override at all, so it keeps tracking `units.csv`, `vue-licenses.csv` and `subassemblies.ts`
  rather than being frozen at the value it happened to have on export day.

The roster is fixed: import cannot add or remove a machine, because `buildFleet` maps over
`units.csv`. Deleting a row on `4 Units` is rejected rather than silently reverting that machine.

Only files this app wrote are accepted — the `0 Read Me` provenance stamp is what makes a
hand-rolled reader safe. The workflow is always **export first, edit that file, import it back**.

### xlsx with no dependencies

`src/lib/xlsx/` reads and writes OOXML directly — about 450 lines over a hand-rolled ZIP
container, no packages added. The app is a public static bundle with three runtime dependencies
and every dependency here executes in a stranger's browser tab; the alternatives cost 5–216
packages, and SheetJS's npm build carries two unfixed HIGH advisories. This is only safe because
the problem is narrow: **every cell is text**, so there is no number format or date serial to
misread, and the provenance gate means the reader only ever sees files this app produced.

Writing uses STORE (uncompressed), so export works in any browser. Reading needs
`DecompressionStream('deflate-raw')` — Chrome 103+, Firefox 113+, Safari 16.4+ — because Excel
always deflates. That is feature-detected: import says so plainly on an older browser and export
still works.

Everything sits behind `await import('./lazy')`, so it is a ~9 KB gzip chunk that downloads only
when an admin clicks Export or Import. An auditor on a phone never fetches it.

`src/lib/master/__fixtures__/master-excel-roundtrip.xlsx` is the real workbook after a trip
through **Excel for Windows** — opened, edited in Excel, re-saved. Excel rewrites it into shared
strings and deflate, so that fixture is what proves the reader handles a real producer rather than
just its own output. Our own writer's output needs no fixture: the tests generate it in memory.

Re-cut it whenever `SCHEMA_VERSION` or the master data changes, or an import of the stale file
will quietly revert whatever moved on. **Copy it somewhere else before opening it in Excel** —
Excel writes back to the file it opened, so editing the fixture in place overwrites it.

### Subassembly design page

Admin gets a dedicated page (Fleet header → **Subassemblies**) for structural work: create a
subassembly, rename one, and edit its parts list in bulk. The Unit view keeps its in-context
single-part editing — fix a line while you're looking at the machine it's on.

**A subassembly's code is identity, not a label.** It is in every audit record key
(`"T-16|RG:DMF-1650-WH"`), in generated part ids, and in the workbook's `fit_RG` headers. So the
name and kind are editable and **the code is frozen once chosen** — changing it would detach
every serial and note captured under it, the same failure `part_id` exists to prevent. A new code
may never shadow a built-in either; that would silently re-point existing records at a different
parts list.

`kind` (common/optional) is **descriptive only**. It fits nothing to any machine. `defaultSubs`
uses a separately hardcoded `COMMON = ['RG','LD','MG']` and deliberately does not read `kind` —
deriving fitment from it would refit all 37 machines the moment someone re-kinds a subassembly
here. There is a test guarding that.

The page also exposes `serial_slot`, `spec` and `byRev`, which had no editor anywhere before.
`serial_slot` matters most: `onRecord: !!p.slot` decides whether a line can ever be verified, so
without it a new subassembly could never carry a serial without a trip through Excel.

Parts order is **functional** — `linesFor` maps the array in order and the audit walks lines in
that order, so the list order is the order someone walks the machine. Move up/down lives in the
row drawer.

Edits are stored as `Overrides.subs`, one record per subassembly (`name`, `kind`, `parts`), each
field absent when it still tracks `subassemblies.ts`. Persisted state migrates from the old
`overrides.parts` map at zustand persist version 1; records and the sync queue are untouched.

### The PIN is not a security control

There is no server. The app is a static bundle, so the PIN ships in the JavaScript and anyone
can read it in devtools — and 4 digits is 10,000 combinations regardless. It exists to stop an
auditor mid-walk from changing the master parts list by accident, and the unlock dialog says as
much. Admin state is deliberately **not persisted**: a reload re-locks.

Real access control needs the identity story this app doesn't have yet (see *Not yet wired*).
Do that when you wire the sync — pushing to GitHub and OneDrive needs authentication anyway,
and that is where a genuine permission boundary belongs.

## Vision systems

Which machines carry a vision system comes from the Apera Vue licence data, not from the app.
Of 18 Vue systems, **5 sit on a machine**:

- **T-50, T-32, T-36, T-34** — Tie Detection, Rev A, Basler camera. All four are *location
  estimates* the sheet never confirmed, so they import as "not yet confirmed on the machine"
  and the audit is what closes them.
- **T-53** — Tie Detection, **Rev B**, IDS rolling shutter camera, location confirmed.

**No machine has a VGR system**; every VGR unit is in the office, lab, or stock. Nine systems
have no location recorded at all — that is the backlog, and the Vue licences view lists it first.

### The licence sheet is out of date

`000-20240222-0421` (T-53) does **not** appear in "Vue license notes.docx" — it postdates every
serial in it, all of which are 2022 or 2023. So the sheet is not a complete inventory. Treat the
nine unlocated rows as a floor, not the full backlog: there are likely other systems missing from
it entirely, and reconciling that is worth doing before trusting the counts above.

### Tie Detection parts

The subassembly is the Apera Vue system plus an industrial camera, an LED bar illuminator, a
Mitsubishi `FX5UC-32MR/DS-TS` PLC, and a GigE PoE Ethernet switch. There is no edge compute
unit — the PLC does that job.

The camera is **revision-dependent**: rev A is a Basler, rev B an IDS rolling shutter. That
variant resolves from the machine's Vue revision (`byRev` in `src/data/subassemblies.ts`), which
is the only revision the app holds — if camera revision turns out to track something other than
the licence revision, that mapping is the thing to change. Four machines are rev A and show the
Basler; T-53 is rev B and shows the IDS.

Part numbers for the camera, illuminator, and switch are still internal placeholders
(`VT-####-##`); only the PLC carries its real manufacturer number.

### Credentials are deliberately absent

The source sheet carries TeamViewer IDs and passwords for these systems. **None of it is in
this repo**, and none of it should be: the app is a static bundle served publicly from GitHub
Pages, so anything committed here is readable by anyone with the URL. `src/lib/vue.test.ts`
asserts the bundle stays clean. Keep remote-access credentials in a password manager.

## Not yet wired

- **Sync.** Records persist offline and queue locally; `Sync now` clears the queue. Pushing to
  GitHub (commit JSON/CSV) and the OneDrive workbook (Microsoft Graph) needs credentials and an
  auth story that don't exist yet — see `sync` in `src/store/useStore.ts`.
- **Photos.** The audit and detail panels toggle a boolean over a hatch placeholder. Replace
  with a real capture/upload control and storage.
- **Auth/identity.** Notes are unattributed; production should attach a person. Admin mode is a
  UI lock, not authentication — see above.
- **Parts data.** Rail Gear, Loader, Magnet, Robot, and Conveyor part lists below the top level
  are still placeholders; real so far are `DMF-1650-F`, `DMF-1650-R`, `SERCO-8500`, and the whole
  of Vision — Tie Detection. **Robot and Conveyor assignment is still derived from a hash of the
  unit id**, as are the last-audit dates — replace with the real master list.

## Design

`design_handoff_unit_info/` holds the original handoff: the prototype, the design system, and
the source CSV. The prototype is the fidelity reference — square corners, hairline borders, and
the four `+` registration marks on every `.blueprint` element are not optional.
