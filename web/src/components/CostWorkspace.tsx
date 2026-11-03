import { useState } from 'react'
import { api } from '../api'
import { newCostDraft } from '../projectWorkspace'
import type { ProjectWorkspace, CostDraft } from '../projectWorkspace'
import { costRequest } from '../manufacturingCost'
import { currentSetups, setupKey } from './TrialWorkspace'

type Props = {
  workspace: ProjectWorkspace
  onChange: (next: ProjectWorkspace) => void
  readingKind: 'user_reported' | 'synthetic'
  onReadingKindChange: (kind: 'user_reported' | 'synthetic') => void
  showHistoricalIdeas: boolean
}
const displayMoney = (value: unknown) =>
  typeof value === 'string'
    ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })
    : 'Unknown'
export function CostWorkspace({
  workspace: w,
  onChange,
  readingKind: kind,
  onReadingKindChange,
  showHistoricalIdeas,
}: Props) {
  const setups = currentSetups(w.configurations)
  const setupName = (s: (typeof setups)[number]) =>
    !showHistoricalIdeas && (w.trial_ideas?.[setupKey(s)]?.title === s.name || s.notes.startsWith(`Unverified trial idea: ${s.name}.`))
      ? `Trial setup ${setups.findIndex((item) => item.id === s.id) + 1}` : s.name
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
  const decisionRequest = {
    case_id: w.case_id,
    configurations: w.configurations,
    checks: w.checks,
    records: w.records.filter((r) => !w.record_exclusions?.[r.id]),
    assessment_kind: kind,
    cost_records: comparisonRequests,
  }
  const comparisonFingerprint = JSON.stringify(decisionRequest)
  const comparisonMetrics = (['per_usable_unit', 'per_usable_kg', 'per_usable_m2'] as const).filter(
    (metric) =>
      comparison?.configurations?.some((entry: any) => entry.cost?.unit_costs?.[metric] != null),
  )
  async function calculate(compare = false) {
    setBusy(true)
    setError('')
    try {
      if (compare) {
        setComparison(await api<any>('/api/project/compare-decisions', decisionRequest))
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
                  {setupName(s)} · version {s.revision}
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
            <label className="pw-inline-label">
              Readings for the comparison
              <select
                value={kind}
                onChange={(e) => onReadingKindChange(e.target.value as typeof kind)}
              >
                <option value="user_reported">My entered measurements</option>
                <option value="synthetic">Software simulation only</option>
              </select>
            </label>
            <button disabled={busy || setups.length < 2} onClick={() => calculate(true)}>
              Compare checks and costs
            </button>
            {setups.length < 2 && <small>Add another trial setup to compare.</small>}
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
              <h2>Compare product checks and costs</h2>
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
                      <th>Required checks</th>
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
                    {comparison.configurations?.map((entry: any) => (
                      <tr key={entry.id}>
                        <th>
                          {setups.find((s) => s.id === entry.id && s.revision === entry.revision) ? setupName(setups.find((s) => s.id === entry.id && s.revision === entry.revision)!) : 'Trial setup'} <small>Version {entry.revision}</small>
                        </th>
                        <td>
                          {displayMoney(
                            entry.cost?.costs?.entered_scope_total ??
                              entry.cost?.costs?.known_subtotal,
                          )}{' '}
                          {entry.cost?.currency}
                        </td>
                        <td>
                          <strong>
                            {entry.state === 'all_entered_checks_in_range'
                              ? 'Entered required checks in range'
                              : entry.state === 'out_of_range'
                                ? 'Outside a required target'
                                : entry.state === 'missing_records'
                                  ? 'Readings missing'
                                  : entry.state === 'target_not_set'
                                    ? 'Target not set'
                                    : entry.state === 'no_required_checks'
                                      ? 'No required checks'
                                      : 'Review needed'}
                          </strong>
                          {entry.checks
                            ?.filter((check: any) => check.required)
                            .map((check: any) => (
                              <small key={check.check_id}>
                                {check.name}: {check.state.replaceAll('_', ' ')}
                              </small>
                            ))}
                        </td>
                        {comparisonMetrics.map((metric) => (
                          <td key={metric}>
                            {displayMoney(entry.cost?.unit_costs?.[metric])} {entry.cost?.currency}
                            {entry.cost?.unit_costs_scope === 'known_subtotal' && (
                              <small>Known subtotal only</small>
                            )}
                          </td>
                        ))}
                        <td>
                          {entry.cost?.status === 'complete'
                            ? 'Included costs complete'
                            : entry.cost?.status === 'partial'
                              ? 'Costs missing'
                              : 'Review inputs'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {Object.entries(comparison.decisions ?? {})
                .filter(([, winner]: any) => winner && Array.isArray(winner.configuration_ids))
                .map(([metric, winner]: any) => (
                  <p key={metric}>
                    <strong>
                      Lowest{' '}
                      {metric === 'per_usable_unit'
                        ? 'cost per usable item'
                        : metric === 'per_usable_kg'
                          ? 'cost per usable kg'
                          : 'cost per usable m²'}{' '}
                      among setups with entered required checks in range:
                    </strong>{' '}
                    {winner.configuration_ids
                      .map((id: string) => { const s = setups.find((item) => item.id === id); return s ? setupName(s) : id })
                      .join(', ')}
                  </p>
                ))}
              <p>
                {kind === 'synthetic'
                  ? 'Simulation using the fictional readings selected above.'
                  : 'Based on the measurements you entered.'}{' '}
                This compares recorded setups only; it does not prove a finished product or predict
                future batches. Displayed costs are rounded; the comparison uses the full entered
                values.
              </p>
            </section>
          )}
        </>
      )}
    </section>
  )
}
