import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { commandGrams } from '../quantity'
import type { WorkshopCase } from '../types'
import { engineeringNotePatch } from '../engineeringNote'
import type { EngineeringDraft, Applied, Value, EngineeringNotePatch } from '../engineeringNote'
import { EngineeringAssistant } from './EngineeringAssistant'

const numberText = (value: Value | undefined) =>
  value === null || value === undefined ? '' : String(value)
const show = (value: Value | undefined) => numberText(value) || 'unknown'
const grams = (value: Value | undefined) =>
  typeof value === 'number' ? `${commandGrams(value)} g` : 'unknown'

function DraftSummary({ draft }: { draft: EngineeringDraft }) {
  const v = draft.values
  const target = (key: string) => draft.target_resolution[key]?.selected
  return (
    <div className="engineering-note-summary">
      <p>
        <strong>Targets</strong> {show(target('mass_target_min_kg'))}–
        {show(target('mass_target_max_kg'))} kg · x={show(target('balance_target_min_mm'))}…
        {show(target('balance_target_max_mm'))} mm
      </p>
      <p>
        <strong>{show(v.observation_id)}</strong> ·{' '}
        {v.observation_kind === 'simulated'
          ? 'Simulation'
          : v.observation_kind === 'user_reported'
            ? 'User-reported measurement'
            : 'Source unknown'}
        <br />
        Mass {grams(v.mass_kg)} ± {grams(v.weighing_uncertainty_kg)} · centre x={show(v.cg_x_mm)} ±{' '}
        {show(v.cg_uncertainty_mm)} mm
      </p>
      <p>{show(target('coordinate_basis'))}</p>
      {['a', 'b'].map((letter) => (
        <p key={letter}>
          <strong>{show(v[`position_${letter}_id`])}</strong> at x=
          {show(v[`position_${letter}_x_mm`])} ± {show(v[`position_${letter}_uncertainty_mm`])} mm
          <br />
          Add up to {grams(v[`position_${letter}_max_add_kg`])} · remove up to{' '}
          {grams(v[`position_${letter}_max_remove_kg`])}
        </p>
      ))}
      <p>
        <strong>Total limits</strong> add {grams(v.total_max_add_kg)} · remove{' '}
        {grams(v.total_max_remove_kg)}
        <br />
        Adjustment bound ±{grams(v.adjustment_uncertainty_kg)} at each active location · command
        increment {grams(v.command_resolution_kg)}
      </p>
    </div>
  )
}

function Questions({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <div className="engineering-note-questions">
      <strong>Still needed or different</strong>
      <ul>
        {items.slice(0, 3).map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ul>
      {items.length > 3 && (
        <details>
          <summary>{items.length - 3} other details needed for this check</summary>
          <ul>
            {items.slice(3).map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

export function EngineeringNoteReader({
  caseData,
  active,
  onApply,
}: {
  caseData: WorkshopCase
  active: boolean
  onApply: (patch: EngineeringNotePatch) => void
}) {
  const [note, setNote] = useState('')
  const [draftState, setDraftState] = useState<{
    signature: string
    draft: EngineeringDraft
  } | null>(null)
  const [appliedState, setAppliedState] = useState<{
    signature: string
    value: Applied
    draft: EngineeringDraft
    originalCase: WorkshopCase
  } | null>(null)
  const [reviewed, setReviewed] = useState(false)
  const [independent, setIndependent] = useState(false)
  const [targetChoice, setTargetChoice] = useState('')
  const [busy, setBusy] = useState<'read' | 'apply' | null>(null)
  const [error, setError] = useState('')
  const signature = JSON.stringify([caseData, note])
  const current = useRef(signature)
  current.current = signature
  const controller = useRef<AbortController | null>(null)
  const resultRef = useRef<HTMLDivElement | null>(null)
  const draft = draftState?.signature === signature ? draftState.draft : null
  const applied = appliedState?.signature === signature ? appliedState : null
  useEffect(() => {
    controller.current?.abort()
    setBusy(null)
    setError('')
  }, [signature, active])
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (draft || applied) {
      resultRef.current?.focus({ preventScroll: true })
      resultRef.current?.scrollIntoView({ block: 'start' })
    }
  }, [draft, applied])
  function requestBody() {
    return { brief: caseData.brief, calculation_context: caseData.details, note }
  }
  async function read() {
    if (!active || busy || !note.trim()) return
    const request = new AbortController()
    controller.current = request
    const submitted = signature
    setBusy('read')
    setError('')
    setDraftState(null)
    setAppliedState(null)
    setReviewed(false)
    setIndependent(false)
    try {
      const response = await api<EngineeringDraft>(
        '/api/advisor/read-engineering-note',
        requestBody(),
        request.signal,
      )
      if (request.signal.aborted || current.current !== submitted) return
      setTargetChoice(response.conflicts.length ? '' : 'current')
      setDraftState({ signature: submitted, draft: response })
    } catch (failure) {
      if (!request.signal.aborted && current.current === submitted)
        setError(failure instanceof Error ? failure.message : 'The note could not be read.')
    } finally {
      if (controller.current === request) setBusy(null)
    }
  }
  async function apply() {
    if (!draft || !reviewed || !independent || !targetChoice || busy || !active) return
    const request = new AbortController()
    controller.current = request
    const submitted = signature
    setBusy('apply')
    setError('')
    try {
      const response = await api<Applied>(
        '/api/adaptation/apply-engineering-note',
        {
          ...requestBody(),
          source_fields: draft.source_fields,
          request_fingerprint: draft.request_fingerprint,
          draft_fingerprint: draft.draft_fingerprint,
          review_confirmed: reviewed,
          independent_adjustments: independent,
          target_choice: targetChoice,
        },
        request.signal,
      )
      if (request.signal.aborted || current.current !== submitted) return
      const patch = engineeringNotePatch(caseData, response)
      setAppliedState({
        signature: JSON.stringify([{ ...caseData, details: patch.details }, note]),
        value: response,
        draft,
        originalCase: caseData,
      })
      onApply(patch)
    } catch (failure) {
      if (!request.signal.aborted && current.current === submitted)
        setError(
          failure instanceof Error ? failure.message : 'The reviewed note could not be applied.',
        )
    } finally {
      if (controller.current === request) setBusy(null)
    }
  }
  function download() {
    const record = applied
      ? {
          status: 'reviewed_and_applied',
          note,
          original_case: applied.originalCase,
          current_case: caseData,
          draft: applied.draft,
          result: applied.value,
        }
      : draft
        ? { status: 'unapplied_draft', note, workshop_case: caseData, draft }
        : null
    if (!record) return
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'rematter-engineering-note.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <details className="engineering-note-reader">
      <summary>
        <span>Read a mass-and-balance trial note</span>
        <small>Skip separate field entry</small>
      </summary>
      <p>
        Use the material and product already in your case. Paste the assembly readings, trim
        locations and bounds; targets can come from your brief. Review the interpretation before
        using it.
      </p>
      <label>
        Trial note
        <textarea
          rows={5}
          maxLength={6000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Paste your note, including units. Missing details stay unknown."
        />
      </label>
      <button
        type="button"
        className="outline-button"
        onClick={() => void read()}
        disabled={!active || busy !== null || !note.trim()}
      >
        {busy === 'read' ? 'Reading the note…' : 'Read trial note with Meta'}
      </button>
      {busy && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            controller.current?.abort()
            setBusy(null)
          }}
        >
          Stop waiting
        </button>
      )}
      {error && (
        <p className="workshop-error" role="alert">
          {error}
        </p>
      )}
      {(draft || applied) && (
        <div ref={resultRef} tabIndex={-1} className="engineering-note-review">
          {draft && !applied && (
            <>
              <h3>Review this reading</h3>
              <p className="helper">
                Live Meta draft · {draft.model} · {(draft.elapsed_ms / 1000).toFixed(1)} s. Quoted
                numbers and units were checked; their meaning still needs your review.
              </p>
              <DraftSummary draft={draft} />
              <Questions items={draft.questions} />
              {draft.conflicts.length > 0 && (
                <fieldset>
                  <legend>Which targets should this check use?</legend>
                  <label>
                    <input
                      type="radio"
                      name="engineering-target-choice"
                      checked={targetChoice === 'current'}
                      onChange={() => setTargetChoice('current')}
                    />
                    Keep the current shared targets and coordinate basis
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="engineering-target-choice"
                      checked={targetChoice === 'proposed'}
                      onChange={() => setTargetChoice('proposed')}
                    />
                    Use the proposed targets and coordinate basis from this note
                  </label>
                </fieldset>
              )}
              <details>
                <summary>See the words behind these values</summary>
                <dl>
                  {Object.entries(draft.fields)
                    .filter(([, v]) => v !== null)
                    .map(([field, v]) => (
                      <div key={field}>
                        <dt>{field.replaceAll('_', ' ')}</dt>
                        <dd>
                          “{v?.quote}”
                          <small>
                            {' '}
                            {v?.source === 'brief.targets' ? 'Your case target' : 'Your note'}
                          </small>
                        </dd>
                      </div>
                    ))}
                </dl>
              </details>
              <label className="engineering-note-confirm">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
                I reviewed this draft against my note.
              </label>
              <label className="engineering-note-confirm">
                <input
                  type="checkbox"
                  checked={independent}
                  onChange={(event) => setIndependent(event.target.checked)}
                />
                I confirm that the adjustment bound applies independently at each active location.
              </label>
              <button
                type="button"
                className="outline-button"
                disabled={!reviewed || !independent || !targetChoice || busy !== null || !active}
                onClick={() => void apply()}
              >
                {busy === 'apply'
                  ? 'Checking…'
                  : draft.missing_fields.length
                    ? 'Apply known values; keep missing details blank'
                    : 'Apply and check both targets'}
              </button>
            </>
          )}
          {applied && (
            <>
              <h3>
                {applied.value.check?.feasible
                  ? 'A checked action from your note'
                  : applied.value.ready
                    ? 'No checked adjustment within these limits'
                    : 'Known values applied; more detail is needed'}
              </h3>
              <p className="helper">
                {caseData.brief.product} · {show(applied.value.reviewed_values.observation_id)} ·{' '}
                {applied.value.reviewed_values.observation_kind === 'simulated'
                  ? 'Simulation'
                  : 'User-reported inputs · simulation of those readings'}
              </p>
              {applied.value.check?.commands && (
                <div className="balance-command-list">
                  {applied.value.check.commands.map((row) => (
                    <p key={row.position_id}>
                      <strong>
                        {row.action === 'none'
                          ? 'No change'
                          : `${row.action === 'add' ? 'Add' : 'Remove'} ${commandGrams(Math.abs(row.command_kg))} g`}
                      </strong>
                      <span>
                        {row.position_id} · mass centre x={String(row.x_mm)} mm
                      </span>
                    </p>
                  ))}
                </div>
              )}
              {applied.value.check?.result && (
                <p>
                  Approximate ranges: mass {applied.value.check.result.mass_min_kg.toFixed(3)}–
                  {applied.value.check.result.mass_max_kg.toFixed(3)} kg · centre x=
                  {applied.value.check.result.cg_min_mm.toFixed(3)}…
                  {applied.value.check.result.cg_max_mm.toFixed(3)} mm.
                </p>
              )}
              {applied.value.check && (
                <img
                  className="balance-diagram"
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(applied.value.check.layout_svg)}`}
                  alt="Checked simulated trim locations from the reviewed engineering note"
                />
              )}
              <Questions items={[...applied.value.questions, ...applied.value.validation_errors]} />
              {applied.value.check ? (
                <p>
                  These readings and bounds support this simulation only. Remeasure after a physical
                  adjustment. Retention, durability and tipping safety still need their own checks.
                </p>
              ) : (
                <p>
                  No joint result was calculated. Your known readings are in the current case; add
                  the missing details before checking both targets.
                </p>
              )}
              {applied.value.bound_request && (
                <EngineeringAssistant
                  caseData={caseData}
                  active={active}
                  plan={null}
                  feedback={applied.value.bound_request.feedback}
                  balance={applied.value.bound_request.balance}
                  requiresBalance
                />
              )}
            </>
          )}
          <button type="button" className="text-button" onClick={download}>
            Download this note and check
          </button>
        </div>
      )}
    </details>
  )
}
