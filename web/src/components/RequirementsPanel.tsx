import type { Material, Requirements } from '../types'

const fields = [
  ['tip_force_N', 'End load', 'N'],
  ['span_mm', 'Span', 'mm'],
  ['width_mm', 'Interface width', 'mm'],
  ['max_height_mm', 'Height limit', 'mm'],
  ['max_tip_deflection_mm', 'Deflection limit', 'mm'],
]
export const shortCondition = (id: string) => id.split('-').at(-1) || id

type Props = {
  materials: Material[]
  materialId: string
  scenario: string
  requirements: Requirements
  busy: boolean
  metaBusy: boolean
  connected: boolean
  dirty: boolean
  onMaterial: (v: string) => void
  onScenario: (v: string) => void
  onRequirement: (key: string, value: number) => void
  onRun: () => void
  onMeta: () => void
}
export function RequirementsPanel(p: Props) {
  const selected = p.materials.find((m) => m.id === p.materialId)
  return (
    <aside className="requirements-rail" aria-label="Design requirements">
      <h2>Design requirements</h2>
      <label className="stacked">
        Material
        <select
          disabled={p.busy || p.metaBusy}
          value={p.materialId}
          onChange={(e) => p.onMaterial(e.target.value)}
        >
          {p.materials.map((m) => (
            <option key={m.id} value={m.id}>
              Recycled PP · {shortCondition(m.id)}
            </option>
          ))}
        </select>
      </label>
      <p className="helper">{selected?.specimens ?? '—'} specimens · measured condition</p>
      <label className="stacked scenario">
        Scenario
        <select
          disabled={p.busy || p.metaBusy}
          value={p.scenario}
          onChange={(e) => p.onScenario(e.target.value)}
        >
          <option value="lower_sensitivity">Lower sensitivity</option>
          <option value="nominal">Measured means</option>
        </select>
      </label>
      <div className="numeric-fields">
        {fields.map(([key, label, unit]) => (
          <label className="numeric-field" key={key}>
            <span>{label}</span>
            <span className="unit-input">
              <input
                disabled={p.busy || p.metaBusy}
                type="number"
                aria-label={label}
                min="0.1"
                step={key === 'tip_force_N' ? 1 : 0.5}
                value={p.requirements[key] ?? ''}
                onChange={(e) => p.onRequirement(key, Number(e.target.value))}
              />
              <span>{unit}</span>
            </span>
          </label>
        ))}
      </div>
      <button className="primary run-button" onClick={p.onRun} disabled={p.busy}>
        {p.busy ? 'Calculating…' : 'Run design search'}
      </button>
      {p.dirty && (
        <p className="pending-note" role="status">
          Inputs changed. Run the search to update results.
        </p>
      )}
      <section className="meta-action">
        <h2>Meta candidates</h2>
        <button
          className="outline-button"
          disabled={!p.connected || p.busy || p.metaBusy || p.dirty}
          onClick={p.onMeta}
        >
          {p.metaBusy ? 'Evaluating Meta proposals…' : 'Ask Meta for candidates'}
        </button>
        <p className="helper">
          {p.connected ? 'Meta configured · live proposals on request.' : 'Meta is not connected.'}
        </p>
      </section>
      <details className="model-details">
        <summary>Calculation assumptions</summary>
        <p>
          Static bending, a perfect clamp and a homogeneous linear material. Local buckling, creep,
          fatigue and impact are unverified.
        </p>
        <p>
          The lower scenario uses mean minus twice specimen SD. It is not a batch reliability bound.
        </p>
      </details>
    </aside>
  )
}
