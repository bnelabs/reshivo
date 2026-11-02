import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { BalanceMixResult, TargetSeriesCatalog, TestedLevelResult } from '../types'
import './TestedLevels.css'

const quantity = (value: number, digits = 4) =>
  value.toLocaleString('en-US', { maximumFractionDigits: digits })
const massQuantity = (value: number) => value !== 0 && Math.abs(value) < 0.000001
  ? value.toExponential(6)
  : value.toLocaleString('en-US', { maximumSignificantDigits: 12 })

export function TestedLevels({ active, onAsk, disabled = false }: {
  active: boolean
  onAsk?: (question: string) => void
  disabled?: boolean
}) {
  const [catalog, setCatalog] = useState<TargetSeriesCatalog | null>(null)
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const [catalogError, setCatalogError] = useState('')
  const [seriesId, setSeriesId] = useState('CECON21-YIELD-MDPE')
  const [targetMin, setTargetMin] = useState('25')
  const [targetMax, setTargetMax] = useState('')
  const [result, setResult] = useState<TestedLevelResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef<AbortController | null>(null)
  const ingredientRequest = useRef<AbortController | null>(null)
  const [recycledMass, setRecycledMass] = useState('')
  const [ingredients, setIngredients] = useState<BalanceMixResult | null>(null)
  const [ingredientBusy, setIngredientBusy] = useState(false)
  const [ingredientError, setIngredientError] = useState('')
  const output = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setCatalogError('')
    api<TargetSeriesCatalog>('/api/products/target-series', undefined, controller.signal)
      .then(setCatalog)
      .catch((failure) => {
        if (!controller.signal.aborted)
          setCatalogError(
            failure instanceof Error ? failure.message : 'The tested input levels could not load.',
          )
      })
    return () => controller.abort()
  }, [catalogAttempt])
  useEffect(() => () => { request.current?.abort(); ingredientRequest.current?.abort() }, [])
  useEffect(() => {
    if (!active) {
      request.current?.abort()
      ingredientRequest.current?.abort()
      setIngredientBusy(false)
      setBusy(false)
    }
  }, [active])
  useEffect(() => {
    if (result) {
      output.current?.focus({ preventScroll: true })
      output.current?.scrollIntoView({ block: 'start' })
    }
  }, [result])

  function change(update: () => void) {
    request.current?.abort()
    setBusy(false)
    setResult(null)
    setError('')
    ingredientRequest.current?.abort()
    setIngredientBusy(false)
    setIngredients(null)
    setIngredientError('')
    update()
  }
  const selected = catalog?.series.find((item) => item.id === seriesId)
  const highestMatching = result?.levels.filter((level) => level.all_values_in_target)
    .reduce<NonNullable<typeof result>['levels'][number] | null>(
      (highest, level) => !highest || level.pcrpe_wt_percent > highest.pcrpe_wt_percent ? level : highest,
      null,
    )
  const ingredientMassValid = recycledMass.trim() !== '' && Number.isFinite(Number(recycledMass)) && Number(recycledMass) > 0 && Number(recycledMass) <= 1_000_000
  async function calculateIngredients() {
    if (!result || !highestMatching || highestMatching.pcrpe_wt_percent === 0 || !ingredientMassValid || ingredientBusy) return
    const controller = new AbortController()
    ingredientRequest.current?.abort()
    ingredientRequest.current = controller
    setIngredientBusy(true)
    setIngredients(null)
    setIngredientError('')
    try {
      const response = await api<BalanceMixResult>('/api/advisor/balance-mix', {
        component: 'Raw PCRPE in the published example', input_mass_kg: Number(recycledMass),
        input_min_percent: 100, input_max_percent: 100,
        addition_name: `Raw virgin ${result.series.virgin_host} in the published example`, addition_percent: 0,
        target_min_percent: highestMatching.pcrpe_wt_percent, target_max_percent: highestMatching.pcrpe_wt_percent,
      }, controller.signal)
      if (!controller.signal.aborted) setIngredients(response)
    } catch (failure) {
      if (!controller.signal.aborted) setIngredientError(failure instanceof Error ? failure.message : 'The ingredient amounts could not be calculated.')
    } finally {
      if (!controller.signal.aborted) setIngredientBusy(false)
    }
  }
  function askAboutMaterial() {
    if (!result || !onAsk) return
    onAsk([
      'Help me decide the next material-development trial for my current case, using the following published example only as context.',
      'These are source measurements, NOT my material or finished product. Do not transfer their values or recipe performance to my waste.',
      `Cecon 2021, DOI ${result.source.doi}; host ${result.series.virgin_host}; target at least ${result.target_min_MPa} MPa tensile yield stress${result.target_max_MPa === null ? ', no upper limit' : `, at most ${result.target_max_MPa} MPa`}.`,
      `Process: ${result.source.process}. Test: ${result.source.test_method}.`,
      ...result.levels.map((level) => `${level.pcrpe_wt_percent} wt% commercial PCRPE, remainder virgin ${result.series.virgin_host}: ${level.source_min_MPa}–${level.source_max_MPa} MPa; ${level.values_in_target}/${level.n} recorded specimens inside. Condition ${level.condition_id}.`),
      'Independent runs and batches and complete recycled contaminant composition are unknown. No interpolation or future consistency claim.',
      'Explain what to change in material, preparation, process or product design if I want to use more recycled input. Separate what this source actually supports from proposals for my case. Give a useful controlled comparison and what to measure; do not invent additive doses, processing settings or properties. Focus on formulation, preparation, process and product geometry relevant to the stated material question.',
    ].join('\n'))
  }
  const numbersValid =
    [targetMin, ...(targetMax.trim() ? [targetMax] : [])].every(
      (value) =>
        value.trim() !== '' &&
        Number.isFinite(Number(value)) &&
        Number(value) >= 0 &&
        Number(value) <= 1_000_000,
    ) && (!targetMax.trim() || Number(targetMin) <= Number(targetMax))

  async function calculate() {
    if (!selected || !numbersValid || busy) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    setBusy(true)
    setResult(null)
    setError('')
    try {
      const response = await api<TestedLevelResult>(
        '/api/products/target-check',
        {
          series_id: seriesId,
          target_min_MPa: Number(targetMin),
          target_max_MPa: targetMax.trim() ? Number(targetMax) : null,
        },
        controller.signal,
      )
      if (!controller.signal.aborted) setResult(response)
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : 'The target comparison could not finish.',
        )
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  function download() {
    if (!result) return
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'rematter-tested-input-levels.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (!catalog)
    return (
      <div className="product-setup">
        <h2>Tested input levels</h2>
        <p>{catalogError || 'Loading the study’s tested input levels…'}</p>
        {catalogError && (
          <button
            type="button"
            className="outline-button"
            onClick={() => setCatalogAttempt((value) => value + 1)}
          >
            Try loading the tested levels again
          </button>
        )}
        <p className="helper">This source comparison is separate from My mix.</p>
      </div>
    )

  return (
    <>
      <div className="mix-example-banner">
        <strong>Source measurements · not my material</strong>
        <p>
          How much recycled content fits this material target? Compare a published blend study.
          This is separate from your case: no source readings are added to your mix.
        </p>
      </div>
      <div className="product-grid tested-levels-grid">
        <form
          className="product-setup"
          onSubmit={(event) => {
            event.preventDefault()
            void calculate()
          }}
        >
          <h2>Choose the material requirement</h2>
          <p>Yield stress describes when a material starts to deform permanently under this tensile test. It is one material screen, not a complete product requirement.</p>
          <p className="helper">
            Only post-consumer recycled PE content changes within a selected source series. The
            virgin PE host supplies the remainder at 0–80 wt%.
          </p>
          <label className="product-field">
            Virgin PE host in this study
            <select
              value={seriesId}
              onChange={(event) => change(() => setSeriesId(event.target.value))}
            >
              {catalog.series.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.virgin_host}
                </option>
              ))}
            </select>
          </label>
          <div className="tested-fixed-property">
            <span>Measured property</span>
            <strong>Tensile yield stress (MPa)</strong>
          </div>
          <div className="product-pair">
            <label className="product-field">
              Yield-stress target minimum (MPa)
              <input
                type="number"
                min="0"
                max="1000000"
                step="any"
                required
                value={targetMin}
                onChange={(event) => change(() => setTargetMin(event.target.value))}
              />
            </label>
            <label className="product-field">
              Yield-stress maximum (MPa, optional)
              <input
                type="number"
                min="0"
                max="1000000"
                step="any"
                placeholder="No upper limit"
                value={targetMax}
                onChange={(event) => change(() => setTargetMax(event.target.value))}
              />
            </label>
          </div>
          {targetMin && targetMax && Number(targetMin) > Number(targetMax) && (
            <p className="product-input-note">Minimum must be no greater than maximum.</p>
          )}
          {selected && (
            <p className="helper">
              Tested recycled PE content:{' '}
              {selected.input_levels.map((level) => quantity(level)).join(', ')} wt%. No untested
              input levels are calculated.
            </p>
          )}
          <button
            type="submit"
            className="primary product-calculate"
            disabled={!selected || !numbersValid || busy}
          >
            {busy ? 'Comparing…' : 'Check tested levels'}
          </button>
          {error && (
            <p className="product-error" role="alert">
              {error}
            </p>
          )}
          <div className="product-step">
            <h2>What was tested</h2>
            <p className="helper">
              Ten individually tested dogbone specimens per condition, not ten batches. The study
              reports injection moulding at 185–195 °C and tensile testing at 500 mm/min and ambient
              22 °C.
            </p>
            <details className="source-setup-details">
              <summary>Source, process and method</summary>
              <p>{catalog.source.process}</p>
              <p>{catalog.source.test_method}</p>
              {selected && (
                <>
                  <p>{selected.constant_source_context}</p>
                  <p>{selected.shared_endpoint_note}</p>
                </>
              )}
              <p>
                Independent batch counts and the full recycled grade and contaminant composition are
                not reported.
              </p>
              <a href={catalog.source.url} target="_blank" rel="noreferrer">
                Read the Cecon study ↗
              </a>
              <p className="helper">
                {catalog.source.license} · DOI {catalog.source.doi}
              </p>
            </details>
          </div>
        </form>
        <section
          ref={output}
          tabIndex={-1}
          className="product-output tested-levels-output"
          aria-label="Tested input level results"
        >
          {result ? (
            <>
              <div className="product-output-heading">
                <div>
                  <span className="data-kind">Source measurements</span>
                  <h2>What changes when recycled content changes?</h2>
                </div>
                <button type="button" className="text-button" onClick={download}>
                  Download tested-level JSON
                </button>
              </div>
              <p className="product-result-context">
                Virgin {result.series.virgin_host} host · {result.target_max_MPa === null
                  ? `at least ${quantity(result.target_min_MPa)} MPa yield stress`
                  : `${quantity(result.target_min_MPa)}–${quantity(result.target_max_MPa)} MPa yield-stress target`}
              </p>
              <div className="source-material-decision">
                <span className="workshop-eyebrow">Material choice · source specimens only</span>
                {highestMatching && highestMatching.pcrpe_wt_percent === 0 ? <>
                  <h3>Only the virgin control has all readings inside</h3>
                  <p>This study has no recycled-containing level with every recorded reading inside this target. It does not supply a recycling recipe for this requirement. Another material or process comparison would need its own measurements.</p>
                </> : highestMatching ? <>
                  <h3>{quantity(highestMatching.pcrpe_wt_percent)}% recycled PE + {quantity(100 - highestMatching.pcrpe_wt_percent)}% {result.series.virgin_host}</h3>
                  <p>The highest tested recycled content with all ten recorded readings inside this target.</p>
                  <p><strong>{quantity(highestMatching.source_min_MPa, 5)}–{quantity(highestMatching.source_max_MPa, 5)} MPa</strong> observed at this level.</p>
                </> : <>
                  <h3>No tested blend has all readings inside this target</h3>
                  <p>This series does not supply a matching level. A different material or process would need its own measurements.</p>
                </>}
                <p className="helper">A source comparison can guide a matching trial. It does not qualify your waste or your finished product.</p>
                {highestMatching && highestMatching.pcrpe_wt_percent > 0 && <details className="source-ingredient-amounts">
                  <summary>Ingredient amounts for this studied proportion</summary>
                  <p>Combine separate raw resins before processing. This does not calculate how to reprocess an existing moulded blend.</p>
                  <label>Raw PCRPE mass for this calculation (kg)
                    <input type="number" min="0" max="1000000" step="any" value={recycledMass} onChange={(event) => {
                      ingredientRequest.current?.abort(); setIngredientBusy(false); setIngredients(null); setIngredientError(''); setRecycledMass(event.target.value)
                    }} />
                  </label>
                  <button type="button" className="outline-button" disabled={!ingredientMassValid || ingredientBusy} onClick={() => void calculateIngredients()}>{ingredientBusy ? 'Calculating…' : 'Calculate ingredient amounts'}</button>
                  {ingredientError && <p role="alert">{ingredientError}</p>}
                  {ingredients?.feasible && ingredients.addition_min_kg !== null && <div className="source-ingredient-result" role="status">
                    <strong>Simulation · ingredient masses only</strong>
                    <p>{massQuantity(Number(recycledMass))} kg raw PCRPE + {massQuantity(ingredients.addition_min_kg)} kg raw virgin {result.series.virgin_host} = {massQuantity(Number(recycledMass) + ingredients.addition_min_kg)} kg at {quantity(highestMatching.pcrpe_wt_percent)} mass % recycled content.</p>
                    <p>Composition only. The published yield measurements belong to the tested specimens; they do not predict this new batch. No ingredient amounts or readings are copied into your case.</p>
                  </div>}
                </details>}
                {onAsk && <button type="button" className="outline-button" disabled={disabled} onClick={askAboutMaterial}>Ask Meta how to develop my mix</button>}
              </div>
              <p className="source-scenario-count" role="status">
                {result.matching_tested_levels_wt_percent.length > 0 ? (
                  <>
                    <strong>All 10 recorded specimens are inside the target at: </strong>
                    {result.matching_tested_levels_wt_percent
                      .map((level) => `${quantity(level)} wt%`)
                      .join(', ')}{' '}
                    recycled PE.
                  </>
                ) : (
                  <>
                    <strong>
                      No tested content level has all 10 recorded specimens inside this target.
                    </strong>
                  </>
                )}
              </p>
              <p className="product-scope-note">
                This comparison describes only the specimens recorded at each tested level. It does
                not predict an untested blend, another material, future batches or finished-product
                consistency.
              </p>
              <div className="source-content-cards" aria-label="Measured response at tested recycled-content levels">
                {result.levels.map((level) => <article key={level.condition_id} className={level.all_values_in_target ? 'source-content-card source-content-card-inside' : 'source-content-card'}>
                  <h3>{quantity(level.pcrpe_wt_percent)}% <span>recycled PE</span></h3>
                  <p><strong>{level.values_in_target}/{level.n}</strong> readings inside</p>
                  <p>{quantity(level.source_min_MPa, 2)}–{quantity(level.source_max_MPa, 2)} MPa</p>
                </article>)}
              </div>
              <details className="source-exact-table"><summary>Exact ranges and individual source readings</summary>
              <div className="product-reading-table tested-level-table">
                <table>
                  <caption>
                    Six tested recycled-content levels under the source’s common reported process.
                    Ten individually tested specimens per level.
                  </caption>
                  <thead>
                    <tr>
                      <th>Recycled PE (wt%)</th>
                      <th>Recorded yield-stress range (MPa)</th>
                      <th>Recorded specimens inside target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.levels.map((level) => (
                      <tr key={level.condition_id}>
                        <th>{quantity(level.pcrpe_wt_percent)}</th>
                        <td>
                          {quantity(level.source_min_MPa, 8)}–{quantity(level.source_max_MPa, 8)}
                        </td>
                        <td>
                          {level.values_in_target}/{level.n} recorded inside
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <section className="volume-choice">
                <h3>Individual source readings</h3>
                <p className="helper">
                  Values stay linked to their original spreadsheet cells. Row order is not an
                  original specimen identifier.
                </p>
                {result.levels.map((level) => (
                  <details className="tested-reading-details" key={level.condition_id}>
                    <summary>
                      {quantity(level.pcrpe_wt_percent)} wt% recycled PE · {level.n} recorded values
                    </summary>
                    <p className="helper">{level.condition_id}</p>
                    <div className="product-reading-table">
                      <table>
                        <caption>
                          Yield stress for the source’s {quantity(level.pcrpe_wt_percent)} wt%
                          condition
                        </caption>
                        <thead>
                          <tr>
                            <th>Source cell</th>
                            <th>Yield stress (MPa)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {level.observations.map((reading) => (
                            <tr key={reading.measurement_id}>
                              <th>{reading.source_cell}</th>
                              <td>{quantity(reading.value, 8)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </section>
              </details>
              <details className="product-detail">
                <summary>Source and comparison limits</summary>
                <p>{result.source.title}</p>
                <p>{result.source.process}</p>
                <p>{result.source.test_method}</p>
                <p>{result.series.shared_endpoint_note}</p>
                <ul>
                  {result.limits.map((limit) => (
                    <li key={limit}>{limit}</li>
                  ))}
                </ul>
                <a href={result.source.url} target="_blank" rel="noreferrer">
                  Read the source ↗
                </a>
                <p>
                  {result.source.license} · DOI {result.source.doi}
                </p>
              </details>
            </>
          ) : (
            <div className="product-empty">
              <span className="data-kind">Source measurements</span>
              <h2>Compare a target with measured specimens</h2>
              <p>
                Choose a virgin PE host and set a yield-stress range. The comparison checks the ten
                recorded specimens at each of the six tested recycled-content levels.
              </p>
              <p className="helper">
                No measurements are added to My mix, and no values between tested levels are
                inferred.
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
