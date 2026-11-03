import { useState } from 'react'
import { api } from '../api'
import { newCostDraft } from '../projectWorkspace'
import type { ProjectWorkspace, CostDraft } from '../projectWorkspace'
import { costRequest, costWinnerSummaries } from '../manufacturingCost'
import { currentSetups, setupKey } from './TrialWorkspace'

type Props = { workspace: ProjectWorkspace; onChange: (next: ProjectWorkspace) => void }
const displayMoney = (value: unknown) =>
  typeof value === 'string'
    ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })
    : 'Unknown'
export function CostWorkspace({ workspace: w, onChange }: Props) {
  const setups = currentSetups(w.configurations)
  const [selected, setSelected] = useState('')
  const [result, setResult] = useState<any>(null)
  const [comparison, setComparison] = useState<any>(null)
  const [resultKey, setResultKey] = useState('')
  const [compareKey, setCompareKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const c = setups.find((s) => setupKey(s) === selected) ?? setups[0]
  const d: CostDraft = c ? (w.costs[setupKey(c)] ?? newCostDraft()) : newCostDraft()
  function edit(patch: Partial<CostDraft>) {
    if (c) onChange({ ...w, costs: { ...w.costs, [setupKey(c)]: { ...d, ...patch } } })
  }
  const currentRequest = c ? costRequest(w, c, d) : null
  const fingerprint = JSON.stringify(currentRequest)
  const comparisonRequests = setups.map((s) =>
    costRequest(w, s, w.costs[setupKey(s)] ?? newCostDraft()),
  )
  const comparisonFingerprint = JSON.stringify(comparisonRequests)
  const comparisonMetrics = (['per_usable_unit', 'per_usable_kg', 'per_usable_m2'] as const).filter(
    (metric) => comparison?.results?.some((entry: any) => entry.unit_costs?.[metric] != null),
  )
  async function calculate(compare = false) {
    setBusy(true)
    setError('')
    try {
      if (compare) {
        setComparison(await api<any>('/api/project/compare-costs', { records: comparisonRequests }))
        setCompareKey(comparisonFingerprint)
      } else {
        setResult(await api<any>('/api/project/manufacturing-cost', currentRequest))
        setResultKey(fingerprint)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="pw-section">
      <div className="pw-section-heading">
        <div>
          <h1>What will a usable product cost?</h1>
          <p>
            Start with material prices. Add processing and usable output when you know them. Missing
            costs stay unknown.
          </p>
        </div>
      </div>
      {!c ? (
        <div className="pw-empty">
          <h2>Save a trial setup first</h2>
          <p>Its materials and amounts will be available here automatically.</p>
        </div>
      ) : (
        <>
          <label className="pw-inline-label">
            Trial setup
            <select value={setupKey(c)} onChange={(e) => setSelected(e.target.value)}>
              {setups.map((s) => (
                <option key={setupKey(s)} value={setupKey(s)}>
                  {s.name} · version {s.revision}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p className="pw-error" role="alert">
              {error}
            </p>
          )}
          <section className="pw-card">
            <h2>1. Charged materials</h2>
            <p>
              These are the amounts already saved in this setup. Change a recipe in Trials, so
              earlier costs retain their original version.
            </p>
            <div className="pw-form-grid">
              <label>
                Currency
                <input
                  value={d.currency}
                  maxLength={40}
                  onChange={(e) => edit({ currency: e.target.value })}
                  placeholder="e.g. EUR or USD; no automatic exchange"
                />
              </label>
              <label>
                Amount and price basis
                <input
                  value={d.mass_basis}
                  maxLength={160}
                  onChange={(e) => edit({ mass_basis: e.target.value })}
                  placeholder="e.g. dry or as received"
                />
              </label>
            </div>
            <div className="pw-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Amount used</th>
                    <th>Price per kg in {d.currency || 'your currency'}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.materials.map((m) => (
                    <tr key={m.id}>
                      <th>{m.name}</th>
                      <td>
                        {m.amount || 'Unknown'} {m.unit.replaceAll('_', ' ')}
                      </td>
                      <td>
                        <label className="pw-sr-only" htmlFor={`price-${m.id}`}>
                          Price per kg for {m.name}
                        </label>
                        <input
                          id={`price-${m.id}`}
                          inputMode="decimal"
                          value={d.prices[m.id] ?? ''}
                          onChange={(e) =>
                            edit({ prices: { ...d.prices, [m.id]: e.target.value } })
                          }
                          placeholder="Unknown"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {c.materials.some((m) => m.unit === 'mass_percent') && (
              <label>
                Total charged batch mass (kg)
                <input
                  inputMode="decimal"
                  value={d.batch_mass_kg}
                  onChange={(e) => edit({ batch_mass_kg: e.target.value })}
                />
              </label>
            )}
            {c.materials.some((m) => m.unit === 'volume_percent') && (
              <p className="pw-notice">
                Volume percentages do not establish charged masses. Record weighed material amounts
                in a new setup before calculating their cost.
              </p>
            )}
          </section>
          <details className="pw-card pw-spaced pw-cost-section">
            <summary>
              <h2>
                2. Processing costs <span className="pw-muted">optional</span>
              </h2>
            </summary>
            <p>
              Choose Unknown, Enter costs, or Exclude from this estimate for each category. Excluded
              categories stay visible in the result.
            </p>
            {(['energy', 'labor', 'other'] as const).map((k) => (
              <div className="pw-cost-category" key={k}>
                <label>
                  {k === 'energy'
                    ? 'Energy'
                    : k === 'labor'
                      ? 'Direct labor'
                      : 'Other batch charges'}
                  <select
                    value={d.process_statuses?.[k] ?? 'unknown'}
                    onChange={(e) =>
                      edit({
                        process_statuses: {
                          ...d.process_statuses,
                          [k]: e.target.value as 'known' | 'unknown' | 'excluded',
                        },
                      })
                    }
                  >
                    <option value="unknown">Unknown</option>
                    <option value="known">Enter costs</option>
                    <option value="excluded">Exclude from this estimate</option>
                  </select>
                </label>
                {d.process_statuses?.[k] === 'known' &&
                  (k === 'energy' ? (
                    <div className="pw-form-grid">
                      <label>
                        Batch electricity used (kWh)
                        <input
                          inputMode="decimal"
                          value={d.energy_kwh}
                          onChange={(e) => edit({ energy_kwh: e.target.value })}
                        />
                      </label>
                      <label>
                        Price per kWh
                        <input
                          inputMode="decimal"
                          value={d.energy_rate}
                          onChange={(e) => edit({ energy_rate: e.target.value })}
                        />
                      </label>
                    </div>
                  ) : k === 'labor' ? (
                    <div className="pw-form-grid">
                      <label>
                        Person-hours for this batch
                        <input
                          inputMode="decimal"
                          value={d.labor_hours}
                          onChange={(e) => edit({ labor_hours: e.target.value })}
                        />
                      </label>
                      <label>
                        Price per person-hour
                        <input
                          inputMode="decimal"
                          value={d.labor_rate}
                          onChange={(e) => edit({ labor_rate: e.target.value })}
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="pw-form-grid">
                      <label>
                        What the charge covers
                        <input
                          value={d.other_name}
                          onChange={(e) => edit({ other_name: e.target.value })}
                          placeholder="Include only costs not entered above"
                        />
                      </label>
                      <label>
                        Charge for this batch
                        <input
                          inputMode="decimal"
                          value={d.other_charge}
                          onChange={(e) => edit({ other_charge: e.target.value })}
                        />
                      </label>
                    </div>
                  ))}
              </div>
            ))}
          </details>
          <details className="pw-card pw-spaced pw-cost-section">
            <summary>
              <h2>
                3. Usable output <span className="pw-muted">optional</span>
              </h2>
            </summary>
            <p>
              Enter what “usable” means. A count of accepted items does not establish any unmeasured
              physical property.
            </p>
            <label>
              Same product / function for comparison
              <input
                value={d.functional_basis}
                maxLength={500}
                onChange={(e) => edit({ functional_basis: e.target.value })}
                placeholder="e.g. same-size workshop mats for the same use"
              />
            </label>
            <label>
              What makes output usable for this estimate?
              <textarea
                value={d.acceptance_basis}
                maxLength={1000}
                onChange={(e) => edit({ acceptance_basis: e.target.value })}
                placeholder="The actual acceptance check or the planning assumption"
              />
            </label>
            <label>
              Output figures
              <select
                value={d.mode}
                onChange={(e) => edit({ mode: e.target.value as 'actual' | 'planned' })}
              >
                <option value="actual">Entered actual usable output</option>
                <option value="planned">Planning scenario</option>
              </select>
            </label>
            <div className="pw-form-grid">
              {(d.mode === 'actual'
                ? ['usable_count', 'usable_mass_kg', 'usable_area_m2']
                : ['gross_count', 'gross_mass_kg', 'gross_area_m2']
              ).map((field, i) => (
                <label key={field}>
                  {d.mode === 'actual' ? 'Usable' : 'Gross planned'}{' '}
                  {i === 0 ? 'items' : i === 1 ? 'mass (kg)' : 'area (m²)'}
                  <input
                    inputMode="decimal"
                    value={d[field as keyof CostDraft] as string}
                    onChange={(e) => edit({ [field]: e.target.value })}
                    placeholder="Leave unneeded bases blank"
                  />
                </label>
              ))}
            </div>
            {d.mode === 'planned' && (
              <label>
                Assumed accepted fraction (0 to 1)
                <input
                  inputMode="decimal"
                  value={d.accepted_fraction}
                  onChange={(e) => edit({ accepted_fraction: e.target.value })}
                />
              </label>
            )}
          </details>
          <div className="pw-actions pw-spaced">
            <button className="pw-primary" disabled={busy} onClick={() => calculate()}>
              {busy ? 'Calculating…' : 'Calculate this setup'}
            </button>
            <button disabled={busy || setups.length < 2} onClick={() => calculate(true)}>
              Compare current setups
            </button>
          </div>
          {result && resultKey === fingerprint && (
            <section className="pw-card pw-spaced" aria-live="polite">
              <span className="pw-overline">
                {d.mode === 'planned' ? 'Planning simulation' : 'Simulation from entered costs'} ·
                physical requirements not checked here
              </span>
              <h2>
                {result.status === 'complete'
                  ? 'Cost of what you included'
                  : result.status === 'partial'
                    ? 'Known subtotal; costs are missing'
                    : 'Check the conflicting inputs'}
              </h2>
              <div className="pw-metrics">
                <div>
                  <small>
                    {result.costs?.entered_scope_total !== null
                      ? 'Batch cost (included costs)'
                      : 'Known batch subtotal'}
                  </small>
                  <strong>
                    {displayMoney(
                      result.costs?.entered_scope_total ?? result.costs?.known_subtotal,
                    )}{' '}
                    {d.currency}
                  </strong>
                </div>
                {Object.entries(result.unit_costs ?? {})
                  .filter(([, v]) => v !== null)
                  .map(([k, v]) => (
                    <div key={k}>
                      <small>
                        {k.replaceAll('_', ' ')}
                        {result.unit_costs_scope === 'known_subtotal' ? ' · subtotal only' : ''}
                      </small>
                      <strong>
                        {displayMoney(v)} {d.currency}
                      </strong>
                    </div>
                  ))}
              </div>
              {['errors', 'questions', 'warnings'].map(
                (k) =>
                  result[k]?.length > 0 && (
                    <ul key={k}>
                      {result[k].map((x: any, i: number) => (
                        <li key={i}>
                          {typeof x === 'string' ? x : (x.message ?? JSON.stringify(x))}
                        </li>
                      ))}
                    </ul>
                  ),
              )}
            </section>
          )}
          {comparison && compareKey === comparisonFingerprint && (
            <section className="pw-card pw-spaced">
              <h2>
                {comparison.comparable
                  ? 'Compare the costs you included'
                  : 'These estimates are not comparable yet'}
              </h2>
              {comparison.reasons?.map((r: string, i: number) => (
                <p key={i}>{r}</p>
              ))}
              <div className="pw-table-scroll">
                <table>
                  <caption>
                    Cost simulations from each setup’s entered costs and usable output
                  </caption>
                  <thead>
                    <tr>
                      <th>Setup</th>
                      <th>Batch cost</th>
                      {comparisonMetrics.map((metric) => (
                        <th key={metric}>
                          {metric === 'per_usable_unit'
                            ? 'Per usable item'
                            : metric === 'per_usable_kg'
                              ? 'Per usable kg'
                              : 'Per usable m²'}
                        </th>
                      ))}
                      <th>Scope</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.results?.map((entry: any) => (
                      <tr key={entry.configuration_id}>
                        <th>
                          {setups.find((s) => s.id === entry.configuration_id)?.name ??
                            entry.configuration_id}
                        </th>
                        <td>
                          {displayMoney(
                            entry.costs?.entered_scope_total ?? entry.costs?.known_subtotal,
                          )}{' '}
                          {entry.currency}
                        </td>
                        {comparisonMetrics.map((metric) => (
                          <td key={metric}>
                            {displayMoney(entry.unit_costs?.[metric])} {entry.currency}
                            {entry.unit_costs_scope === 'known_subtotal' && (
                              <small>Known subtotal only</small>
                            )}
                          </td>
                        ))}
                        <td>
                          {entry.status === 'complete'
                            ? 'Included costs complete'
                            : entry.status === 'partial'
                              ? 'Costs missing'
                              : 'Review inputs'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {costWinnerSummaries(comparison, setups).map((winner) => (
                <p key={winner.metric}>
                  <strong>Lowest {winner.metric.replaceAll('_', ' ')}:</strong>{' '}
                  {winner.names.join(', ')}
                </p>
              ))}
              <p>
                A cheaper setup still needs its product checks. Different ingredients and processes
                may change together; this comparison does not identify the cause.
              </p>
            </section>
          )}
        </>
      )}
    </section>
  )
}
