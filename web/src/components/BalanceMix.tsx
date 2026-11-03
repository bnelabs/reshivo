import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api'
import { commandGrams } from '../quantity'
import { CaseSummary } from './CaseDetails'
import { UnitInput, toDisplay, unitLabel, useUnitSystem } from '../units'
import type {
  BalanceMixRequest,
  BalanceMixResult,
  MeasuredCompositionTrial,
  WorkshopCase,
} from '../types'
import type { CompositionDraft } from '../workspaceFile'

const quantity = (value: number) => String(value)
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
  preparedTrial,
  onClearPrepared,
  canAsk = false,
  onAsk,
  onDraftChange,
  initialDraft,
  onSnapshot,
}: {
  caseData: WorkshopCase
  onEditCase: () => void
  preparedTrial?: MeasuredCompositionTrial | null
  onClearPrepared?: () => void
  canAsk?: boolean
  onAsk?: (question: string) => void
  onDraftChange?: () => void
  initialDraft?: CompositionDraft | null
  onSnapshot?: (draft: CompositionDraft) => void
}) {
  const system = useUnitSystem()
  const mass = (value: number) =>
    system === 'metric'
      ? value < 1
        ? `${commandGrams(value)} g`
        : `${quantity(value)} kg`
      : `approximately ${toDisplay(String(value), 'kg', system)} lb (${quantity(value)} kg)`
  const components = caseData.details.components.filter((row) => row.name.trim())
  const binders = components.filter((row) => row.role === 'binder')
  const [componentId, setComponentId] = useState(() =>
    initialDraft
      ? initialDraft.component_id
      : ((binders.length === 1 ? binders[0].id : components[0]?.id) ?? null),
  )
  const component = components.find((row) => row.id === componentId)
  const linkedTrial =
    preparedTrial && JSON.stringify(preparedTrial.workshop_case) === JSON.stringify(caseData)
      ? preparedTrial
      : null
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
  const [fields, setFields] = useState(
    () =>
      initialDraft?.fields ?? {
        ...initial,
        input_mass_kg: complete && caseData.details.amount_unit === 'g' ? String(total / 1000) : '',
        input_min_percent: sharedFraction(componentId),
        input_max_percent: sharedFraction(componentId),
      },
  )
  const [result, setResult] = useState<BalanceMixResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef<AbortController | null>(null)
  const resultArea = useRef<HTMLDivElement | null>(null)
  const previousSerial = useRef(linkedTrial?.serial)
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (result) resultArea.current?.scrollIntoView({ block: 'start' })
  }, [result])
  useLayoutEffect(() => {
    if (previousSerial.current === linkedTrial?.serial) return
    previousSerial.current = linkedTrial?.serial
    onDraftChange?.()
    request.current?.abort()
    setBusy(false)
    setResult(null)
    setError('')
    const id =
      linkedTrial?.componentId ?? (binders.length === 1 ? binders[0].id : components[0]?.id) ?? null
    setComponentId(id)
    const fraction = sharedFraction(id)
    setFields({
      ...initial,
      input_mass_kg: complete && caseData.details.amount_unit === 'g' ? String(total / 1000) : '',
      input_min_percent: fraction,
      input_max_percent: fraction,
      target_min_percent: linkedTrial?.calculatorLevel ?? '',
      target_max_percent: linkedTrial?.calculatorLevel ?? '',
    })
  }, [linkedTrial?.serial])
  useLayoutEffect(() => {
    onSnapshot?.({ component_id: componentId, fields })
  }, [componentId, fields, onSnapshot])
  function change(key: keyof typeof initial, value: string) {
    onDraftChange?.()
    request.current?.abort()
    setBusy(false)
    setResult(null)
    setError('')
    setFields((current) => ({ ...current, [key]: value }))
  }

  const reviewQuestion =
    linkedTrial && result
      ? `Review this composition trial and suggest practical preparation, process and product checks. The reference readings describe the stated conditions. Trial summary:\n${JSON.stringify(
          {
            reading_type: linkedTrial.comparison.data_kind,
            reference: {
              property: linkedTrial.comparison.property_name,
              unit: linkedTrial.comparison.property_unit,
              target_min: linkedTrial.comparison.target_min,
              target_max: linkedTrial.comparison.target_max,
              method: linkedTrial.comparison.method,
              setting_id: linkedTrial.settingId,
              input: linkedTrial.comparison.input_name,
              input_unit: linkedTrial.comparison.input_unit,
              recorded_level: linkedTrial.exactLevel,
              observed_min: linkedTrial.comparison.setting.observed_min,
              observed_max: linkedTrial.comparison.setting.observed_max,
              reading_count: linkedTrial.comparison.setting.reading_count,
              in_target_count: linkedTrial.comparison.setting.in_target_count,
              grouping:
                'Identifiers omitted from this summary; do not infer specimens, runs or batches.',
            },
            proposed_trial: result,
            original_case_unchanged: true,
            new_mix_property_tested: false,
          },
        )}`
      : ''
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
      target_min_percent: Number(linkedTrial?.calculatorLevel ?? fields.target_min_percent),
      target_max_percent: Number(linkedTrial?.calculatorLevel ?? fields.target_max_percent),
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

  function downloadTrial() {
    if (!result || !linkedTrial) return
    const record = {
      result_kind: 'proposed_composition_trial',
      label:
        linkedTrial.comparison.data_kind === 'synthetic'
          ? 'Simulation of synthetic entered readings and composition arithmetic'
          : 'Simulation using user-reported readings and composition arithmetic',
      reference: linkedTrial,
      calculation: result,
      original_case_changed: false,
      new_mix_property_tested: false,
      limitations: [
        'The recorded property belongs only to the reference readings and their stated conditions.',
        'The calculation targets one exact composition; no property interpolation or dose-response model was used.',
        'Changing composition creates a proposed new trial. No finished-property or future-batch performance is established.',
        'The stated addition fraction, no-loss mixing assumptions and starting composition need to hold for this calculation.',
      ],
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'rematter-proposed-composition-trial.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const resultPanel = result && (
    <div ref={resultArea} className="workshop-trim-result composition-result" role="status">
      <strong>
        {linkedTrial?.comparison.data_kind === 'synthetic'
          ? 'Simulation · synthetic composition trial'
          : 'Simulation · composition calculation'}
      </strong>
      {!result.feasible && <p>{result.action}</p>}
      {!result.feasible && linkedTrial && (
        <p>
          {result.input_min_percent === result.input_max_percent
            ? 'This stock cannot reach the chosen composition. Use characterized stock on the other side of the target, or plan and test a different composition.'
            : 'No single fixed addition reaches this exact point across the entered starting range. Characterize each portion’s composition more precisely and recalculate its dose, or run and test a different composition. Reweighing a mixed portion alone does not identify its component fraction.'}{' '}
          The property readings do not support widening this target.
        </p>
      )}
      {result.feasible && result.addition_min_kg !== null && (
        <>
          <p className="composition-action">
            {result.addition_max_kg === null ? (
              <>
                Add at least <strong>{mass(result.addition_min_kg)}</strong> of{' '}
                {result.addition_name}; this composition calculation has no finite upper addition
                limit.
              </>
            ) : result.addition_min_kg === 0 && result.addition_max_kg === 0 ? (
              <>No addition is needed for this trial composition.</>
            ) : result.addition_min_kg === result.addition_max_kg ? (
              <>
                <strong className="composition-action-value">
                  Add {mass(result.addition_min_kg)}
                </strong>
                <span className="composition-action-stock">
                  of {result.addition_name} for this trial.
                </span>
              </>
            ) : (
              <>
                Calculated addition:{' '}
                <strong>
                  {quantity(result.addition_min_kg)}–{quantity(result.addition_max_kg)} kg
                </strong>{' '}
                of {result.addition_name}.
                {system === 'us' && (
                  <>
                    {' '}
                    US customary endpoints: {mass(result.addition_min_kg)} to{' '}
                    {mass(result.addition_max_kg)}.
                  </>
                )}
              </>
            )}
          </p>
          {result.example_addition_kg !== null &&
            result.resulting_min_percent !== null &&
            result.resulting_max_percent !== null && (
              <p>
                Example trial dose: <strong>{mass(result.example_addition_kg)}</strong> of{' '}
                {result.addition_name}. The calculated {result.component} fraction would be{' '}
                {result.resulting_min_percent === result.resulting_max_percent
                  ? quantity(result.resulting_min_percent)
                  : `${quantity(result.resulting_min_percent)}–${quantity(result.resulting_max_percent)}`}{' '}
                mass % across the entered input range.
              </p>
            )}
        </>
      )}
      {result.next_options.length > 0 && !linkedTrial && (
        <>
          <p>Useful next options:</p>
          <ul>
            {result.next_options.map((option, index) => (
              <li key={index}>{option}</li>
            ))}
          </ul>
        </>
      )}
      {linkedTrial && (
        <button type="button" className="outline-button" onClick={downloadTrial}>
          Download proposed trial and original readings
        </button>
      )}
      {linkedTrial && onAsk && (
        <>
          <details className="measurement-share-summary">
            <summary>What would be sent to Meta?</summary>
            <p>Your current case, recent conversation and this proposed-trial summary:</p>
            <pre>{reviewQuestion}</pre>
          </details>
          <button
            type="button"
            className="outline-button"
            disabled={!canAsk || reviewQuestion.length > 3000}
            onClick={() => onAsk(reviewQuestion)}
          >
            Ask Meta what to check for this mix trial
          </button>
          {reviewQuestion.length > 3000 && (
            <p>Shorten the names or reference method before sending this summary.</p>
          )}
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
  )

  return (
    <details className="workshop-weight-tool composition-tool">
      <summary>
        <span>{linkedTrial ? 'Prepare your next mix trial' : 'Balance a trial mix'}</span>
        <small>Use known mass fractions</small>
      </summary>
      {initialDraft && !linkedTrial && (
        <p className="measurement-prompt">
          Reopened quantity draft. Its saved target is a manual trial composition until you
          reconfirm a matching recorded setting. Review the inputs and recalculate; no prior dose or
          property result is restored.
        </p>
      )}
      {resultPanel}
      {linkedTrial ? (
        <section className="measurement-case" aria-label="Recorded setting for this trial">
          <strong>
            {linkedTrial.comparison.data_kind === 'synthetic'
              ? 'Simulation · synthetic reference'
              : 'Simulation · your reported reference'}
          </strong>
          <p>
            Proposed composition:{' '}
            <strong>
              {linkedTrial.exactLevel} mass % {linkedTrial.componentName}
            </strong>
            , from {linkedTrial.settingId}.
          </p>
          <p>
            {linkedTrial.comparison.property_name}: {linkedTrial.comparison.setting.observed_min}–
            {linkedTrial.comparison.setting.observed_max} {linkedTrial.comparison.property_unit};{' '}
            {linkedTrial.comparison.setting.in_target_count} of{' '}
            {linkedTrial.comparison.setting.reading_count} entered readings in target.
          </p>
          <p>Keep the stated process and check the new mix against your product targets.</p>
          <details>
            <summary>Reference method and target</summary>
            <p>{linkedTrial.comparison.method}</p>
            <p>
              Target:{' '}
              {linkedTrial.comparison.target_max === null
                ? `at least ${linkedTrial.comparison.target_min}`
                : `${linkedTrial.comparison.target_min}–${linkedTrial.comparison.target_max}`}{' '}
              {linkedTrial.comparison.property_unit}.
            </p>
          </details>
          <button type="button" className="text-button" onClick={onClearPrepared}>
            Use a manual composition target instead
          </button>
        </section>
      ) : (
        <p>Use known mass fractions and a trial composition you choose.</p>
      )}
      {linkedTrial ? (
        <details>
          <summary>Review the unchanged starting case</summary>
          <CaseSummary brief={caseData.brief} />
        </details>
      ) : (
        <CaseSummary brief={caseData.brief} />
      )}
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
              disabled={!components.length || Boolean(linkedTrial)}
              onChange={(event) => {
                const id = Number(event.target.value)
                onDraftChange?.()
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
            Input mass ({unitLabel('kg', system)})
            <UnitInput
              unit="kg"
              value={fields.input_mass_kg}
              onChange={(value) => change('input_mass_kg', value)}
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
              name="addition_name"
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
        <p className="measurement-help">
          Name stock whose {component?.name || 'selected component'} mass fraction you know. An
          addition with none of this component is zero percent.
        </p>
        <div className="product-pair">
          <label>
            Trial target minimum (mass %)
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              value={fields.target_min_percent}
              readOnly={Boolean(linkedTrial)}
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
              readOnly={Boolean(linkedTrial)}
              onChange={(event) => change('target_max_percent', event.target.value)}
              required
            />
          </label>
        </div>
        {linkedTrial && (
          <p className="measurement-help">
            Both limits stay at the recorded {linkedTrial.exactLevel} mass % point. Nearby
            compositions have no measured property link here.
          </p>
        )}
        <button type="submit" className="outline-button" disabled={!valid || busy}>
          {busy ? 'Calculating…' : 'Calculate trial addition'}
        </button>
      </form>
      {error && (
        <p className="workshop-error" role="alert">
          {error}
        </p>
      )}
    </details>
  )
}
