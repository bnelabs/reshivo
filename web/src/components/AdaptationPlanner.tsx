import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { AssemblyObservationFields, MixCase, MixReading, WorkshopCase } from '../types'
import { EngineeringAssistant } from './EngineeringAssistant'

type DataKind = '' | 'user_measurements' | 'synthetic'
export type PlanRequest = {
  case: MixCase
  data_kind: Exclude<DataKind, ''>
  observations: MixReading[]
  tare_mass_kg: number
  tare_uncertainty_kg: number
  target_min_kg: number
  target_max_kg: number
  max_fill_volume_cm3: number
  baseline_fill_volume_cm3: number
  density_uncertainty_g_cm3: number
  volume_tolerance_cm3: number
}
export type FeedbackRequest = {
  observation: {
    id: string
    kind: 'user_reported' | 'simulated'
    mass_kg: number
    uncertainty_kg: number
  }
  max_add_mass_kg: number
  max_remove_mass_kg: number
  adjustment_uncertainty_kg: number
}
type VolumeChoice = {
  feasible: boolean
  volume_min_cm3: number | null
  volume_max_cm3: number | null
  chosen_volume_cm3: number | null
  simulated_mass_min_kg: number | null
  simulated_mass_max_kg: number | null
}
type PlanResult = {
  result_kind: 'simulation'
  model: string
  case: MixCase
  case_fingerprint: string
  plan_fingerprint: string
  request: PlanRequest
  data_kind: Exclude<DataKind, ''>
  fixed_volume: VolumeChoice
  observations: {
    observation: MixReading
    baseline: {
      volume_cm3: number
      volume_within_capacity: boolean
      simulated_mass_min_kg: number | null
      simulated_mass_max_kg: number | null
      inside_mass_target: boolean
    }
    adjustable: VolumeChoice
    diagnostics?: {
      reason_code: string
      reason: string
      capacity_can_resolve: boolean
      minimum_usable_capacity_cm3: number | null
      capacity_requirement_exceeds_supported_limit: boolean
    }
  }[]
  observation_count: number
  baseline_observations_inside_target: number
  adjustable_observations_feasible: number
  recommendation: string
  next_options: string[]
  assumptions: string[]
  physical_product_tested: false
  batch_consistency_established: false
  future_batches_predicted: false
}
type FeedbackResult = {
  result_kind: 'simulation'
  model: string
  mass_only: true
  plan_fingerprint: string
  case_fingerprint: string
  density_data_kind: string
  observation: {
    id: string
    kind: 'user_reported' | 'simulated'
    mass_kg: number
    uncertainty_kg: number
  }
  observed_mass_min_kg: number
  observed_mass_max_kg: number
  feasible: boolean
  action: 'add' | 'remove' | 'none' | 'unresolved'
  signed_adjustment_min_kg: number | null
  signed_adjustment_max_kg: number | null
  chosen_signed_adjustment_kg: number | null
  simulated_mass_min_kg_after_adjustment: number | null
  simulated_mass_max_kg_after_adjustment: number | null
  volume_status: string
  next_options: string[]
  assumptions: string[]
  physical_product_tested: false
  batch_consistency_established: false
}
const quantity = (value: number | null, digits = 4) =>
  value === null
    ? 'Not calculated'
    : value.toLocaleString('en-US', { maximumFractionDigits: digits })
const interval = (minimum: number | null, maximum: number | null, unit: string) =>
  minimum === null || maximum === null
    ? 'No fit'
    : `${quantity(minimum)}–${quantity(maximum)} ${unit}`
const numberReady = (value: string, positive = false) =>
  value.trim() !== '' &&
  Number.isFinite(Number(value)) &&
  Number(value) >= (positive ? 1e-9 : 0) &&
  Number(value) <= 1_000_000

export function AdaptationPlanner({
  caseData,
  materialCase,
  readings,
  ready,
  baselineVolume,
  active = true,
  assemblyObservation,
  onAssemblyObservationChange,
}: {
  caseData: WorkshopCase
  materialCase: MixCase | null
  readings: MixReading[]
  ready: boolean
  baselineVolume: string
  active?: boolean
  assemblyObservation: AssemblyObservationFields
  onAssemblyObservationChange: (observation: AssemblyObservationFields) => void
}) {
  const [dataKind, setDataKind] = useState<DataKind>('')
  const [fields, setFields] = useState({
    tare: '',
    capacity: '',
    baseline: baselineVolume,
    tareError: '',
    densityError: '',
    volumeError: '',
  })
  const [idealized, setIdealized] = useState(false)
  const [planState, setPlanState] = useState<{
    value: PlanResult
    workshopCase: WorkshopCase
    signature: string
  } | null>(null)
  const feedbackFields = assemblyObservation
  const idealFeedback = assemblyObservation.idealFeedback
  const feedbackSignature = JSON.stringify(assemblyObservation)
  const [feedback, setFeedback] = useState<FeedbackResult | null>(null)
  const [busy, setBusy] = useState<'plan' | 'feedback' | null>(null)
  const [error, setError] = useState('')
  const planRequest = useRef<AbortController | null>(null)
  const feedbackRequest = useRef<AbortController | null>(null)
  const output = useRef<HTMLDivElement | null>(null)
  const signature = JSON.stringify([caseData, materialCase, readings, baselineVolume, ready])
  const readingSignature = JSON.stringify([materialCase, readings])
  const plan = planState?.signature === signature ? planState.value : null
  const targetMinimum = caseData.details.mass_target_min_kg
  const targetMaximum = caseData.details.mass_target_max_kg

  useEffect(() => {
    planRequest.current?.abort()
    feedbackRequest.current?.abort()
    setBusy(null)
    setPlanState(null)
    setFeedback(null)
    setError('')
  }, [signature])
  useEffect(() => setDataKind(''), [readingSignature])
  useEffect(() => {
    feedbackRequest.current?.abort()
    setFeedback(null)
    setBusy((current) => (current === 'feedback' ? null : current))
  }, [feedbackSignature])
  useEffect(() => {
    if (!active) {
      planRequest.current?.abort()
      feedbackRequest.current?.abort()
      setBusy(null)
    }
  }, [active])
  useEffect(() => {
    setFields((current) => ({ ...current, baseline: baselineVolume }))
  }, [baselineVolume])
  useEffect(
    () => () => {
      planRequest.current?.abort()
      feedbackRequest.current?.abort()
    },
    [],
  )
  useEffect(() => {
    if (plan || feedback) output.current?.focus({ preventScroll: true })
  }, [plan, feedback])

  function clearPlan() {
    planRequest.current?.abort()
    feedbackRequest.current?.abort()
    setBusy(null)
    setPlanState(null)
    setFeedback(null)
    setError('')
  }
  function editField(key: keyof typeof fields, value: string) {
    clearPlan()
    setFields((current) => ({ ...current, [key]: value }))
  }
  function editFeedback(
    key: Exclude<keyof AssemblyObservationFields, 'idealFeedback'>,
    value: string,
  ) {
    feedbackRequest.current?.abort()
    setBusy(null)
    setFeedback(null)
    setError('')
    onAssemblyObservationChange({ ...assemblyObservation, [key]: value })
  }
  const externalBasis = materialCase?.density_volume_basis === 'external_volume'
  const planReady =
    ready &&
    Boolean(materialCase && externalBasis && dataKind && readings.length) &&
    numberReady(targetMinimum) &&
    numberReady(targetMaximum, true) &&
    Number(targetMinimum) <= Number(targetMaximum) &&
    numberReady(fields.tare) &&
    numberReady(fields.capacity, true) &&
    numberReady(fields.baseline) &&
    Number(fields.baseline) <= Number(fields.capacity) &&
    (idealized ||
      [fields.tareError, fields.densityError, fields.volumeError].every((value) =>
        numberReady(value),
      ))
  const feedbackReady =
    Boolean(planReady && feedbackFields.id.trim() && feedbackFields.kind) &&
    [feedbackFields.mass, feedbackFields.maxAdd, feedbackFields.maxRemove].every((value) =>
      numberReady(value),
    ) &&
    (idealFeedback ||
      [feedbackFields.error, feedbackFields.adjustmentError].every((value) => numberReady(value)))

  const preparedPlan: PlanRequest | null =
    planReady && materialCase && dataKind
      ? {
          case: materialCase,
          data_kind: dataKind,
          observations: readings,
          tare_mass_kg: Number(fields.tare),
          tare_uncertainty_kg: idealized ? 0 : Number(fields.tareError),
          target_min_kg: Number(targetMinimum),
          target_max_kg: Number(targetMaximum),
          max_fill_volume_cm3: Number(fields.capacity),
          baseline_fill_volume_cm3: Number(fields.baseline),
          density_uncertainty_g_cm3: idealized ? 0 : Number(fields.densityError),
          volume_tolerance_cm3: idealized ? 0 : Number(fields.volumeError),
        }
      : null
  const preparedFeedback: FeedbackRequest | null =
    feedbackReady && feedbackFields.kind
      ? {
          observation: {
            id: feedbackFields.id.trim(),
            kind: feedbackFields.kind,
            mass_kg: Number(feedbackFields.mass),
            uncertainty_kg: idealFeedback ? 0 : Number(feedbackFields.error),
          },
          max_add_mass_kg: Number(feedbackFields.maxAdd),
          max_remove_mass_kg: Number(feedbackFields.maxRemove),
          adjustment_uncertainty_kg: idealFeedback ? 0 : Number(feedbackFields.adjustmentError),
        }
      : null

  async function calculatePlan() {
    if (!preparedPlan || !active || busy) return
    const controller = new AbortController()
    planRequest.current?.abort()
    feedbackRequest.current?.abort()
    planRequest.current = controller
    setBusy('plan')
    setError('')
    setPlanState(null)
    setFeedback(null)
    const snapshot = structuredClone(caseData)
    try {
      const response = await api<PlanResult>(
        '/api/adaptation/plan',
        preparedPlan,
        controller.signal,
      )
      if (!controller.signal.aborted)
        setPlanState({ value: response, workshopCase: snapshot, signature })
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : 'The volume comparison could not finish.',
        )
    } finally {
      if (!controller.signal.aborted) setBusy(null)
    }
  }
  async function calculateFeedback() {
    if (!preparedFeedback || !preparedPlan || !active || busy) return
    const controller = new AbortController()
    feedbackRequest.current?.abort()
    feedbackRequest.current = controller
    setBusy('feedback')
    setError('')
    setFeedback(null)
    try {
      const boundPlan =
        plan ?? (await api<PlanResult>('/api/adaptation/plan', preparedPlan, controller.signal))
      if (controller.signal.aborted) return
      if (!plan)
        setPlanState({ value: boundPlan, workshopCase: structuredClone(caseData), signature })
      const response = await api<FeedbackResult>(
        '/api/adaptation/feedback',
        {
          plan: boundPlan.request,
          plan_fingerprint: boundPlan.plan_fingerprint,
          ...preparedFeedback,
        },
        controller.signal,
      )
      if (!controller.signal.aborted) setFeedback(response)
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : 'The feedback calculation could not finish.',
        )
    } finally {
      if (!controller.signal.aborted) setBusy(null)
    }
  }
  function download() {
    if (!plan || !planState) return
    const url = URL.createObjectURL(
      new Blob(
        [JSON.stringify({ workshop_case: planState.workshopCase, plan, feedback }, null, 2)],
        { type: 'application/json' },
      ),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'rematter-input-variation-simulation.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <details className="workshop-weight-tool">
      <summary>
        <span>Handle input variation</span>
        <small>Compare fixed and adjustable fill volume</small>
      </summary>
      <p>
        Uses this case's processed-mix density readings and mass target. Compare one fixed fill
        volume with a separate adjustment for each entered reading, within the usable capacity.
      </p>
      {!ready && (
        <p className="product-input-note">Complete the case and density readings above first.</p>
      )}
      {materialCase && !externalBasis && (
        <p className="product-input-note">
          This capacity model needs external-volume density. The volume meaning must include the
          specimen's internal pores and match the occupied fill volume.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void calculatePlan()
        }}
      >
        <label>
          These density readings are
          <select
            value={dataKind}
            onChange={(event) => {
              clearPlan()
              setDataKind(event.target.value as DataKind)
            }}
          >
            <option value="">Choose how the readings were obtained</option>
            <option value="user_measurements">My entered measurements</option>
            <option value="synthetic">Synthetic values for a software simulation</option>
          </select>
        </label>
        <div className="product-pair">
          <label>
            Empty assembly mass (kg)
            <input
              type="number"
              min="0"
              max="1000000"
              step="any"
              value={fields.tare}
              onChange={(event) => editField('tare', event.target.value)}
            />
          </label>
          <label>
            Usable fill capacity (cm³)
            <input
              type="number"
              min="0.000000001"
              max="1000000"
              step="any"
              value={fields.capacity}
              onChange={(event) => editField('capacity', event.target.value)}
            />
          </label>
        </div>
        <label>
          Fixed fill volume to compare (cm³)
          <input
            type="number"
            min="0"
            max="1000000"
            step="any"
            value={fields.baseline}
            onChange={(event) => editField('baseline', event.target.value)}
          />
        </label>
        <p className="helper">
          Using your case's mass target:{' '}
          {targetMinimum && targetMaximum ? `${targetMinimum}–${targetMaximum} kg` : 'not set yet'}.
        </p>
        <label>
          <input
            type="checkbox"
            checked={idealized}
            onChange={(event) => {
              clearPlan()
              setIdealized(event.target.checked)
            }}
          />{' '}
          Use an idealized simulation without measurement error
        </label>
        <p className="helper">
          Otherwise enter explicit absolute bounds; unknown error is not treated as zero.
        </p>
        <div className="product-pair">
          <label>
            Tare mass uncertainty (± kg)
            <input
              type="number"
              min="0"
              max="1000000"
              step="any"
              disabled={idealized}
              value={fields.tareError}
              onChange={(event) => editField('tareError', event.target.value)}
            />
          </label>
          <label>
            Density uncertainty (± g/cm³)
            <input
              type="number"
              min="0"
              max="1000000"
              step="any"
              disabled={idealized}
              value={fields.densityError}
              onChange={(event) => editField('densityError', event.target.value)}
            />
          </label>
        </div>
        <label>
          Fill volume tolerance (± cm³)
          <input
            type="number"
            min="0"
            max="1000000"
            step="any"
            disabled={idealized}
            value={fields.volumeError}
            onChange={(event) => editField('volumeError', event.target.value)}
          />
        </label>
        <button type="submit" className="outline-button" disabled={!planReady || Boolean(busy)}>
          {busy === 'plan' ? 'Comparing…' : 'Compare volume choices'}
        </button>
      </form>
      {error && (
        <p className="workshop-error" role="alert">
          {error}
        </p>
      )}
      {plan && (
        <div
          ref={output}
          tabIndex={-1}
          className="workshop-trim-result"
          aria-label="Input variation simulation"
        >
          <span className="data-kind">
            Simulation ·{' '}
            {plan.data_kind === 'synthetic'
              ? 'synthetic density readings'
              : 'user-entered density readings'}
          </span>
          <h3>Fixed versus adjustable volume</h3>
          <p>{plan.recommendation}</p>
          <p>
            Fixed baseline:{' '}
            <strong>
              {plan.baseline_observations_inside_target}/{plan.observation_count}
            </strong>{' '}
            entered readings fit the modeled mass target. Individually adjustable volume:{' '}
            <strong>
              {plan.adjustable_observations_feasible}/{plan.observation_count}
            </strong>{' '}
            have a feasible choice within capacity and the entered bounds.
          </p>
          {plan.fixed_volume.feasible && (
            <p>
              Example common volume: {quantity(plan.fixed_volume.chosen_volume_cm3)} cm³. Allowed
              interval:{' '}
              {interval(plan.fixed_volume.volume_min_cm3, plan.fixed_volume.volume_max_cm3, 'cm³')}.
            </p>
          )}
          {plan.observations.some((row) => !row.adjustable.feasible && row.diagnostics) && (
            <div className="workshop-open-questions">
              <h4>What would let this input fit?</h4>
              <ul>
                {plan.observations
                  .filter((row) => !row.adjustable.feasible && row.diagnostics)
                  .slice(0, 3)
                  .map((row) => (
                    <li key={row.observation.id}>
                      {row.observation.id}: {row.diagnostics!.reason}
                      {row.diagnostics!.minimum_usable_capacity_cm3 !== null && (
                        <>
                          {' '}
                          Usable capacity needed: at least{' '}
                          {quantity(row.diagnostics!.minimum_usable_capacity_cm3)} cm³.
                        </>
                      )}
                    </li>
                  ))}
              </ul>
              <p>These are model conditions. See each reading below for the complete comparison.</p>
            </div>
          )}
          <details className="product-detail">
            <summary>Separate calculation for each reading</summary>
            <div className="product-reading-table">
              <table>
                <thead>
                  <tr>
                    <th>Reading</th>
                    <th>Density (g/cm³)</th>
                    <th>Fixed-volume mass (kg)</th>
                    <th>Chosen volume and allowed interval (cm³)</th>
                    <th>Modeled mass at chosen volume (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.observations.map((row) => (
                    <tr key={row.observation.id}>
                      <th>{row.observation.id}</th>
                      <td>{quantity(row.observation.value_g_cm3, 5)}</td>
                      <td>
                        {row.baseline.volume_within_capacity
                          ? interval(
                              row.baseline.simulated_mass_min_kg,
                              row.baseline.simulated_mass_max_kg,
                              'kg',
                            )
                          : 'Capacity does not fit'}
                      </td>
                      <td>
                        {row.adjustable.feasible ? (
                          <>
                            {quantity(row.adjustable.chosen_volume_cm3)} cm³
                            <br />
                            Allowed:{' '}
                            {interval(
                              row.adjustable.volume_min_cm3,
                              row.adjustable.volume_max_cm3,
                              'cm³',
                            )}
                          </>
                        ) : (
                          <>
                            No fit
                            {row.diagnostics && (
                              <p className="helper">
                                {row.diagnostics.reason}
                                {row.diagnostics.minimum_usable_capacity_cm3 !== null && (
                                  <>
                                    {' '}
                                    Minimum usable capacity:{' '}
                                    {quantity(row.diagnostics.minimum_usable_capacity_cm3)} cm³.
                                  </>
                                )}
                              </p>
                            )}
                          </>
                        )}
                      </td>
                      <td>
                        {interval(
                          row.adjustable.simulated_mass_min_kg,
                          row.adjustable.simulated_mass_max_kg,
                          'kg',
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details className="product-detail">
            <summary>Options and calculation notes</summary>
            <ul>
              {plan.next_options.map((item, index) => (
                <li key={`option-${index}`}>{item}</li>
              ))}
            </ul>
            <ul>
              {plan.assumptions.map((item, index) => (
                <li key={`note-${index}`}>{item}</li>
              ))}
            </ul>
          </details>
          <button type="button" className="text-button" onClick={download}>
            Download this simulation
          </button>
        </div>
      )}
      {preparedPlan && (
        <details className="product-detail">
          <summary>Check a completed assembly</summary>
          <p>
            Enter an actual reported mass or a clearly labelled simulated observation. This step
            calculates a mass-only correction using the same case and target.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void calculateFeedback()
            }}
          >
            <div className="product-pair">
              <label>
                Observation reference
                <input
                  maxLength={80}
                  value={feedbackFields.id}
                  onChange={(event) => editFeedback('id', event.target.value)}
                />
              </label>
              <label>
                Mass observation type
                <select
                  value={feedbackFields.kind}
                  onChange={(event) => editFeedback('kind', event.target.value)}
                >
                  <option value="">Choose the observation type</option>
                  <option value="user_reported">User-reported assembly mass</option>
                  <option value="simulated">Simulated assembly mass</option>
                </select>
              </label>
            </div>
            <label>
              Observed complete-assembly mass (kg)
              <input
                type="number"
                min="0"
                max="1000000"
                step="any"
                value={feedbackFields.mass}
                onChange={(event) => editFeedback('mass', event.target.value)}
              />
            </label>
            <div className="product-pair">
              <label>
                Maximum mass available to add (kg)
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="any"
                  value={feedbackFields.maxAdd}
                  onChange={(event) => editFeedback('maxAdd', event.target.value)}
                />
              </label>
              <label>
                Maximum adjustable mass to remove (kg)
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="any"
                  value={feedbackFields.maxRemove}
                  onChange={(event) => editFeedback('maxRemove', event.target.value)}
                />
              </label>
            </div>
            <label>
              <input
                type="checkbox"
                checked={idealFeedback}
                onChange={(event) => {
                  feedbackRequest.current?.abort()
                  setBusy(null)
                  setFeedback(null)
                  setError('')
                  onAssemblyObservationChange({
                    ...assemblyObservation,
                    idealFeedback: event.target.checked,
                  })
                }}
              />{' '}
              Use idealized feedback with zero measurement and adjustment error
            </label>
            <div className="product-pair">
              <label>
                Observed mass uncertainty (± kg)
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="any"
                  disabled={idealFeedback}
                  value={feedbackFields.error}
                  onChange={(event) => editFeedback('error', event.target.value)}
                />
              </label>
              <label>
                Adjustment uncertainty (± kg)
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="any"
                  disabled={idealFeedback}
                  value={feedbackFields.adjustmentError}
                  onChange={(event) => editFeedback('adjustmentError', event.target.value)}
                />
              </label>
            </div>
            <button
              type="submit"
              className="outline-button"
              disabled={!feedbackReady || Boolean(busy)}
            >
              {busy === 'feedback' ? 'Checking…' : 'Calculate mass correction'}
            </button>
          </form>
          {feedback && (
            <div className="workshop-trim-result" role="status">
              <strong>Simulation · mass-only feedback</strong>
              <p>
                {feedback.feasible
                  ? feedback.action === 'none'
                    ? 'The observed mass interval is already inside the target; no mass correction is needed.'
                    : `${feedback.action === 'add' ? 'Add' : 'Remove'} ${quantity(Math.abs(feedback.chosen_signed_adjustment_kg ?? 0))} kg as the modeled midpoint correction.`
                  : 'No permitted mass correction covers the entered bounds.'}
              </p>
              {feedback.feasible && (
                <p>
                  Modeled mass after correction:{' '}
                  {interval(
                    feedback.simulated_mass_min_kg_after_adjustment,
                    feedback.simulated_mass_max_kg_after_adjustment,
                    'kg',
                  )}
                  .
                </p>
              )}
              <p>{feedback.volume_status}</p>
              <ul>
                {feedback.next_options.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
              <p className="helper">
                Reweigh after an actual adjustment; check retention and durability separately.
              </p>
            </div>
          )}
        </details>
      )}
      <EngineeringAssistant
        caseData={caseData}
        plan={preparedPlan}
        feedback={preparedFeedback}
        active={active}
        onCapacitySuggestion={(capacity) => editField('capacity', String(capacity))}
      />
    </details>
  )
}
