import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { TargetSeriesCatalog, TestedLevelResult } from '../types'

const quantity = (value: number, digits = 4) =>
  value.toLocaleString('en-US', { maximumFractionDigits: digits })

export function TestedLevels({ active }: { active: boolean }) {
  const [catalog, setCatalog] = useState<TargetSeriesCatalog | null>(null)
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const [catalogError, setCatalogError] = useState('')
  const [seriesId, setSeriesId] = useState('CECON21-YIELD-MDPE')
  const [targetMin, setTargetMin] = useState('25')
  const [targetMax, setTargetMax] = useState('28')
  const [result, setResult] = useState<TestedLevelResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef<AbortController | null>(null)
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
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (!active) {
      request.current?.abort()
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
    update()
  }
  const selected = catalog?.series.find((item) => item.id === seriesId)
  const numbersValid =
    [targetMin, targetMax].every(
      (value) =>
        value.trim() !== '' &&
        Number.isFinite(Number(value)) &&
        Number(value) >= 0 &&
        Number(value) <= 1_000_000,
    ) && Number(targetMin) <= Number(targetMax)

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
          target_max_MPa: Number(targetMax),
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
          Change the target and compare the study’s tested recycled-content levels. These measured
          specimens do not describe your waste, a new recipe or a finished product.
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
          <h2>Which tested levels fit a target?</h2>
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
              Yield-stress target maximum (MPa)
              <input
                type="number"
                min="0"
                max="1000000"
                step="any"
                required
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
                  <h2>Recorded specimens against your target</h2>
                </div>
                <button type="button" className="text-button" onClick={download}>
                  Download tested-level JSON
                </button>
              </div>
              <p className="product-result-context">
                Virgin {result.series.virgin_host} host · {quantity(result.target_min_MPa)}–
                {quantity(result.target_max_MPa)} MPa yield-stress target
              </p>
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
