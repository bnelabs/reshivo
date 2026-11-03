import { toDisplay, unitLabel, useUnitSystem } from '../units'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { AssemblyObservationFields, WorkshopCase } from '../types'

type GroundedRecord = {
  quote: string
  text?: string
  kind?: 'user_reported' | 'simulated'
  number_text?: string
  unit?: 'g' | 'kg' | 'lb' | 'oz'
  normalized_kg?: number
}
type ObservationDraft = {
  result_kind: 'observation_draft'
  review_required: true
  fields: Record<string, GroundedRecord | null>
  assembly_observation: AssemblyObservationFields
  missing_fields: string[]
  questions: string[]
  provider: string
  model: string
  live: boolean
  usage: Record<string, number>
  request_id: string | null
  elapsed_ms: number
}
type NoteRecord = {
  workshop_case: WorkshopCase
  note: string
  response: ObservationDraft
  review_status: 'unapplied_draft' | 'applied'
  applied_observation?: AssemblyObservationFields
}
const observationSignature = (observation: AssemblyObservationFields) =>
  JSON.stringify([
    observation.id,
    observation.kind,
    observation.mass,
    observation.error,
    observation.maxAdd,
    observation.maxRemove,
    observation.adjustmentError,
    observation.idealFeedback,
  ])
function downloadRecord(record: NoteRecord) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = 'reshivo-assembly-note-record.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const reviewFields: {
  key: string
  observationKey: Exclude<keyof AssemblyObservationFields, 'idealFeedback'>
  label: string
  quantity?: boolean
}[] = [
  { key: 'id', observationKey: 'id', label: 'Observation reference' },
  { key: 'kind', observationKey: 'kind', label: 'Observation source' },
  { key: 'mass', observationKey: 'mass', label: 'Complete-assembly mass', quantity: true },
  {
    key: 'uncertainty',
    observationKey: 'error',
    label: 'Weighing uncertainty (±)',
    quantity: true,
  },
  { key: 'max_add_mass', observationKey: 'maxAdd', label: 'Available to add', quantity: true },
  {
    key: 'max_remove_mass',
    observationKey: 'maxRemove',
    label: 'Available to remove',
    quantity: true,
  },
  {
    key: 'adjustment_uncertainty',
    observationKey: 'adjustmentError',
    label: 'Adjustment uncertainty (±)',
    quantity: true,
  },
]
const simulatedNote =
  'Simulated observation ref trial-1: complete assembly mass 950 g, weighing uncertainty 5 g. I can add at most 100 g and remove at most 100 g. Adjustment uncertainty is 5 g.'

function DraftDetails({ draft }: { draft: ObservationDraft }) {
  const system = useUnitSystem()
  return (
    <>
      <p className="helper">
        {draft.live ? 'Live Meta note reading' : 'Recorded note reading'} · {draft.model}
      </p>
      <dl>
        {reviewFields.map((field) => {
          const value = draft.assembly_observation[field.observationKey]
          const source = draft.fields[field.key]
          const shownValue =
            field.observationKey === 'kind' && value
              ? value === 'simulated'
                ? 'Simulated observation'
                : 'User-reported weighing'
              : value
                ? field.quantity ? `${toDisplay(value, 'kg', system)} ${unitLabel('kg', system)}` : value
                : 'Not stated — remains unknown'
          return (
            <div key={field.key}>
              <dt>{field.label}</dt>
              <dd>
                <strong>{shownValue}</strong>
                {source?.quote && <q>{source.quote}</q>}
              </dd>
            </div>
          )
        })}
      </dl>
      {draft.questions.length > 0 && (
        <ul>
          {draft.questions.map((question, index) => (
            <li key={index}>{question}</li>
          ))}
        </ul>
      )}
    </>
  )
}

export function ObservationNoteReader({
  caseData,
  assemblyObservation,
  active,
  onApply,
}: {
  caseData: WorkshopCase
  assemblyObservation: AssemblyObservationFields
  active: boolean
  onApply: (observation: AssemblyObservationFields) => void
}) {
  const [note, setNote] = useState('')
  const [draftState, setDraftState] = useState<{
    value: ObservationDraft
    signature: string
  } | null>(null)
  const [lastApplied, setLastApplied] = useState<{
    record: NoteRecord
    signature: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const reviewArea = useRef<HTMLDivElement | null>(null)
  const signature = JSON.stringify([caseData, note])
  const currentSignature = useRef(signature)
  currentSignature.current = signature
  const draft = draftState?.signature === signature ? draftState.value : null
  const appliedSignature = JSON.stringify([caseData, observationSignature(assemblyObservation)])
  const appliedRecord = lastApplied?.signature === appliedSignature ? lastApplied.record : null

  useEffect(() => {
    request.current?.abort()
    setBusy(false)
    setDraftState(null)
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
    if (draft) reviewArea.current?.focus({ preventScroll: true })
  }, [draft])

  async function readNote() {
    if (!note.trim() || busy || !active) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    const submittedSignature = signature
    setBusy(true)
    setDraftState(null)
    setError('')
    try {
      const response = await api<ObservationDraft>(
        '/api/advisor/read-observation',
        {
          brief: caseData.brief,
          calculation_context: caseData.details,
          note: note.trim(),
        },
        controller.signal,
      )
      if (response.result_kind !== 'observation_draft' || response.review_required !== true)
        throw new Error('The note did not return reviewable observation details.')
      if (!controller.signal.aborted && currentSignature.current === submittedSignature)
        setDraftState({ value: response, signature: submittedSignature })
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'The note could not be read.')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return (
    <div className="assembly-note-reader">
      <label>
        Describe your weighing and adjustment limits
        <textarea
          rows={3}
          maxLength={6000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="For example: assembly ref A1 weighed 950 g, uncertainty ±5 g… Say whether this is an actual weighing or a simulation, and what you can add or remove."
        />
      </label>
      <p className="helper">
        Meta reads this note with your current case. Review its quoted details before applying them
        to your shared observation. Use kg, g, lb or oz; missing values stay unknown.
      </p>
      <div className="assembly-tool-actions">
        <button
          type="button"
          className="outline-button"
          disabled={!note.trim() || busy || !active}
          onClick={() => void readNote()}
        >
          {busy ? 'Reading note…' : 'Read note with Meta'}
        </button>
        {busy ? (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              request.current?.abort()
              setBusy(false)
              setError('Stopped waiting. The server may still finish its bounded request.')
            }}
          >
            Stop waiting
          </button>
        ) : (
          <button type="button" className="text-button" onClick={() => setNote(simulatedNote)}>
            Try a simulated weighing note
          </button>
        )}
      </div>
      {error && (
        <p className="workshop-error" role="alert">
          {error}
        </p>
      )}
      {draft && (
        <div className="assembly-note-review" ref={reviewArea} tabIndex={-1}>
          <h4>Review details from your note</h4>
          <p>
            Check each value against your own record. Applying replaces the previous observation,
            including clearing values absent from this note.
          </p>
          <DraftDetails draft={draft} />
          <div className="assembly-tool-actions">
            <button
              type="button"
              className="outline-button"
              disabled={!active}
              onClick={() => {
                const observation = { ...draft.assembly_observation, idealFeedback: false }
                setLastApplied({
                  record: structuredClone({
                    workshop_case: caseData,
                    note,
                    response: draft,
                    review_status: 'applied',
                    applied_observation: observation,
                  }),
                  signature: JSON.stringify([caseData, observationSignature(observation)]),
                })
                onApply(observation)
                setDraftState(null)
              }}
            >
              Apply reviewed details
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                downloadRecord({
                  workshop_case: caseData,
                  note,
                  response: draft,
                  review_status: 'unapplied_draft',
                })
              }
            >
              Download note record
            </button>
          </div>
        </div>
      )}
      {appliedRecord && (
        <details className="assembly-note-review assembly-applied-note">
          <summary>Details from applied note</summary>
          <p role="status">
            The reviewed details match your current case and shared observation. This record keeps
            the original note, quoted words, units and Meta response.
          </p>
          <blockquote>{appliedRecord.note}</blockquote>
          <DraftDetails draft={appliedRecord.response} />
          <button
            type="button"
            className="outline-button"
            onClick={() => downloadRecord(appliedRecord)}
          >
            Download note record
          </button>
        </details>
      )}
    </div>
  )
}
