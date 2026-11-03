import type { Material, Requirements } from '../types'

const fields = [
  ['tip_force_N', 'Load at tip', 'N'],
  ['span_mm', 'Length', 'mm'],
  ['width_mm', 'Width', 'mm'],
  ['max_height_mm', 'Max height', 'mm'],
  ['max_tip_deflection_mm', 'Max tip movement', 'mm'],
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
    <aside className="requirements-rail" aria-label="Design setup">
      <h2>Design setup</h2>
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
      <p className="helper">Based on {selected?.specimens ?? '—'} tested samples</p>
      <label className="stacked scenario">
        Material values
        <select
          disabled={p.busy || p.metaBusy}
          value={p.scenario}
          onChange={(e) => p.onScenario(e.target.value)}
        >
          <option value="lower_sensitivity">Lower estimate</option>
          <option value="nominal">Measured averages</option>
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
        {p.busy ? 'Calculating…' : 'Find a design'}
      </button>
      {p.dirty && (
        <p className="pending-note" role="status">
          Your settings changed. Find a design to update the results.
        </p>
      )}
      <section className="meta-action">
        <h2>Design with Meta</h2>
        <button
          className="outline-button"
          disabled={!p.connected || p.busy || p.metaBusy || p.dirty}
          onClick={p.onMeta}
        >
          {p.metaBusy ? 'Generating and checking…' : 'Suggest designs'}
        </button>
        <p className="helper">
          {p.connected ? 'Generate a few ideas, then compare them.' : 'Meta is not connected.'}
        </p>
      </section>
      <details className="model-details">
        <summary>How the model works</summary>
        <p>
          Checks bending under a steady load with one end fixed and uniform material properties.
          Buckling, creep, fatigue and impact are outside this check.
        </p>
        <p>
          The lower estimate subtracts twice the sample standard deviation from measured stiffness
          and strength.
        </p>
      </details>
    </aside>
  )
}
