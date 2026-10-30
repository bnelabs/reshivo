import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { CounterweightResult, ProductCatalog } from '../types'

const quantity = (value: number, digits = 3) =>
  value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })

export function PublishedExample({
  catalog,
  active,
}: {
  catalog: ProductCatalog
  active: boolean
}) {
  const [conditionId, setConditionId] = useState('CECON21-PCRPE100')
  const [volume, setVolume] = useState('1037.06')
  const [targetMin, setTargetMin] = useState('0.98')
  const [targetMax, setTargetMax] = useState('1.02')
  const [result, setResult] = useState<CounterweightResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const selected = catalog.density_cases.find((item) => item.id === conditionId)
  const valid =
    selected &&
    [volume, targetMin, targetMax].every(
      (v) => v.trim() && Number.isFinite(Number(v)) && Number(v) > 0,
    ) &&
    Number(targetMin) <= Number(targetMax)
  useEffect(() => {
    if (!active) {
      request.current?.abort()
      setBusy(false)
    }
  }, [active])
  useEffect(() => () => request.current?.abort(), [])
  function change(update: () => void) {
    request.current?.abort()
    setBusy(false)
    setResult(null)
    setError('')
    update()
  }
  async function calculate(nextVolume = Number(volume)) {
    if (!valid || busy) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const response = await api<CounterweightResult>(
        '/api/products/counterweight',
        {
          condition_id: conditionId,
          product_name: 'Published PE sample',
          volume_cm3: nextVolume,
          target_min_kg: Number(targetMin),
          target_max_kg: Number(targetMax),
        },
        controller.signal,
      )
      if (!controller.signal.aborted) setResult(response)
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : 'The example could not finish.')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  function download() {
    if (!result) return
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { ...result, input_kind: 'published_example', not_my_waste: true },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'rematter-published-pe-simulation.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <>
      <div className="mix-example-banner">
        <strong>Worked example · not my waste</strong>
        <p>
          These are published polyethylene specimens. Their density readings stay in this example
          and are never copied into My mix.
        </p>
      </div>
      <div className="product-grid">
        <form
          className="product-setup"
          onSubmit={(e) => {
            e.preventDefault()
            void calculate()
          }}
        >
          <h2>Published polyethylene sample</h2>
          <label className="product-field">
            Published material
            <select
              value={conditionId}
              onChange={(e) => change(() => setConditionId(e.target.value))}
            >
              {catalog.density_cases.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <div className="source-measurement-note">
              <span className="data-kind">Source measurements</span>
              <p>
                {selected.n} density readings at {selected.test_temperature_C} °C
              </p>
              <details className="source-setup-details">
                <summary>Material, process and test details</summary>
                <p>{selected.material}</p>
                <p>{selected.process}</p>
                <p>{selected.method}</p>
              </details>
              <a href={selected.source_url} target="_blank" rel="noreferrer">
                Read the study ↗
              </a>
            </div>
          )}
          <div className="product-step">
            <h2>Set the example volume and target</h2>
            <label className="product-field">
              Example volume (cm³)
              <input
                type="number"
                min="0.000001"
                step="any"
                required
                value={volume}
                onChange={(e) => change(() => setVolume(e.target.value))}
              />
            </label>
            <div className="product-pair">
              <label className="product-field">
                Example minimum (kg)
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  required
                  value={targetMin}
                  onChange={(e) => change(() => setTargetMin(e.target.value))}
                />
              </label>
              <label className="product-field">
                Example maximum (kg)
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  required
                  value={targetMax}
                  onChange={(e) => change(() => setTargetMax(e.target.value))}
                />
              </label>
            </div>
            <button className="primary product-calculate" type="submit" disabled={!valid || busy}>
              {busy ? 'Calculating…' : 'Calculate published example'}
            </button>
          </div>
          {error && (
            <p className="product-error" role="alert">
              {error}
            </p>
          )}
        </form>
        <section className="product-output" aria-label="Published example results">
          {result ? (
            <>
              <div className="product-output-heading">
                <div>
                  <span className="data-kind">Simulation · published sample</span>
                  <h2>Published PE sample mass</h2>
                </div>
                <button className="text-button" type="button" onClick={download}>
                  Download example JSON
                </button>
              </div>
              <p className="product-result-context">
                {quantity(result.volume_cm3, 2)} cm³ using {result.condition.label}. Not my
                material.
              </p>
              <div className="product-metrics">
                <div>
                  <strong>
                    {quantity(result.mean_density_mass_kg)} <small>kg</small>
                  </strong>
                  <span>Using the mean source density</span>
                </div>
                <div>
                  <strong>
                    {quantity(result.observed_source_mass_min_kg)}–
                    {quantity(result.observed_source_mass_max_kg)} <small>kg</small>
                  </strong>
                  <span>Range from these source readings</span>
                </div>
              </div>
              <p className="source-scenario-count">
                <strong>
                  {result.source_scenarios_in_target} of {result.source_scenario_count}
                </strong>{' '}
                source-based mass scenarios fall inside the example target.
              </p>
              <p className="product-scope-note">
                This is a simulation of published specimens, not a tested counterweight or a
                prediction of future batches.
              </p>
              <div className="product-reading-table">
                <table>
                  <caption>Each row uses one published density reading.</caption>
                  <thead>
                    <tr>
                      <th>Reading</th>
                      <th>Density (g/cm³)</th>
                      <th>Simulated mass (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.source_scenarios_kg.map((mass, index) => (
                      <tr key={index}>
                        <th>{index + 1}</th>
                        <td>{quantity(result.condition.density_values_g_cm3[index], 4)}</td>
                        <td>{quantity(mass, 5)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <section className="volume-choice">
                <h3>Try a different example volume</h3>
                {result.volume_interval_for_source_range_cm3 ? (
                  <p>
                    For these source readings and an exact assumed volume, the calculated interval
                    is about {quantity(result.volume_interval_for_source_range_cm3.min, 2)}–
                    {quantity(result.volume_interval_for_source_range_cm3.max, 2)} cm³. Limits are
                    rounded; recalculate after any change.
                  </p>
                ) : (
                  <p>No single fixed volume covers all source scenarios inside this target.</p>
                )}
                <button
                  className="outline-button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const next = Number(result.suggested_volume_cm3.toPrecision(6))
                    setVolume(String(next))
                    void calculate(next)
                  }}
                >
                  Try {quantity(result.suggested_volume_cm3, 2)} cm³ using the mean density
                </button>
              </section>
              <details className="product-detail">
                <summary>Source and calculation notes</summary>
                <p>{result.condition.repetition_level}</p>
                <p>Source cells: {result.condition.source_cells.join(', ')}</p>
                <ul>
                  {result.assumptions.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <div className="product-empty">
              <span className="data-kind">Worked example</span>
              <h2>Simulation of a published PE sample</h2>
              <p>
                {selected?.id === 'CECON21-PCRPE100'
                  ? 'At about 1,037.06 cm³, the five published readings give a simulated mass range of 0.998–1.004 kg. Calculate to see the individual scenarios.'
                  : 'Calculate to scale the five published density readings from this selected condition by the example volume.'}
              </p>
              <p className="helper">
                This example does not describe your metal dust, binder or finished product.
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
