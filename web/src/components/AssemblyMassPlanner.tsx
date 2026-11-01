import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { AssemblyObservationFields, MassTrimResult, WorkshopCase } from '../types'
import type { FeedbackRequest } from './AdaptationPlanner'
import { EngineeringAssistant } from './EngineeringAssistant'
import { ObservationNoteReader } from './ObservationNoteReader'
import { BalancePlanner } from './BalancePlanner'
import type { BalancePreset } from './BalancePlanner'

type ObservedMassResult = {
  result_kind: 'simulation'
  input_mode: 'observed_mass_only'
  observation: FeedbackRequest['observation']
  feasible: boolean
  action: 'add' | 'remove' | 'none' | 'unresolved'
  chosen_signed_adjustment_kg: number | null
  signed_adjustment_min_kg: number | null
  signed_adjustment_max_kg: number | null
  observed_mass_min_kg: number
  observed_mass_max_kg: number
  simulated_mass_min_kg_after_adjustment: number | null
  simulated_mass_max_kg_after_adjustment: number | null
  next_options: string[]
  assumptions: string[]
}
const numberReady = (value: string) =>
  value.trim() !== '' &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0 &&
  Number(value) <= 1_000_000
const quantity = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 4 })
const mass = (value: number) =>
  Math.abs(value) < 1 ? `${quantity(value * 1000)} g` : `${quantity(value)} kg`
const massInterval = (minimum: number | null, maximum: number | null) => {
  if (minimum === null || maximum === null) return 'Not calculated'
  const grams = Math.max(Math.abs(minimum), Math.abs(maximum)) < 1
  const scale = grams ? 1000 : 1
  return `${quantity(minimum * scale)}–${quantity(maximum * scale)} ${grams ? 'g' : 'kg'}`
}
const numericFields: {
  key: 'mass' | 'error' | 'maxAdd' | 'maxRemove' | 'adjustmentError'
  label: string
  isError?: boolean
}[] = [
  { key: 'mass', label: 'Complete-assembly mass (kg)' },
  { key: 'error', label: 'Weighing uncertainty (± kg)', isError: true },
  { key: 'maxAdd', label: 'Maximum mass available to add (kg)' },
  { key: 'maxRemove', label: 'Maximum adjustable mass to remove (kg)' },
  { key: 'adjustmentError', label: 'Adjustment uncertainty (± kg)', isError: true },
]

export function AssemblyMassPlanner({
  caseData,
  onEditCase,
  assemblyObservation,
  onAssemblyObservationChange,
  active = true,
  balancePreset,
}: {
  caseData: WorkshopCase
  onEditCase: () => void
  assemblyObservation: AssemblyObservationFields
  onAssemblyObservationChange: (observation: AssemblyObservationFields) => void
  active?: boolean
  balancePreset?: BalancePreset
}) {
  const minimum = caseData.details.mass_target_min_kg
  const maximum = caseData.details.mass_target_max_kg
  const targetReady =
    [minimum, maximum].every(numberReady) &&
    Number(maximum) > 0 &&
    Number(minimum) <= Number(maximum)
  const observationReady =
    Boolean(assemblyObservation.id.trim() && assemblyObservation.kind) &&
    [assemblyObservation.mass, assemblyObservation.maxAdd, assemblyObservation.maxRemove].every(
      numberReady,
    ) &&
    (assemblyObservation.idealFeedback ||
      [assemblyObservation.error, assemblyObservation.adjustmentError].every(numberReady))
  const preparedFeedback: FeedbackRequest | null =
    targetReady && observationReady && assemblyObservation.kind
      ? {
          observation: {
            id: assemblyObservation.id.trim(),
            kind: assemblyObservation.kind,
            mass_kg: Number(assemblyObservation.mass),
            uncertainty_kg: assemblyObservation.idealFeedback
              ? 0
              : Number(assemblyObservation.error),
          },
          max_add_mass_kg: Number(assemblyObservation.maxAdd),
          max_remove_mass_kg: Number(assemblyObservation.maxRemove),
          adjustment_uncertainty_kg: assemblyObservation.idealFeedback
            ? 0
            : Number(assemblyObservation.adjustmentError),
        }
      : null
  const nominalReady = targetReady && numberReady(assemblyObservation.mass)
  const signature = JSON.stringify([caseData, assemblyObservation])
  const currentSignature = useRef(signature)
  currentSignature.current = signature
  const [resultState, setResultState] = useState<{
    value: ObservedMassResult
    signature: string
  } | null>(null)
  const [nominalState, setNominalState] = useState<{
    value: MassTrimResult
    signature: string
  } | null>(null)
  const result = resultState?.signature === signature ? resultState.value : null
  const nominal = nominalState?.signature === signature ? nominalState.value : null
  const [busy, setBusy] = useState<'bounded' | 'nominal' | null>(null)
  const [error, setError] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const request = useRef<AbortController | null>(null)
  const resultArea = useRef<HTMLDivElement | null>(null)

  function downloadResult() {
    if (!result) return
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { workshop_case: caseData, assembly_observation: assemblyObservation, result },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'rematter-assembly-mass-check.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  useEffect(() => {
    request.current?.abort()
    setBusy(null)
    setResultState(null)
    setNominalState(null)
    setError('')
  }, [signature])
  useEffect(() => {
    if (!active) {
      request.current?.abort()
      setBusy(null)
    }
  }, [active])
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (result) resultArea.current?.focus({ preventScroll: true })
  }, [result])

  function applyObservation(observation: AssemblyObservationFields) {
    request.current?.abort()
    setBusy(null)
    setError('')
    setResultState(null)
    setNominalState(null)
    onAssemblyObservationChange(observation)
  }
  function editObservation(update: Partial<AssemblyObservationFields>) {
    applyObservation({ ...assemblyObservation, ...update })
  }
  async function calculate(mode: 'bounded' | 'nominal') {
    if (!active || busy || (mode === 'bounded' ? !preparedFeedback : !nominalReady)) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    const submittedSignature = signature
    setBusy(mode)
    setError('')
    setResultState(null)
    setNominalState(null)
    try {
      if (mode === 'bounded') {
        const response = await api<ObservedMassResult>(
          '/api/adaptation/observed-mass',
          {
            brief: caseData.brief,
            calculation_context: caseData.details,
            feedback: preparedFeedback,
          },
          controller.signal,
        )
        if (!controller.signal.aborted && currentSignature.current === submittedSignature)
          setResultState({ value: response, signature: submittedSignature })
      } else {
        const response = await api<MassTrimResult>(
          '/api/advisor/mass-trim',
          {
            current_mass_kg: Number(assemblyObservation.mass),
            target_min_kg: Number(minimum),
            target_max_kg: Number(maximum),
          },
          controller.signal,
        )
        if (!controller.signal.aborted && currentSignature.current === submittedSignature)
          setNominalState({ value: response, signature: submittedSignature })
      }
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'The mass check could not finish.')
    } finally {
      if (!controller.signal.aborted) setBusy(null)
    }
  }

  return (
    <details className="workshop-weight-tool assembly-mass-planner" open={Boolean(balancePreset)}>
      <summary>
        <span>Check a weighed assembly</span>
        <small>Mass target · no density needed</small>
      </summary>
      <p>
        If mass matters for this product, use a complete-assembly weighing to check what you can add
        or remove. The observation and target carry through the app.
      </p>
      <p>
        Shared mass target: {targetReady ? `${minimum}–${maximum} kg` : 'not entered yet.'}{' '}
        <button type="button" className="text-button" onClick={onEditCase}>
          {targetReady ? 'Edit case target' : 'Set the mass range in your case'}
        </button>
      </p>
      <ObservationNoteReader
        caseData={caseData}
        assemblyObservation={assemblyObservation}
        active={active}
        onApply={applyObservation}
      />
      <details
        className="assembly-manual-details"
        open={manualOpen}
        onToggle={(event) => setManualOpen(event.currentTarget.open)}
      >
        <summary>Enter or edit observation details manually</summary>
        <p className="helper">
          All quantities below use kilograms. Enter explicit uncertainty bounds; a blank is unknown.
          Changes also update this observation in the calculation tools.
        </p>
        <div className="workshop-trim-fields">
          <label>
            Observation reference
            <input
              maxLength={80}
              value={assemblyObservation.id}
              onChange={(event) => editObservation({ id: event.target.value })}
            />
          </label>
          <label>
            Observation source
            <select
              value={assemblyObservation.kind}
              onChange={(event) =>
                editObservation({ kind: event.target.value as AssemblyObservationFields['kind'] })
              }
            >
              <option value="">Not recorded</option>
              <option value="user_reported">Actual, user-reported weighing</option>
              <option value="simulated">Simulated observation</option>
            </select>
          </label>
          {numericFields.map((field) => (
            <label key={field.key}>
              {field.label}
              <input
                type="number"
                min="0"
                max="1000000"
                step="any"
                disabled={field.isError && assemblyObservation.idealFeedback}
                value={assemblyObservation[field.key]}
                onChange={(event) => editObservation({ [field.key]: event.target.value })}
              />
            </label>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={assemblyObservation.idealFeedback}
            onChange={(event) => editObservation({ idealFeedback: event.target.checked })}
          />{' '}
          Use an idealized simulation with zero weighing and adjustment uncertainty
        </label>
      </details>
      {numberReady(assemblyObservation.mass) && (
        <p className="assembly-observation-summary">
          {assemblyObservation.kind === 'simulated'
            ? 'Simulated observation'
            : assemblyObservation.kind === 'user_reported'
              ? 'User-reported weighing'
              : 'Observation source not recorded'}
          {assemblyObservation.id.trim() ? ` · ${assemblyObservation.id.trim()}` : ''}: complete
          assembly {mass(Number(assemblyObservation.mass))}.
          {assemblyObservation.idealFeedback ? ' Zero-error idealization selected.' : ''}
        </p>
      )}
      {!preparedFeedback && (
        <p className="helper">
          {!targetReady
            ? 'Set a shared mass range in your case.'
            : 'Apply a reviewed note or enter the reference, source, mass, add/remove limits and both uncertainty bounds to run this check.'}
        </p>
      )}
      <button
        type="button"
        className="outline-button"
        disabled={!preparedFeedback || !active || Boolean(busy)}
        onClick={() => void calculate('bounded')}
      >
        {busy === 'bounded' ? 'Checking…' : 'Check adjustment within these limits'}
      </button>
      {error && (
        <p className="workshop-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div
          className="workshop-trim-result"
          ref={resultArea}
          tabIndex={-1}
          aria-label="Assembly mass check result"
        >
          <span className="data-kind">Simulation · complete-assembly mass only</span>
          <h3>
            {!result.feasible
              ? 'The entered limits cannot reach this target'
              : result.action === 'none'
                ? 'Keep the mass as it is'
                : `${result.action === 'add' ? 'Add' : 'Remove'} ${mass(Math.abs(result.chosen_signed_adjustment_kg ?? 0))}`}
          </h3>
          <p>
            Observation {result.observation.id}:{' '}
            {massInterval(result.observed_mass_min_kg, result.observed_mass_max_kg)}, including the
            entered weighing uncertainty.
          </p>
          {result.feasible && (
            <p>
              Modeled mass after this adjustment:{' '}
              {massInterval(
                result.simulated_mass_min_kg_after_adjustment,
                result.simulated_mass_max_kg_after_adjustment,
              )}
              , including the entered adjustment uncertainty.
            </p>
          )}
          {result.feasible && result.action !== 'none' && (
            <p>
              Modeled {result.action === 'add' ? 'addition' : 'removal'} range:{' '}
              {result.action === 'add'
                ? massInterval(result.signed_adjustment_min_kg, result.signed_adjustment_max_kg)
                : massInterval(
                    result.signed_adjustment_max_kg === null
                      ? null
                      : Math.abs(result.signed_adjustment_max_kg),
                    result.signed_adjustment_min_kg === null
                      ? null
                      : Math.abs(result.signed_adjustment_min_kg),
                  )}
              .
            </p>
          )}
          <ul>
            {result.next_options.map((option, index) => (
              <li key={index}>{option}</li>
            ))}
          </ul>
          <p className="helper">
            Reweigh the complete unit after an actual adjustment. This checks mass only; retention,
            durability, usable space and future-batch consistency remain unverified.
          </p>
          <details>
            <summary>Calculation assumptions</summary>
            <ul>
              {result.assumptions.map((assumption, index) => (
                <li key={index}>{assumption}</li>
              ))}
            </ul>
          </details>
          <button type="button" className="text-button" onClick={downloadResult}>
            Download this mass check
          </button>
        </div>
      )}
      <details className="assembly-nominal-tool">
        <summary>Nominal arithmetic when uncertainty or adjustment limits are unknown</summary>
        <p className="helper">
          Uses only the entered mass and shared target. It does not check uncertainty or available
          additions/removals. Enter the mass in the observation details above.
        </p>
        <button
          type="button"
          className="outline-button"
          disabled={!nominalReady || !active || Boolean(busy)}
          onClick={() => void calculate('nominal')}
        >
          {busy === 'nominal' ? 'Calculating…' : 'Calculate nominal adjustment'}
        </button>
        {nominal && (
          <div className="workshop-trim-result" role="status">
            <strong>Nominal arithmetic · uncertainty and limits not included</strong>
            <p>
              {nominal.status === 'inside'
                ? 'The entered mass is inside the target range.'
                : `${nominal.status === 'add' ? 'Add' : 'Remove'} ${massInterval(nominal.adjustment_min_kg, nominal.adjustment_max_kg)} for the entered mass and target.`}
            </p>
            <p>
              Reweigh after adjustment; this result does not establish a feasible physical change.
            </p>
          </div>
        )}
      </details>
      <BalancePlanner
        caseData={caseData}
        observation={assemblyObservation}
        feedback={preparedFeedback}
        onEditCase={onEditCase}
        active={active}
        preset={balancePreset}
        checkedMassCorrection={result?.feasible ? result.chosen_signed_adjustment_kg : null}
      />
      {!caseData.details.balance && (
        <EngineeringAssistant
          caseData={caseData}
          plan={null}
          feedback={preparedFeedback}
          active={active}
        />
      )}
    </details>
  )
}
