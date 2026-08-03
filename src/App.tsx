import { useMemo } from 'react'
import { AuditView } from './components/AuditView'
import { FleetView } from './components/FleetView'
import { TopBar } from './components/TopBar'
import { SubsView } from './components/SubsView'
import { UnitView } from './components/UnitView'
import { VueView } from './components/VueView'
import { buildFleet } from './lib/fleet'
import { resolveFleet } from './lib/records'
import { useStore } from './store/useStore'

export default function App() {
  const view = useStore((s) => s.view)
  const unitId = useStore((s) => s.unitId)
  const records = useStore((s) => s.records)
  const overrides = useStore((s) => s.overrides)

  // The fleet is derived: admin edits to the master parts lists and to fitment
  // rebuild it. Resolving 37 units is the expensive step, so both are memoised.
  const fleet = useMemo(() => buildFleet(overrides), [overrides])
  const resolution = useMemo(() => resolveFleet(fleet, records), [fleet, records])
  const unit = fleet.find((u) => u.id === unitId) ?? fleet[0]

  return (
    <div className="app">
      <TopBar />
      {view === 'fleet' && <FleetView fleet={fleet} resolution={resolution} />}
      {view === 'vue' && <VueView />}
      {view === 'subs' && <SubsView fleet={fleet} />}
      {view === 'machine' && <UnitView unit={unit} resolution={resolution} />}
      {view === 'phone' && <AuditView unit={unit} resolution={resolution} />}
    </div>
  )
}
