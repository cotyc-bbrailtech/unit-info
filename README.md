# Unit Info

Fleet-wide as-is component record system for BB Rail Tech's 37 in-service railroad machines
(T-16 … T-57). Runs the backlog audit that closes the component-record gap, then becomes the
system of record.

Four surfaces: **Fleet** (record coverage across the fleet), **Unit** (one machine's as-is
component list), **Audit** (a phone flow, one component line at a time), and **Vue licences**
(the Apera Vue vision inventory, reached from the Fleet header).

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
| `src/store/useStore.ts` | App state, persisted to localStorage. |

## The duplicate-serial rule

A serial number may exist on exactly one line in the whole fleet. `resolveFleet()` rebuilds the
`serial → lines` index on every record change, so both sides of a collision re-evaluate in the
same render. Coverage counts a line as on record only when a real serial exists; flags count
`flagged` + `dup`.

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

### The PIN is not a security control

There is no server. The app is a static bundle, so the PIN ships in the JavaScript and anyone
can read it in devtools — and 4 digits is 10,000 combinations regardless. It exists to stop an
auditor mid-walk from changing the master parts list by accident, and the unlock dialog says as
much. Admin state is deliberately **not persisted**: a reload re-locks.

Real access control needs the identity story this app doesn't have yet (see *Not yet wired*).
Do that when you wire the sync — pushing to GitHub and OneDrive needs authentication anyway,
and that is where a genuine permission boundary belongs.

## Vision systems

Which machines carry a vision system comes from the Apera Vue licence sheet, not from the app.
Of 17 Vue systems, only **4 sit on a machine** — T-50, T-32, T-36, T-34, all Tie Detection,
Rev A — and all four are *location estimates* the sheet never confirmed, so they import as
"not yet confirmed on the machine" and the audit is what closes them. **No machine has a VGR
system**; every VGR unit is in the office, lab, or stock. Nine systems have no location
recorded at all — that is the real backlog, and the Vue licences view lists it first.

### Tie Detection parts

The subassembly is the Apera Vue system plus an industrial camera, an LED bar illuminator, a
Mitsubishi `FX5UC-32MR/DS-TS` PLC, and a GigE PoE Ethernet switch. There is no edge compute
unit — the PLC does that job.

The camera is **revision-dependent**: rev A is a Basler, rev B an IDS rolling shutter. That
variant resolves from the machine's Vue revision (`byRev` in `src/data/subassemblies.ts`), which
is the only revision the app holds — if camera revision turns out to track something other than
the licence revision, that mapping is the thing to change. All four machines are rev A today, so
all four show the Basler.

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
