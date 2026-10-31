import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { CaseSummary } from './CaseDetails'
import type { BalanceMixRequest, BalanceMixResult, WorkshopCase } from '../types'

const quantity = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 6 })
const initial = {
  input_mass_kg: '',
  input_min_percent: '',
  input_max_percent: '',
  addition_name: '',
  addition_percent: '',
  target_min_percent: '',
  target_max_percent: '',
}

export function BalanceMix({
  caseData,
  onEditCase,
}: {
  caseData: WorkshopCase
  onEditCase: () => void
}) {
  const components = caseData.details.components.filter((row) => row.name.trim())
  const binders = components.filter((row) => row.role === 'binder')
  const [componentId, setComponentId] = useState(
    () => (binders.length === 1 ? binders[0].id : components[0]?.id) ?? null,
  )
  const component = components.find((row) => row.id === componentId)
  const total = caseData.details.components.reduce((sum, row) => sum + Number(row.amount), 0)
  const complete = caseData.details.components.every(
    (row) =>
      row.name.trim() &&
      row.amount.trim() &&
      Number.isFinite(Number(row.amount)) &&
      Number(row.amount) > 0,
  )
  function sharedFraction(id: number | null) {
    const row = components.find((item) => item.id === id)
    if (!row || !complete || caseData.details.amount_unit === 'volume_percent') return ''
    if (caseData.details.amount_unit === 'mass_percent')
      return Math.abs(total - 100) <= 0.000001 ? row.amount : ''
    return total > 0 ? String((Number(row.amount) * 100) / total) : ''
  }
  const [fields, setFields] = useState(() => ({
    ...initial,
    input_mass_kg: complete && caseData.details.amount_unit === 'g' ? String(total / 1000) : '',
    input_min_percent: sharedFraction(componentId),
    input_max_percent: sharedFraction(componentId),
  }))
  const [result, setResult] = useState<BalanceMixResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  function change(key: keyof typeof initial, value: string) {
    request.current?.abort()
    setBusy(false)
    setResult(null)
    setError('')
    setFields((current) => ({ ...current, [key]: value }))
  }
  const percentages = [
    'input_min_percent',
    'input_max_percent',
    'addition_percent',
    'target_min_percent',
    'target_max_percent',
  ] as const
  const valid =
    Boolean(component?.name.trim() && fields.addition_name.trim()) &&
    fields.input_mass_kg.trim() !== '' &&
    Number.isFinite(Number(fields.input_mass_kg)) &&
    Number(fields.input_mass_kg) > 0 &&
    Number(fields.input_mass_kg) <= 1_000_000 &&
    percentages.every(
      (key) =>
        fields[key].trim() !== '' &&
        Number.isFinite(Number(fields[key])) &&
        Number(fields[key]) >= 0 &&
        Number(fields[key]) <= 100,
    ) &&
    Number(fields.input_min_percent) <= Number(fields.input_max_percent) &&
    Number(fields.target_min_percent) <= Number(fields.target_max_percent)

  async function calculate() {
    if (!valid || busy) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    setBusy(true)
    setResult(null)
    setError('')
    const payload: BalanceMixRequest = {
      component: component!.name.trim(),
      input_mass_kg: Number(fields.input_mass_kg),
      input_min_percent: Number(fields.input_min_percent),
      input_max_percent: Number(fields.input_max_percent),
      addition_name: fields.addition_name.trim(),
      addition_percent: Number(fields.addition_percent),
      target_min_percent: Number(fields.target_min_percent),
      target_max_percent: Number(fields.target_max_percent),
    }
    try {
      const response = await api<BalanceMixResult>(
        '/api/advisor/balance-mix',
        payload,
        controller.signal,
      )
      if (!controller.signal.aborted) setResult(response)
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'The trial composition could not be calculated.',
        )
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return (
    <details className="workshop-weight-tool">
      <summary>
        <span>Balance a trial mix</span>
        <small>Use known mass fractions</small>
      </summary>
      <p>
        Use known mass fractions and a trial composition you choose. This does not predict strength,
        density or sound performance.
      </p>
      <CaseSummary brief={caseData.brief} />
      <p>
        Materials come from your case. A known mass recipe supplies the starting fraction; enter a
        measured range below when your trial input varies. Volume percentages are not converted to
        mass.
      </p>
      <button type="button" className="text-button" onClick={onEditCase}>
        {components.length ? 'Edit case details' : 'Add exact material details to your case'}
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void calculate()
        }}
      >
        <div className="product-pair">
          <label>
            Component to balance
            <select
              value={componentId ?? ''}
              disabled={!components.length}
              onChange={(event) => {
                const id = Number(event.target.value)
                request.current?.abort()
                setBusy(false)
                setResult(null)
                setError('')
                setComponentId(id)
                const fraction = sharedFraction(id)
                setFields((current) => ({
                  ...current,
                  input_min_percent: fraction,
                  input_max_percent: fraction,
                }))
              }}
            >
              {!components.length && <option value="">Add material details in your case</option>}
              {components.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Input mass (kg)
            <input
              type="number"
              min="0.000001"
              max="1000000"
              step="any"
              value={fields.input_mass_kg}
              onChange={(event) => change('input_mass_kg', event.target.value)}
              required
            />
          </label>
        </div>
        <div className="product-pair">
          <label>
            Current minimum (mass %)
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              value={fields.input_min_percent}
              onChange={(event) => change('input_min_percent', event.target.value)}
              required
            />
          </label>
          <label>
            Current maximum (mass %)
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              value={fields.input_max_percent}
              onChange={(event) => change('input_max_percent', event.target.value)}
              required
            />
          </label>
        </div>
        <div className="product-pair">
          <label>
            Addition material name
            <input
              maxLength={120}
              value={fields.addition_name}
              onChange={(event) => change('addition_name', event.target.value)}
              placeholder="Name the characterized addition"
              required
            />
          </label>
          <label>
            Component in addition (mass %)
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              value={fields.addition_percent}
              onChange={(event) => change('addition_percent', event.target.value)}
              required
            />
          </label>
        </div>
        <div className="product-pair">
          <label>
            Trial target minimum (mass %)
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              value={fields.target_min_percent}
              onChange={(event) => change('target_min_percent', event.target.value)}
              required
            />
          </label>
          <label>
            Trial target maximum (mass %)
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              value={fields.target_max_percent}
              onChange={(event) => change('target_max_percent', event.target.value)}
              required
            />
          </label>
        </div>
        <button type="submit" className="outline-button" disabled={!valid || busy}>
          {busy ? 'Calculating…' : 'Calculate trial addition'}
        </button>
      </form>
      {error && (
        <p className="workshop-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="workshop-trim-result" role="status">
          <strong>Trial composition calculation</strong>
          <p>{result.action}</p>
          {result.feasible && result.addition_min_kg !== null && (
            <>
              <p>
                {result.addition_max_kg === null ? (
                  <>
                    Add at least <strong>{quantity(result.addition_min_kg)} kg</strong> of{' '}
                    {result.addition_name}; this composition calculation has no finite upper
                    addition limit.
                  </>
                ) : result.addition_min_kg === 0 && result.addition_max_kg === 0 ? (
                  <>No addition is needed for this trial composition.</>
                ) : (
                  <>
                    Calculated addition:{' '}
                    <strong>
                      {quantity(result.addition_min_kg)}–{quantity(result.addition_max_kg)} kg
                    </strong>{' '}
                    of {result.addition_name}.
                  </>
                )}
              </p>
              {result.example_addition_kg !== null &&
                result.resulting_min_percent !== null &&
                result.resulting_max_percent !== null && (
                  <p>
                    Example trial dose: <strong>{quantity(result.example_addition_kg)} kg</strong>{' '}
                    of {result.addition_name}. The calculated {result.component} fraction would be{' '}
                    {quantity(result.resulting_min_percent)}–
                    {quantity(result.resulting_max_percent)} mass % across the entered input range.
                  </p>
                )}
              <p>
                This balances the entered composition. It does not show that a product property
                meets its target.
              </p>
            </>
          )}
          {result.next_options.length > 0 && (
            <>
              <p>Useful next options:</p>
              <ul>
                {result.next_options.map((option, index) => (
                  <li key={index}>{option}</li>
                ))}
              </ul>
            </>
          )}
          <details>
            <summary>Calculation notes</summary>
            <ul>
              {result.assumptions.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </details>
  )
}
