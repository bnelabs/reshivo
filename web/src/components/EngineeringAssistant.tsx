import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { WorkshopCase } from '../types'
import type { FeedbackRequest, PlanRequest } from './AdaptationPlanner'

type Action =
  | 'keep_fixed'
  | 'adjust_volume'
  | 'increase_capacity'
  | 'add_mass'
  | 'remove_mass'
  | 'keep_mass'
  | 'request_changes'
type TraceEntry = {
  id: string
  name: string
  arguments: Record<string, unknown>
  inputs: unknown
  result: Record<string, unknown>
  elapsed_ms: number
}
type AssistResult = {
  result_kind: 'tool_backed_proposal'
  status: 'completed' | 'limit_reached' | 'provider_error'
  live: boolean
  provider: string
  model: string
  answer: string | null
  answer_verified: false
  decision: { action: Action; basis_call_id: string } | null
  verified_summary?: {
    scope: string
    action: Action
    proposed_max_fill_volume_cm3?: number
    chosen_signed_adjustment_kg?: number | null
    fixed_volume_feasible?: boolean
    adjustable_observations_feasible?: number
    observation_count?: number
    all_observations_fit?: boolean
    feasible?: boolean
    observation_id?: string
  }
  tool_trace: TraceEntry[]
  model_turns: number
  elapsed_ms: number
  error?: { message: string }
}
const actionLabel: Record<Action, string> = {
  keep_fixed: 'One fixed volume can fit',
  adjust_volume: 'Adjust fill volume for each reading',
  increase_capacity: 'A larger usable capacity can fit',
  add_mass: 'Add adjustable mass',
  remove_mass: 'Remove adjustable mass',
  keep_mass: 'The observed mass needs no adjustment',
  request_changes: 'Another change or measurement is needed',
}
const toolLabel: Record<string, string> = {
  compare_current_design: 'Compared fixed and adjustable fill',
  check_capacity_repair: 'Rechecked a larger capacity',
  check_mass_feedback: 'Checked the assembly mass correction',
}
const quantity = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 6 })

export function EngineeringAssistant({
  caseData,
  plan,
  feedback,
  active,
  onCapacitySuggestion,
}: {
  caseData: WorkshopCase
  plan: PlanRequest | null
  feedback: FeedbackRequest | null
  active: boolean
  onCapacitySuggestion?: (capacity: number) => void
}) {
  const [question, setQuestion] = useState(
    'What can I change to reach this mass target with these readings and limits?',
  )
  const [result, setResult] = useState<AssistResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const resultArea = useRef<HTMLDivElement | null>(null)
  const signature = JSON.stringify([caseData, plan, feedback, question])
  const targetValues = [caseData.details.mass_target_min_kg, caseData.details.mass_target_max_kg]
  const targetReady =
    targetValues.every(
      (value) =>
        value.trim() !== '' &&
        Number.isFinite(Number(value)) &&
        Number(value) >= 0 &&
        Number(value) <= 1_000_000,
    ) &&
    Number(targetValues[1]) > 0 &&
    Number(targetValues[0]) <= Number(targetValues[1])
  const calculationReady = Boolean(plan || feedback) && targetReady
  const currentSignature = useRef(signature)
  currentSignature.current = signature

  useEffect(() => {
    request.current?.abort()
    setResult(null)
    setBusy(false)
    setError('')
  }, [signature])
  useEffect(() => {
    if (!active) {
      request.current?.abort()
      setBusy(false)
    }
  }, [active])
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (!busy) return
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [busy])
  useEffect(() => {
    if (result) resultArea.current?.focus({ preventScroll: true })
  }, [result])

  async function ask() {
    if (!calculationReady || !active || busy || !question.trim()) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    const submittedSignature = signature
    setBusy(true)
    setElapsed(0)
    setResult(null)
    setError('')
    try {
      const response = await api<AssistResult>(
        '/api/adaptation/assist',
        {
          brief: caseData.brief,
          calculation_context: caseData.details,
          question: question.trim(),
          plan,
          feedback,
        },
        controller.signal,
      )
      if (!controller.signal.aborted && currentSignature.current === submittedSignature)
        setResult(response)
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'The assistant could not finish.')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  function download() {
    if (!result) return
    const url = URL.createObjectURL(
      new Blob(
        [JSON.stringify({ workshop_case: caseData, question, plan, feedback, result }, null, 2)],
        { type: 'application/json' },
      ),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'rematter-engineering-run.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const summary = result?.verified_summary
  return (
    <section className="engineering-assistant" aria-label="Meta engineering assistant">
      <div className="workshop-eyebrow">Meta + calculation tools</div>
      <h3>Work out the next change</h3>
      <p>
        Ask about this case. Meta can compare the design, check a larger capacity, or use the
        assembly observation entered above. It runs the calculations before proposing a next step.
      </p>
      {!calculationReady && (
        <p className="product-input-note">
          Set the shared mass target and enter a complete assembly observation with its bounds, or a
          matching density and capacity plan.
        </p>
      )}
      <label>
        What would you like help with?
        <textarea
          value={question}
          maxLength={3000}
          rows={3}
          onChange={(event) => setQuestion(event.target.value)}
        />
      </label>
      <div className="workshop-actions">
        <button
          type="button"
          className="primary-button"
          disabled={!calculationReady || !active || busy || !question.trim()}
          onClick={() => void ask()}
        >
          {busy ? `Working… ${elapsed}s` : 'Ask Meta to work this out'}
        </button>
        {busy && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              request.current?.abort()
              setBusy(false)
              setError('Stopped waiting. The server may still finish its bounded run.')
            }}
          >
            Stop waiting
          </button>
        )}
      </div>
      {error && (
        <p className="workshop-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div
          ref={resultArea}
          tabIndex={-1}
          className="workshop-trim-result"
          aria-label="Meta engineering result"
        >
          <span className="data-kind">
            {result.live ? 'Live Meta run' : 'Recorded run'} · Simulation
          </span>
          {result.status === 'completed' && result.decision ? (
            <>
              <h3>{actionLabel[result.decision.action]}</h3>
              <h4>Meta's proposed next step</h4>
              <p className="engineering-answer">{result.answer}</p>
              <p className="helper">
                The explanation is a model proposal. The calculation results below are checked
                separately.
              </p>
            </>
          ) : (
            <>
              <h3>This run did not finish</h3>
              <p>
                {result.error?.message ||
                  'The tool or time limit was reached before a supported answer was completed.'}
              </p>
              <p>
                Any completed calculations are listed below. There is no completed recommendation.
              </p>
            </>
          )}
          {summary && (
            <div className="engineering-checked">
              <h4>Calculation results</h4>
              {summary.proposed_max_fill_volume_cm3 !== undefined && (
                <>
                  <p>
                    Proposed usable capacity:{' '}
                    <strong>{quantity(summary.proposed_max_fill_volume_cm3)} cm³</strong>. All
                    entered readings fit: {summary.all_observations_fit ? 'yes' : 'no'}.
                  </p>
                  {onCapacitySuggestion && (
                    <button
                      type="button"
                      className="outline-button"
                      onClick={() => onCapacitySuggestion(summary.proposed_max_fill_volume_cm3!)}
                    >
                      Use suggested capacity in this comparison
                    </button>
                  )}
                  <p className="helper">
                    Changes this software comparison. It does not change or qualify a physical
                    enclosure.
                  </p>
                </>
              )}
              {summary.chosen_signed_adjustment_kg !== undefined &&
                summary.chosen_signed_adjustment_kg !== null && (
                  <p>
                    {summary.chosen_signed_adjustment_kg === 0
                      ? 'No mass correction needed'
                      : `${summary.chosen_signed_adjustment_kg > 0 ? 'Add' : 'Remove'} ${quantity(Math.abs(summary.chosen_signed_adjustment_kg))} kg`}
                    . Observation: {summary.observation_id}.
                  </p>
                )}
              {summary.observation_count !== undefined && (
                <p>
                  Adjustable fill fits {summary.adjustable_observations_feasible}/
                  {summary.observation_count} entered readings. One common fixed volume fits all:{' '}
                  {summary.fixed_volume_feasible ? 'yes' : 'no'}.
                </p>
              )}
              <p className="helper">{summary.scope}</p>
            </div>
          )}
          <details className="product-detail">
            <summary>Calculations run ({result.tool_trace.length})</summary>
            <ol>
              {result.tool_trace.map((entry) => (
                <li key={entry.id}>
                  {toolLabel[entry.name] || entry.name} · {quantity(entry.elapsed_ms)} ms
                </li>
              ))}
            </ol>
            <p className="helper">
              {result.model} · {result.model_turns} model turns ·{' '}
              {quantity(result.elapsed_ms / 1000)} seconds
            </p>
            <details>
              <summary>Full calculation record</summary>
              <pre className="engineering-trace">{JSON.stringify(result.tool_trace, null, 2)}</pre>
            </details>
          </details>
          <p className="helper">
            Applies to these entered readings and bounds. Physical performance and future batches
            have not been established.
          </p>
          <button type="button" className="text-button" onClick={download}>
            Download this engineering run
          </button>
        </div>
      )}
    </section>
  )
}
