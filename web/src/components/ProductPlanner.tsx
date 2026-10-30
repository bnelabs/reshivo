import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { CounterweightResult, ProductCatalog } from '../types'

type ProductKind = 'counterweight' | 'acoustic' | 'other'

const quantity = (value: number, digits = 3) =>
  value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })

export function ProductPlanner() {
  const [catalog, setCatalog] = useState<ProductCatalog | null>(null)
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const [catalogError, setCatalogError] = useState('')
  const [kind, setKind] = useState<ProductKind>('counterweight')
  const [productName, setProductName] = useState('Counterweight')
  const [conditionId, setConditionId] = useState('')
  const [sameProcess, setSameProcess] = useState(true)
  const [volume, setVolume] = useState('1000')
  const [targetMin, setTargetMin] = useState('0.98')
  const [targetMax, setTargetMax] = useState('1.02')
  const [soundJob, setSoundJob] = useState('absorption')
  const [frequencyMin, setFrequencyMin] = useState('500')
  const [frequencyMax, setFrequencyMax] = useState('2000')
  const [sheetThickness, setSheetThickness] = useState('10')
  const [otherResult, setOtherResult] = useState('')
  const [plastic, setPlastic] = useState('')
  const [batch, setBatch] = useState('')
  const [mix, setMix] = useState('')
  const [contaminant, setContaminant] = useState('')
  const [process, setProcess] = useState('')
  const [installation, setInstallation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<CounterweightResult | null>(null)
  const calculation = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setCatalogError('')
    api<ProductCatalog>('/api/products/catalog', undefined, controller.signal)
      .then((data) => {
        setCatalog(data)
        setConditionId(
          data.density_cases.find((c) => c.id === 'CECON21-PCRPE100')?.id ??
            data.density_cases[0]?.id ??
            'unlisted',
        )
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setCatalogError(
            e instanceof Error ? e.message : 'The source measurements could not load.',
          )
      })
    return () => controller.abort()
  }, [catalogAttempt])

  useEffect(() => () => calculation.current?.abort(), [])

  const selected = catalog?.density_cases.find((c) => c.id === conditionId)
  const matched = kind === 'counterweight' && selected !== undefined && sameProcess
  const numbersValid =
    [volume, targetMin, targetMax].every(
      (v) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) > 0,
    ) && Number(targetMin) <= Number(targetMax)

  function change(update: () => void) {
    update()
    setResult(null)
    setError('')
  }

  function chooseProduct(value: ProductKind) {
    change(() => {
      setKind(value)
      setProductName(
        value === 'counterweight' ? 'Counterweight' : value === 'acoustic' ? 'Sound sheet' : '',
      )
    })
  }

  async function calculate(nextVolume = Number(volume)) {
    if (!matched || !numbersValid || busy || !productName.trim()) return
    const controller = new AbortController()
    calculation.current?.abort()
    calculation.current = controller
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const response = await api<CounterweightResult>(
        '/api/products/counterweight',
        {
          condition_id: conditionId,
          product_name: productName.trim(),
          volume_cm3: nextVolume,
          target_min_kg: Number(targetMin),
          target_max_kg: Number(targetMax),
        },
        controller.signal,
      )
      if (!controller.signal.aborted) setResult(response)
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'The mass calculation could not finish.')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function downloadResult() {
    if (!result) return
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'rematter-mass-simulation.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (!catalog) {
    return (
      <main className="startup-state">
        <h1>Plan an upcycled product</h1>
        <p>{catalogError || 'Loading the source measurements…'}</p>
        {catalogError && (
          <button className="primary" onClick={() => setCatalogAttempt((n) => n + 1)}>
            Try again
          </button>
        )}
      </main>
    )
  }

  return (
    <main className="product-page">
      <div className="product-intro">
        <div>
          <p className="eyebrow">From recycled input to product</p>
          <h1>What are you making?</h1>
          <p>
            Choose the result you care about, then use measurements that match the material and
            process.
          </p>
        </div>
        <span className="product-label">Research prototype</span>
      </div>
      <div className="product-grid">
        <form
          className="product-setup"
          onSubmit={(event) => {
            event.preventDefault()
            void calculate()
          }}
        >
          <fieldset disabled={busy}>
            <legend className="visually-hidden">Product and material setup</legend>
            <label className="product-field">
              Product
              <select value={kind} onChange={(e) => chooseProduct(e.target.value as ProductKind)}>
                <option value="counterweight">Counterweight</option>
                <option value="acoustic">Sound sheet</option>
                <option value="other">Other product</option>
              </select>
            </label>
            <label className="product-field">
              Product name
              <input
                value={productName}
                maxLength={120}
                required
                placeholder="Name your product"
                onChange={(e) => change(() => setProductName(e.target.value))}
              />
            </label>
            {kind === 'counterweight' ? (
              <>
                <div className="product-step">
                  <h2>1. Set your mass target</h2>
                  <div className="product-pair">
                    <label className="product-field">
                      Minimum (kg)
                      <input
                        aria-label="Target minimum (kg)"
                        type="number"
                        min="0.000001"
                        step="any"
                        required
                        value={targetMin}
                        onChange={(e) => change(() => setTargetMin(e.target.value))}
                      />
                    </label>
                    <label className="product-field">
                      Maximum (kg)
                      <input
                        aria-label="Target maximum (kg)"
                        type="number"
                        min="0.000001"
                        step="any"
                        required
                        value={targetMax}
                        onChange={(e) => change(() => setTargetMax(e.target.value))}
                      />
                    </label>
                  </div>
                  {Number(targetMin) > Number(targetMax) && (
                    <p className="product-input-note">
                      Minimum mass must be no greater than maximum mass.
                    </p>
                  )}
                  <label className="product-field">
                    Volume (cm³)
                    <input
                      type="number"
                      min="0.000001"
                      step="any"
                      required
                      value={volume}
                      onChange={(e) => change(() => setVolume(e.target.value))}
                    />
                  </label>
                </div>
                <div className="product-step">
                  <h2>2. Choose a measured input</h2>
                  <label className="product-field">
                    Published material
                    <select
                      value={conditionId}
                      onChange={(e) => change(() => setConditionId(e.target.value))}
                    >
                      {catalog.density_cases.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                      <option value="unlisted">My input is not listed</option>
                    </select>
                  </label>
                  <p className="helper">
                    These are published samples, not measurements of your own waste.
                  </p>
                  {selected && (
                    <>
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
                      <label className="product-checkbox">
                        <input
                          type="checkbox"
                          checked={sameProcess}
                          onChange={(e) => change(() => setSameProcess(e.target.checked))}
                        />
                        Use the published process for this scenario
                      </label>
                    </>
                  )}
                </div>
              </>
            ) : kind === 'acoustic' ? (
              <div className="product-step">
                <h2>Set your sound target</h2>
                <label className="product-field">
                  The job
                  <select
                    value={soundJob}
                    onChange={(e) => change(() => setSoundJob(e.target.value))}
                  >
                    <option value="absorption">Absorb sound</option>
                    <option value="blocking">Block sound</option>
                  </select>
                </label>
                <div className="product-pair">
                  <label className="product-field">
                    From (Hz)
                    <input
                      type="number"
                      min="1"
                      value={frequencyMin}
                      onChange={(e) => change(() => setFrequencyMin(e.target.value))}
                    />
                  </label>
                  <label className="product-field">
                    To (Hz)
                    <input
                      type="number"
                      min="1"
                      value={frequencyMax}
                      onChange={(e) => change(() => setFrequencyMax(e.target.value))}
                    />
                  </label>
                </div>
                <label className="product-field">
                  Sheet thickness (mm)
                  <input
                    type="number"
                    min="0.1"
                    step="any"
                    value={sheetThickness}
                    onChange={(e) => change(() => setSheetThickness(e.target.value))}
                  />
                </label>
                <label className="product-field">
                  Installation
                  <textarea
                    value={installation}
                    placeholder="Backing, air gap and where the sheet will be fitted"
                    onChange={(e) => change(() => setInstallation(e.target.value))}
                  />
                </label>
              </div>
            ) : (
              <label className="product-field">
                Result to keep consistent
                <input
                  value={otherResult}
                  placeholder="Property, units and your target range"
                  onChange={(e) => change(() => setOtherResult(e.target.value))}
                />
              </label>
            )}
            {(!matched || kind !== 'counterweight') && (
              <div className="product-step">
                <h2>Describe your recycled input</h2>
                <div className="product-pair">
                  <label className="product-field">
                    Plastic type
                    <input
                      value={plastic}
                      placeholder="For example, polypropylene"
                      onChange={(e) => change(() => setPlastic(e.target.value))}
                    />
                  </label>
                  <label className="product-field">
                    Batch
                    <input
                      value={batch}
                      placeholder="Your batch reference"
                      onChange={(e) => change(() => setBatch(e.target.value))}
                    />
                  </label>
                </div>
                <label className="product-field">
                  Mix
                  <input
                    value={mix}
                    placeholder="Named materials and their amounts"
                    onChange={(e) => change(() => setMix(e.target.value))}
                  />
                </label>
                <label className="product-field">
                  Contaminant and amount
                  <input
                    value={contaminant}
                    placeholder="Name it and give the amount, or say unknown"
                    onChange={(e) => change(() => setContaminant(e.target.value))}
                  />
                </label>
                <label className="product-field">
                  Process
                  <textarea
                    value={process}
                    placeholder="How the material will be prepared and formed"
                    onChange={(e) => change(() => setProcess(e.target.value))}
                  />
                </label>
              </div>
            )}
            {kind === 'counterweight' && (
              <button
                className="primary product-calculate"
                disabled={!matched || !numbersValid || !productName.trim()}
                type="submit"
              >
                {busy ? 'Calculating…' : 'Calculate mass'}
              </button>
            )}
          </fieldset>
          {error && (
            <p className="product-error" role="alert">
              {error}
            </p>
          )}
        </form>
        <section className="product-output" aria-label="Product results">
          {kind !== 'counterweight' || !matched ? (
            <div className="missing-link" role="status">
              <span className="data-kind">Measurement needed</span>
              <h2>
                {kind === 'acoustic'
                  ? 'No sound prediction for this sheet yet'
                  : kind === 'other'
                    ? 'This product needs a matching measurement'
                    : 'No density linked to this input yet'}
              </h2>
              <p>
                {kind === 'counterweight'
                  ? 'Measure density after the chosen process. Repeated measurements can describe the sampled material; independent batches need their own data.'
                  : kind === 'acoustic'
                    ? soundJob === 'blocking'
                      ? 'Needed: sound-transmission measurements for the stated material, thickness, frequencies and installation. Absorption measurements cannot answer a sound-blocking target.'
                      : 'Needed: sound-absorption measurements matching the stated material, thickness, frequencies and installation. The collected studies support source comparisons, not a prediction for this new sheet.'
                    : 'A calculation needs measurements linked to the named result, material and process. Describing a mix does not create its missing properties.'}
              </p>
              <p className="helper">No numerical result has been generated for this case.</p>
            </div>
          ) : result ? (
            <>
              <div className="product-output-heading">
                <div>
                  <span className="data-kind">Simulation</span>
                  <h2>{result.product_name} mass</h2>
                </div>
                <button className="text-button" onClick={downloadResult}>
                  Download JSON
                </button>
              </div>
              <p className="product-result-context">
                {quantity(result.volume_cm3, 2)} cm³ using {result.condition.label}
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
              <div className="source-scenario-count" role="status">
                <strong>
                  {result.source_scenarios_in_target} of {result.source_scenario_count}
                </strong>{' '}
                source-based mass scenarios fall inside your {quantity(result.target_min_kg)}–
                {quantity(result.target_max_kg)} kg target.
              </div>
              <p className="product-scope-note">
                These are calculated scenarios from source density readings. They do not show the
                mass of a tested counterweight or predict future batches.
              </p>
              <div className="product-reading-table">
                <table>
                  <caption>Each row uses one of the study’s density readings.</caption>
                  <thead>
                    <tr>
                      <th>Reading</th>
                      <th>
                        Source density
                        <br />
                        (g/cm³)
                      </th>
                      <th>
                        Calculated mass
                        <br />
                        (kg)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.source_scenarios_kg.map((mass, i) => (
                      <tr key={i}>
                        <th>{i + 1}</th>
                        <td>{quantity(result.condition.density_values_g_cm3[i], 4)}</td>
                        <td>{quantity(mass, 5)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <section className="volume-choice">
                <h3>Try a different volume</h3>
                {result.volume_interval_for_source_range_cm3 ? (
                  <>
                    <p>
                      For these source readings, the calculated volume interval is about{' '}
                      <strong>
                        {quantity(result.volume_interval_for_source_range_cm3.min, 2)}–
                        {quantity(result.volume_interval_for_source_range_cm3.max, 2)} cm³
                      </strong>
                      .
                    </p>
                    <p className="helper">
                      This assumes an exact volume and these source densities. The displayed limits
                      are rounded; recalculate after changing the volume.
                    </p>
                  </>
                ) : (
                  <p>
                    No single fixed volume covers all {result.source_scenario_count} source
                    scenarios inside this target. A wider target or a different measured input would
                    need to be considered.
                  </p>
                )}
                <button
                  className="outline-button"
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    const nextVolume = Number(result.suggested_volume_cm3.toPrecision(6))
                    setVolume(String(nextVolume))
                    void calculate(nextVolume)
                  }}
                >
                  Try {quantity(result.suggested_volume_cm3, 2)} cm³ using the mean density
                </button>
              </section>
              <details className="product-detail">
                <summary>Source details and calculation notes</summary>
                <p>{result.condition.repetition_level}</p>
                <p>Source cells: {result.condition.source_cells.join(', ')}</p>
                <ul>
                  {result.assumptions.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
                <a href={result.condition.source_url} target="_blank" rel="noreferrer">
                  {result.condition.source_title} ↗
                </a>
                <p className="helper">{result.condition.license}</p>
              </details>
            </>
          ) : (
            <div className="product-empty">
              <span className="data-kind">Simulation</span>
              <h2>See how source density changes calculated mass</h2>
              <p>
                Set a volume and mass target, then calculate using the five readings from one
                published material and process.
              </p>
              <div className="mass-equation">Mass = density × volume</div>
              <p className="helper">
                The result will describe those source readings. It will not establish consistency
                across waste batches or finished products.
              </p>
            </div>
          )}
        </section>
      </div>
      <section className="collected-measurements">
        <div className="collected-heading">
          <div>
            <p className="eyebrow">Source measurements</p>
            <h2>What the collected data can answer</h2>
          </div>
          <span>{catalog.source_groups.length} source groups</span>
        </div>
        <div className="source-group-list">
          {catalog.source_groups.map((group) => (
            <details className="source-group" key={group.id}>
              <summary>{group.title}</summary>
              <p>{group.summary}</p>
              <p>{group.can_answer}</p>
              <ul>
                {group.cannot_answer.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <a href={group.source_url} target="_blank" rel="noreferrer">
                Read the source ↗
              </a>
              <span className="source-license">{group.license}</span>
            </details>
          ))}
        </div>
        <p className="helper">
          A physical test covers only the material, process and product configuration that was
          tested.
        </p>
      </section>
    </main>
  )
}
