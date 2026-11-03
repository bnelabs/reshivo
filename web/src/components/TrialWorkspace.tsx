import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useUnitSystem } from '../units'
import { TrialAssessmentNotices } from './TrialAssessmentNotices'
import { materialUnitLabel, planMaterialUnitChange, resolveMaterialUnitChange } from '../materialUnitChange'
import type { PendingMaterialUnitChange } from '../materialUnitChange'
import {
  checkHasPendingDraft,
  checkHasReadings,
  validateCheckDraft,
  validateReadingDraft,
  validateMaterialAmount,
} from '../checkEditing'
import type {
  ProjectWorkspace,
  TrialConfiguration,
  ProductCheck,
  TrialRecord,
  TrialIdea,
} from '../projectWorkspace'

const uid = () => crypto.randomUUID()
export const currentSetups = (items: TrialConfiguration[]) =>
  items.filter(
    (item) => !items.some((other) => other.id === item.id && other.revision > item.revision),
  )
export const setupKey = (item: TrialConfiguration) => `${item.id}@${item.revision}`
const STATE: Record<string, string> = {
  all_entered_checks_in_range: 'Required active readings in range',
  out_of_range: 'Outside a target',
  missing_records: 'Checks still missing',
  needs_review: 'Review needed',
  target_not_set: 'Target not set',
  no_required_checks: 'No required checks',
  in_range: 'Entered readings in range',
  entered_readings_in_range: 'Entered readings in range',
  not_required: 'Optional',
  missing: 'Not checked',
}
const textState = (state: string) => STATE[state] ?? state.replaceAll('_', ' ')

type Props = {
  workspace: ProjectWorkspace
  onChange: (next: ProjectWorkspace) => void
  section: 'trials' | 'checks'
  readingKind: 'synthetic' | 'user_reported'
  onReadingKindChange: (kind: 'synthetic' | 'user_reported') => void
  onAskIdea: (configuration: TrialConfiguration, idea: TrialIdea) => void
  showHistoricalIdeas: boolean
  checkingPlanningMode: boolean
  preparedCheckName: string
  onPreparedCheckUsed: () => void
}
export function TrialWorkspace({
  workspace: w,
  onChange,
  section,
  readingKind: kind,
  onReadingKindChange,
  onAskIdea,
  showHistoricalIdeas,
  checkingPlanningMode,
  preparedCheckName,
  onPreparedCheckUsed,
}: Props) {
  const system = useUnitSystem()
  const [editing, setEditing] = useState<TrialConfiguration | null>(null)
  const [pendingUnit, setPendingUnit] = useState<PendingMaterialUnitChange | null>(null)
  const [check, setCheck] = useState<ProductCheck>({
    id: uid(),
    name: '',
    unit: '',
    method: '',
    minimum: null,
    maximum: null,
    required: true,
  })
  const [selected, setSelected] = useState('')
  const [selectedCheck, setSelectedCheck] = useState('')
  const [readingDrafts, setReadingDrafts] = useState<
    Record<string, { readings: TrialRecord['readings']; confirmed: boolean }>
  >({})
  const checkForDraft = w.checks.find((item) => item.id === selectedCheck)
  const readingContext = JSON.stringify([
    selected,
    selectedCheck,
    kind,
    checkForDraft?.name,
    checkForDraft?.unit,
    checkForDraft?.method,
  ])
  const { readings, confirmed } = readingDrafts[readingContext] ?? {
    readings: [{ value: '' }],
    confirmed: false,
  }
  function setReadings(next: TrialRecord['readings']) {
    setReadingDrafts((all) => ({ ...all, [readingContext]: { readings: next, confirmed: false } }))
  }
  function setConfirmed(next: boolean) {
    setReadingDrafts((all) => ({
      ...all,
      [readingContext]: { readings: all[readingContext]?.readings ?? readings, confirmed: next },
    }))
  }
  const [assessment, setAssessment] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorScope, setErrorScope] = useState<
    'setup' | 'new-check' | 'edit-check' | 'readings' | 'assess'
  >('assess')
  function reportError(scope: typeof errorScope, message: string) {
    setErrorScope(scope)
    setError(message)
  }
  const [exclusionReasons, setExclusionReasons] = useState<Record<string, string>>({})
  const [checkDrafts, setCheckDrafts] = useState<Record<string, ProductCheck>>({})
  const [editingCheckId, setEditingCheckId] = useState('')
  const checkEditorRef = useRef<HTMLElement | null>(null)
  const readingSectionRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (editingCheckId) checkEditorRef.current?.focus()
  }, [editingCheckId])
  const [assessedInput, setAssessedInput] = useState('')
  const setups = currentSetups(w.configurations)
  const hasLinkedIdea = (configuration: TrialConfiguration) =>
    Boolean(
      w.trial_ideas?.[setupKey(configuration)] ||
      configuration.notes.startsWith('Unverified trial idea:'),
    )
  const hideCopiedName = (configuration: TrialConfiguration) =>
    !showHistoricalIdeas &&
    (w.trial_ideas?.[setupKey(configuration)]?.title === configuration.name ||
      configuration.notes.startsWith(`Unverified trial idea: ${configuration.name}.`))
  const displaySetupName = (configuration: TrialConfiguration) =>
    hideCopiedName(configuration)
      ? `Trial setup ${setups.findIndex((s) => s.id === configuration.id) + 1}`
      : configuration.name
  const inputKey = JSON.stringify({
    configurations: w.configurations,
    checks: w.checks,
    records: w.records,
    record_exclusions: w.record_exclusions,
    kind,
  })
  const fresh = assessedInput === inputKey
  const selectedSetup = setups.find((c) => setupKey(c) === selected)
  const property = w.checks.find((c) => c.id === selectedCheck)
  const originalEditCheck = w.checks.find((c) => c.id === editingCheckId)
  const editCheck = originalEditCheck
    ? (checkDrafts[editingCheckId] ?? originalEditCheck)
    : undefined
  const editHasReadings = editCheck ? checkHasReadings(editCheck.id, w.records) : false
  function start(source?: TrialConfiguration) {
    setError('')
    setPendingUnit(null)
    setEditing(
      source
        ? structuredClone(source)
        : {
            id: uid(),
            revision: 1,
            name: `Setup ${setups.length + 1}`,
            materials: [
              {
                id: uid(),
                name:
                  (w.project.input?.value.length ?? 0) <= 160
                    ? (w.project.input?.value ?? '')
                    : 'Project materials (see project description)',
                amount: '',
                unit: system === 'us' ? 'lb' : 'kg',
              },
            ],
            process: w.project.process?.value ?? '',
            geometry: '',
            notes:
              (w.project.input?.value.length ?? 0) > 160
                ? 'This line represents your project description. Add the ingredients and amounts when known.'
                : '',
          },
    )
  }
  function saveSetup() {
    if (pendingUnit) {
      reportError('setup', 'Choose what to do with the material amount before saving.')
      return
    }
    if (w.configurations.length >= 100) {
      reportError(
        'setup',
        'This project already has 100 setup versions. Save it, then start a new project to record more.',
      )
      return
    }
    if (!editing?.name.trim() || !editing.materials.some((m) => m.name.trim())) {
      reportError('setup', 'Name the setup and at least one material. Amounts may stay unknown.')
      return
    }
    if (editing.materials.some((m) => !m.name.trim())) {
      reportError('setup', 'Name each material, or remove the unused row.')
      return
    }
    for (const material of editing.materials) {
      const problem = validateMaterialAmount(material.amount, material.unit)
      if (problem) {
        reportError('setup', `${material.name}: ${problem}`)
        return
      }
    }
    const previous = w.configurations.filter((c) => c.id === editing.id)
    const next = {
      ...editing,
      revision: previous.length ? Math.max(...previous.map((c) => c.revision)) + 1 : 1,
    }
    const inheritedIdea = w.trial_ideas?.[setupKey(editing)]
    onChange({
      ...w,
      configurations: [...w.configurations, next],
      ...(inheritedIdea
        ? { trial_ideas: { ...w.trial_ideas, [setupKey(next)]: structuredClone(inheritedIdea) } }
        : {}),
    })
    setEditing(null)
    setSelected(setupKey(next))
    setError('')
  }
  function addCheck() {
    const problem = validateCheckDraft(check)
    if (problem) {
      reportError('new-check', problem)
      return
    }
    if (w.checks.length >= 50) {
      reportError('new-check', 'This project can contain at most 50 checks.')
      return
    }
    onChange({ ...w, checks: [...w.checks, check] })
    setSelectedCheck(check.id)
    setCheck({
      id: uid(),
      name: '',
      unit: '',
      method: '',
      minimum: null,
      maximum: null,
      required: true,
    })
    setError('')
  }
  function saveEditedCheck() {
    if (!editCheck || !originalEditCheck) return
    const problem = validateCheckDraft(editCheck, originalEditCheck, w.records)
    if (problem) {
      reportError('edit-check', problem)
      return
    }
    onChange({
      ...w,
      checks: w.checks.map((item) => (item.id === editCheck.id ? editCheck : item)),
    })
    setCheckDrafts((all) => {
      const next = { ...all }
      delete next[editCheck.id]
      return next
    })
    setEditingCheckId('')
    setError('')
  }
  function removeEmptyCheck() {
    if (!editCheck || checkHasReadings(editCheck.id, w.records)) {
      reportError(
        'edit-check',
        'This check has saved readings. Make it optional to keep the readings in history.',
      )
      return
    }
    if (checkHasPendingDraft(editCheck.id, readingDrafts)) {
      reportError(
        'edit-check',
        'This check has an unfinished reading. Clear the draft or save it before removing the check.',
      )
      return
    }
    onChange({ ...w, checks: w.checks.filter((item) => item.id !== editCheck.id) })
    if (selectedCheck === editCheck.id) setSelectedCheck('')
    setCheckDrafts((all) => {
      const next = { ...all }
      delete next[editCheck.id]
      return next
    })
    setEditingCheckId('')
    setError('')
  }
  function saveReadings() {
    if (!selectedSetup || !property) {
      reportError('readings', 'Choose a setup and check before saving readings.')
      return
    }
    const problem = validateReadingDraft(readings)
    if (problem) {
      reportError('readings', problem)
      return
    }
    if (
      w.records.length >= 1000 ||
      w.records.reduce((sum, record) => sum + record.readings.length, 0) + readings.length > 10000
    ) {
      reportError(
        'readings',
        'This project has reached its record or reading limit. Save it before starting another project.',
      )
      return
    }
    const record: TrialRecord = {
      id: uid(),
      case_id: w.case_id,
      configuration_id: selectedSetup.id,
      configuration_revision: selectedSetup.revision,
      check_id: property.id,
      unit: property.unit,
      method: property.method,
      data_kind: kind,
      conditions_confirmed: confirmed,
      readings,
    }
    onChange({ ...w, records: [...w.records, record] })
    setReadings([{ value: '' }])
    setConfirmed(false)
    setError('')
  }
  async function assess() {
    setBusy(true)
    setError('')
    try {
      const result = await api<any>('/api/project/trial-records', {
        case_id: w.case_id,
        configurations: w.configurations,
        checks: w.checks,
        records: w.records.filter((r) => !w.record_exclusions?.[r.id]),
        assessment_kind: kind,
      })
      setAssessment(result)
      setAssessedInput(inputKey)
    } catch (e) {
      reportError('assess', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="pw-section">
      <div className="pw-section-heading">
        <div>
          <h1>
            {section === 'trials'
              ? 'Keep each trial setup together'
              : 'Check what matters to your product'}
          </h1>
          <p>
            {section === 'trials'
              ? 'Record the whole recipe, process and shape. Changing any of them creates a new version.'
              : 'Keep every product requirement visible.'}
          </p>
        </div>
        {section === 'trials' && (
          <button className="pw-primary" onClick={() => start()}>
            Add a trial setup
          </button>
        )}
      </div>
      {section === 'trials' && (
        <>
          {!setups.length && !editing && (
            <div className="pw-empty">
              <h2>Your first trial starts here</h2>
              <p>
                Use an option as a starting point, then record the materials and process you
                actually plan to compare. Unknown amounts can stay blank.
              </p>
              <button onClick={() => start()}>Record a setup</button>
            </div>
          )}
          <div className="pw-card-grid">
            {setups.map((c) => (
              <article className="pw-card" key={setupKey(c)}>
                <span className="pw-overline">Version {c.revision} · proposal / entered setup</span>
                <h2>{displaySetupName(c)}</h2>
                <ul>
                  {c.materials.map((m) => (
                    <li key={m.id}>
                      {m.name} · {m.amount || 'amount unknown'} {m.amount ? m.unit : ''}
                    </li>
                  ))}
                </ul>
                <p>
                  <strong>Process</strong>
                  <br />
                  {c.process || 'Not recorded'}
                </p>
                <p>
                  <strong>Shape and size</strong>
                  <br />
                  {c.geometry || 'Not recorded'}
                </p>
                {c.notes && (showHistoricalIdeas || !hasLinkedIdea(c)) && <p>{c.notes}</p>}
                {!showHistoricalIdeas && hasLinkedIdea(c) && (
                  <p>
                    {checkingPlanningMode ? 'Checking saved ideas.' : 'This saved idea is unavailable for reuse.'}
                  </p>
                )}
                {showHistoricalIdeas &&
                  w.trial_ideas?.[setupKey(c)] &&
                  (() => {
                    const idea = w.trial_ideas![setupKey(c)]
                    return (
                      <details>
                        <summary>Saved idea to review: {idea.title}</summary>
                        <p className="pw-muted">Idea from {idea.provider} / {idea.model} · review against your setup</p>
                        <p>
                          <strong>Proposed change:</strong> {idea.change}
                        </p>
                        <p>{idea.why}</p>
                        <ol>
                          {idea.steps.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                        <p>
                          <strong>Trade-offs:</strong> {idea.tradeoffs.join(' ')}
                        </p>
                        <p>
                          <strong>Next check:</strong> {idea.check}
                        </p>
                        <button
                          onClick={() => onAskIdea(structuredClone(c), structuredClone(idea))}
                        >
                          Ask about this idea
                        </button>
                        <small>
                          You can review the idea before sending it to the selected AI provider.
                        </small>
                      </details>
                    )
                  })()}
                <button onClick={() => start(c)}>Change this setup</button>
                <small>Previous readings stay with version {c.revision}.</small>
              </article>
            ))}
          </div>
          {editing && (
            <section className="pw-card pw-editor">
              <h2>
                {w.configurations.some((c) => c.id === editing.id)
                  ? 'Create the next version'
                  : 'New trial setup'}
              </h2>
              {error && errorScope === 'setup' && (
                <p className="pw-error" role="alert">
                  {error}
                </p>
              )}
              <label>
                Setup name
                <input
                  value={hideCopiedName(editing) ? '' : editing.name}
                  placeholder={
                    hideCopiedName(editing)
                      ? 'Saved name unavailable in this planning mode'
                      : undefined
                  }
                  maxLength={120}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </label>
              <h3>Materials in this setup</h3>
              <p className="pw-muted">
                Include the binder and any named contaminant. Leave an amount blank if unknown.
              </p>
              {editing.materials.map((m, i) => (
                <div className="pw-material-row" key={m.id}>
                  <label>
                    Material
                    <input
                      value={m.name}
                      maxLength={160}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          materials: editing.materials.map((r, j) =>
                            j === i ? { ...r, name: e.target.value } : r,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Amount
                    <input
                      value={m.amount}
                      inputMode="decimal"
                      maxLength={160}
                      onChange={(e) => {
                        if (pendingUnit?.id === m.id) setPendingUnit(null)
                        setEditing({
                          ...editing,
                          materials: editing.materials.map((r, j) =>
                            j === i ? { ...r, amount: e.target.value } : r,
                          ),
                        })
                      }}
                    />
                  </label>
                  <label>
                    Unit
                    <select
                      value={m.unit}
                      disabled={Boolean(pendingUnit && pendingUnit.id !== m.id)}
                      onChange={(e) => {
                        const nextUnit = e.target.value
                        const choice = planMaterialUnitChange(m, nextUnit)
                        if (choice) setPendingUnit(choice)
                        else {
                          setPendingUnit(null)
                          setEditing({ ...editing, materials: editing.materials.map((r, j) => j === i ? { ...r, unit: nextUnit } : r) })
                        }
                      }}
                    >
                      {['kg', 'g', 'lb', 'oz', 't', 'mass_percent', 'volume_percent'].map((u) => (
                        <option key={u} value={u}>
                          {u === 'mass_percent'
                            ? 'mass %'
                            : u === 'volume_percent'
                              ? 'volume %'
                              : u}
                        </option>
                      ))}
                    </select>
                  </label>
                  {editing.materials.length > 1 && (
                    <button
                      aria-label={`Remove material ${i + 1}`}
                      onClick={() =>
                        {
                          if (pendingUnit?.id === m.id) setPendingUnit(null)
                          setEditing({
                            ...editing,
                            materials: editing.materials.filter((_, j) => i !== j),
                          })
                        }
                      }
                    >
                      Remove
                    </button>
                  )}
                  {pendingUnit?.id === m.id && (
                    <div className="pw-notice" style={{ gridColumn: '1 / -1' }} role="group" aria-label={`Choose how to change units for ${m.name || 'this material'}`}>
                      <p>This amount is {pendingUnit.amount} {materialUnitLabel(pendingUnit.from)}. How should it change to {materialUnitLabel(pendingUnit.to)}?</p>
                      {pendingUnit.exactAmount === null && <small>An exact conversion is unavailable for this change.</small>}
                      {pendingUnit.exactAmount !== null && <button type="button" onClick={() => {
                        const updated = resolveMaterialUnitChange(m, pendingUnit, 'convert')
                        if (updated) setEditing({ ...editing, materials: editing.materials.map((r) => r.id === m.id ? updated : r) })
                        setPendingUnit(null)
                      }}>Convert to {pendingUnit.exactAmount} {materialUnitLabel(pendingUnit.to)}</button>}
                      <button type="button" onClick={() => {
                        const updated = resolveMaterialUnitChange(m, pendingUnit, 'keep')
                        if (updated) setEditing({ ...editing, materials: editing.materials.map((r) => r.id === m.id ? updated : r) })
                        setPendingUnit(null)
                      }}>Keep {pendingUnit.amount} and use {materialUnitLabel(pendingUnit.to)}</button>
                      <button type="button" onClick={() => {
                        const updated = resolveMaterialUnitChange(m, pendingUnit, 'clear')
                        if (updated) setEditing({ ...editing, materials: editing.materials.map((r) => r.id === m.id ? updated : r) })
                        setPendingUnit(null)
                      }}>Clear amount and use {materialUnitLabel(pendingUnit.to)}</button>
                      <button type="button" onClick={() => setPendingUnit(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              ))}
              <button
                onClick={() =>
                  setEditing({
                    ...editing,
                    materials: [
                      ...editing.materials,
                      { id: uid(), name: '', amount: '', unit: system === 'us' ? 'lb' : 'kg' },
                    ],
                  })
                }
                disabled={editing.materials.length >= 20}
              >
                Add material
              </button>
              <div className="pw-form-grid">
                <label>
                  Process
                  <textarea
                    value={editing.process}
                    maxLength={2000}
                    onChange={(e) => setEditing({ ...editing, process: e.target.value })}
                    placeholder="Preparation, mixing, forming, curing; known settings and equipment"
                  />
                </label>
                <label>
                  Shape, size and installation
                  <textarea
                    value={editing.geometry}
                    maxLength={1500}
                    onChange={(e) => setEditing({ ...editing, geometry: e.target.value })}
                    placeholder="Include dimensions with units. For sound, include how it is installed."
                  />
                </label>
              </div>
              <label>
                Notes and unknowns
                <textarea
                  value={!showHistoricalIdeas && hasLinkedIdea(editing) ? '' : editing.notes}
                  disabled={!showHistoricalIdeas && hasLinkedIdea(editing)}
                  placeholder={
                    !showHistoricalIdeas && hasLinkedIdea(editing)
                      ? 'Saved notes unavailable in this planning mode'
                      : undefined
                  }
                  maxLength={1500}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                />
              </label>
              <div className="pw-actions">
                <button className="pw-primary" onClick={saveSetup} disabled={Boolean(pendingUnit)}>
                  Save this setup
                </button>
                <button onClick={() => { setPendingUnit(null); setEditing(null) }}>Cancel edit</button>
              </div>
            </section>
          )}
          {w.configurations.length > setups.length && (
            <details>
              <summary>Earlier setup versions ({w.configurations.length - setups.length})</summary>
              {w.configurations
                .filter((c) => !setups.includes(c))
                .map((c) => (
                  <p key={setupKey(c)}>
                    {displaySetupName(c)} · version {c.revision} ·{' '}
                    {c.materials.map((m) => `${m.name} ${m.amount} ${m.unit}`).join('; ')} ·{' '}
                    {c.process} · {c.geometry}
                  </p>
                ))}
            </details>
          )}
        </>
      )}
      {section === 'checks' && (
        <>
          <div className="pw-notice">
            {kind === 'synthetic' ? 'Simulated readings' : 'Your entered readings'} · current setups and test conditions
          </div>
          <label className="pw-inline-label">
            Show readings from
            <select
              value={kind}
              onChange={(e) => onReadingKindChange(e.target.value as typeof kind)}
            >
              <option value="user_reported">My entered measurements</option>
              <option value="synthetic">A software simulation</option>
            </select>
          </label>
          <div className="pw-table-scroll">
            <table>
              <caption>Current setups and all product checks</caption>
              <thead>
                <tr>
                  <th>Trial setup</th>
                  {w.checks.map((c) => (
                    <th key={c.id}>
                      {c.name}
                      <small>
                        {c.minimum !== null && c.maximum !== null
                          ? `${c.minimum}–${c.maximum}`
                          : c.minimum !== null
                            ? `At least ${c.minimum}`
                            : c.maximum !== null
                              ? `At most ${c.maximum}`
                              : 'Target not set'}{' '}
                        {c.unit}
                        {c.required ? ' · required' : ' · optional'}
                      </small>
                      <button
                        onClick={() => {
                          setEditingCheckId(c.id)
                          setError('')
                        }}
                      >
                        Edit {c.name}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {setups.map((c) => (
                  <tr key={setupKey(c)}>
                    <th>
                      {displaySetupName(c)}
                      <small>Version {c.revision}</small>
                    </th>
                    {w.checks.map((check) => {
                      const result = fresh
                        ? assessment?.configurations
                            ?.find((r: any) => r.id === c.id && r.revision === c.revision)
                            ?.checks?.find((r: any) => r.check_id === check.id)
                        : null
                      const count = w.records
                        .filter(
                          (r) =>
                            r.configuration_id === c.id &&
                            r.configuration_revision === c.revision &&
                            r.check_id === check.id &&
                            r.data_kind === kind &&
                            !w.record_exclusions?.[r.id],
                        )
                        .reduce((n, r) => n + r.readings.length, 0)
                      return (
                        <td key={check.id}>
                          {result ? (
                            <span className="pw-status" data-state={result.state}>
                              {textState(result.state)}
                            </span>
                          ) : count ? (
                            `${count} entered · check pending`
                          ) : (
                            'Not checked'
                          )}
                          {result?.reading_count > 0 && (
                            <small>
                              {result.minimum_entered === result.maximum_entered
                                ? result.minimum_entered
                                : `${result.minimum_entered}–${result.maximum_entered}`}{' '}
                              {check.unit} · {result.reading_count} reading(s)
                            </small>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(!setups.length || !w.checks.length) && (
            <p>
              Add a trial setup and the checks that matter to it. Limits can stay blank.
            </p>
          )}
          <button
            className="pw-primary"
            onClick={assess}
            disabled={busy || !setups.length || !w.checks.length}
          >
            {busy ? 'Checking…' : 'Check entered readings'}
          </button>
          {error && errorScope === 'assess' && (
            <p className="pw-error" role="alert">
              {error}
            </p>
          )}
          {assessment && fresh && (
            <div className="pw-card pw-results" aria-live="polite">
              {assessment.configurations?.map((c: any) => (
                <p key={c.id}>
                  <strong>
                    {setups.find((s) => s.id === c.id)
                      ? displaySetupName(setups.find((s) => s.id === c.id)!)
                      : 'Trial setup'}
                    :{' '}
                  </strong>
                  {textState(c.state)}
                </p>
              ))}
              <TrialAssessmentNotices
                assessment={assessment}
                setups={setups}
                checks={w.checks}
                kind={kind}
                setupName={displaySetupName}
                onAddReading={(setup, check) => {
                  setSelected(setupKey(setup))
                  setSelectedCheck(check.id)
                  setError('')
                  readingSectionRef.current?.focus()
                }}
              />
              {assessment.ignored_records?.length > 0 && (
                <p>
                  {assessment.ignored_records.length} earlier-version or other-kind record(s)
                  retained separately.
                </p>
              )}
            </div>
          )}
          {editCheck && (
            <section
              ref={checkEditorRef}
              tabIndex={-1}
              className="pw-card pw-spaced"
              aria-label="Edit product check"
            >
              <h2>Edit {originalEditCheck?.name}</h2>
              {error && errorScope === 'edit-check' && (
                <p className="pw-error" role="alert">
                  {error}
                </p>
              )}
              <p>
                {editHasReadings
                  ? 'Saved readings keep their original property, unit and method. To change those, add a new check. You can update the target or make this check optional.'
                  : 'No readings are linked yet. You can change the property, method and target, or remove this check.'}
              </p>
              {(['name', 'unit', 'method'] as const).map((field) => (
                <label key={field}>
                  {field === 'name'
                    ? 'What are you checking?'
                    : field === 'unit'
                      ? 'Unit'
                      : 'Method and conditions'}
                  {field === 'method' ? (
                    <textarea
                      disabled={editHasReadings}
                      maxLength={2000}
                      value={editCheck[field]}
                      onChange={(e) =>
                        setCheckDrafts({
                          ...checkDrafts,
                          [editCheck.id]: { ...editCheck, [field]: e.target.value },
                        })
                      }
                    />
                  ) : (
                    <input
                      disabled={editHasReadings}
                      maxLength={160}
                      value={editCheck[field]}
                      onChange={(e) =>
                        setCheckDrafts({
                          ...checkDrafts,
                          [editCheck.id]: { ...editCheck, [field]: e.target.value },
                        })
                      }
                    />
                  )}
                </label>
              ))}
              <div className="pw-form-grid">
                <label>
                  Minimum, if set
                  <input
                    inputMode="decimal"
                    maxLength={160}
                    value={editCheck.minimum ?? ''}
                    onChange={(e) =>
                      setCheckDrafts({
                        ...checkDrafts,
                        [editCheck.id]: { ...editCheck, minimum: e.target.value || null },
                      })
                    }
                  />
                </label>
                <label>
                  Maximum, if set
                  <input
                    inputMode="decimal"
                    maxLength={160}
                    value={editCheck.maximum ?? ''}
                    onChange={(e) =>
                      setCheckDrafts({
                        ...checkDrafts,
                        [editCheck.id]: { ...editCheck, maximum: e.target.value || null },
                      })
                    }
                  />
                </label>
              </div>
              <label className="pw-checkbox">
                <input
                  type="checkbox"
                  checked={editCheck.required}
                  onChange={(e) =>
                    setCheckDrafts({
                      ...checkDrafts,
                      [editCheck.id]: { ...editCheck, required: e.target.checked },
                    })
                  }
                />
                Required for this product
              </label>
              {editHasReadings && (
                <p>
                  To retire this check, first correct or clear invalid limits, then make it
                  optional. Its readings remain visible.
                </p>
              )}
              <div className="pw-actions">
                <button className="pw-primary" onClick={saveEditedCheck}>
                  Save check changes
                </button>
                {!editHasReadings && (
                  <button onClick={removeEmptyCheck}>Remove check without readings</button>
                )}
                <button
                  onClick={() => {
                    setEditingCheckId('')
                    setError('')
                  }}
                >
                  Close editor
                </button>
              </div>
              <small>
                Closing keeps your unsaved edit in this tab. Your separate new-check draft stays
                intact.
              </small>
            </section>
          )}
          <div className="pw-card-grid pw-spaced">
            <section className="pw-card">
              <h2>Add a product check</h2>
              {preparedCheckName && (
                <div className="pw-notice">
                  <p>Your proposed check name: <strong>{preparedCheckName}</strong></p>
                  <p>Choose a method, unit and any limits yourself. Nothing has been saved yet.</p>
                  <button type="button" disabled={Boolean(check.name || check.unit || check.method || check.minimum || check.maximum)} onClick={() => { setCheck({ ...check, name: preparedCheckName }); onPreparedCheckUsed() }}>Use this name in the empty draft</button>
                  {(check.name || check.unit || check.method || check.minimum || check.maximum) && <small>Finish or clear your current draft before using this name.</small>}
                </div>
              )}
              {error && errorScope === 'new-check' && (
                <p className="pw-error" role="alert">
                  {error}
                </p>
              )}
              <p>Need help choosing a measurement? Ask in Options.</p>
              <label>
                What are you checking?
                <input
                  value={check.name}
                  maxLength={160}
                  onChange={(e) => setCheck({ ...check, name: e.target.value })}
                  placeholder="e.g. wet grip, sound absorption, mass"
                />
              </label>
              <label>
                Unit
                <input
                  value={check.unit}
                  maxLength={80}
                  onChange={(e) => setCheck({ ...check, unit: e.target.value })}
                  placeholder="Use the unit in the measurement"
                />
              </label>
              <label>
                Method and conditions
                <textarea
                  value={check.method}
                  maxLength={2000}
                  onChange={(e) => setCheck({ ...check, method: e.target.value })}
                  placeholder="What was measured, how, and under which conditions? For sound: frequencies and installation."
                />
              </label>
              <div className="pw-form-grid">
                <label>
                  Minimum, if set
                  <input
                    inputMode="decimal"
                    maxLength={160}
                    value={check.minimum ?? ''}
                    onChange={(e) => setCheck({ ...check, minimum: e.target.value || null })}
                  />
                </label>
                <label>
                  Maximum, if set
                  <input
                    inputMode="decimal"
                    maxLength={160}
                    value={check.maximum ?? ''}
                    onChange={(e) => setCheck({ ...check, maximum: e.target.value || null })}
                  />
                </label>
              </div>
              <label className="pw-checkbox">
                <input
                  type="checkbox"
                  checked={check.required}
                  onChange={(e) => setCheck({ ...check, required: e.target.checked })}
                />
                Required for this product
              </label>
              <button onClick={addCheck}>Save check</button>
            </section>
            <section ref={readingSectionRef} tabIndex={-1} aria-label="Add readings" className="pw-card">
              <h2>Add readings</h2>
              {error && errorScope === 'readings' && (
                <p className="pw-error" role="alert">
                  {error}
                </p>
              )}
              <label>
                Trial setup
                <select
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value)
                    setConfirmed(false)
                  }}
                >
                  <option value="">Choose a saved setup</option>
                  {setups.map((c) => (
                    <option key={setupKey(c)} value={setupKey(c)}>
                      {displaySetupName(c)} · version {c.revision}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Product check
                <select
                  value={selectedCheck}
                  onChange={(e) => {
                    setSelectedCheck(e.target.value)
                    setConfirmed(false)
                  }}
                >
                  <option value="">Choose a check</option>
                  {w.checks.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.unit})
                    </option>
                  ))}
                </select>
              </label>
              {property && (
                <p>
                  <strong>Method:</strong> {property.method}
                </p>
              )}
              {readings.map((r, i) => (
                <div className="pw-reading" key={i}>
                  <label>
                    Reading {i + 1}
                    {property ? ` (${property.unit})` : ''}
                    <input
                      value={r.value}
                      inputMode="decimal"
                      maxLength={160}
                      onChange={(e) =>
                        setReadings(
                          readings.map((v, j) => (j === i ? { ...v, value: e.target.value } : v)),
                        )
                      }
                    />
                  </label>
                  <details>
                    <summary>Specimen, run or batch IDs (if known)</summary>
                    <p>
                      Leave unknown grouping blank; label batches only when you can identify them.
                    </p>
                    {(
                      ['reading_id', 'specimen_id', 'run_id', 'batch_id', 'repeat_of'] as const
                    ).map((k) => (
                      <label key={k}>
                        {k.replaceAll('_', ' ')}
                        <input
                          value={r[k] ?? ''}
                          maxLength={120}
                          onChange={(e) =>
                            setReadings(
                              readings.map((v, j) =>
                                j === i ? { ...v, [k]: e.target.value || undefined } : v,
                              ),
                            )
                          }
                        />
                      </label>
                    ))}
                  </details>
                  {readings.length > 1 && (
                    <button onClick={() => setReadings(readings.filter((_, j) => j !== i))}>
                      Remove reading
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => setReadings([...readings, { value: '' }])}
                disabled={readings.length >= 100}
              >
                Add another reading
              </button>
              <label className="pw-checkbox">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                These readings use this setup version, unit, method and conditions.
              </label>
              <button className="pw-primary" onClick={saveReadings}>
                Save readings
              </button>
            </section>
          </div>
          {w.records.length > 0 && (
            <details className="pw-spaced">
              <summary>Recorded readings ({w.records.length} records)</summary>
              {w.records.map((r) => (
                <article className="pw-record" key={r.id}>
                  <p>
                    <strong>
                      {((configuration) =>
                        configuration ? displaySetupName(configuration) : 'Trial setup')(
                        w.configurations.find(
                          (c) =>
                            c.id === r.configuration_id && c.revision === r.configuration_revision,
                        ),
                      )}
                    </strong>{' '}
                    · version {r.configuration_revision} ·{' '}
                    {w.checks.find((c) => c.id === r.check_id)?.name} ·{' '}
                    {r.data_kind === 'synthetic' ? 'simulation' : 'user-entered'}
                  </p>
                  <p>
                    {r.readings.map((v) => v.value).join(', ')} {r.unit}
                  </p>
                  {w.record_exclusions?.[r.id] ? (
                    <>
                      <p className="pw-notice">Excluded from checks: {w.record_exclusions[r.id]}</p>
                      <button
                        onClick={() => {
                          const exclusions = { ...w.record_exclusions }
                          delete exclusions[r.id]
                          onChange({
                            ...w,
                            record_exclusions: exclusions,
                            records: w.records.map((x) =>
                              x.id === r.id ? { ...x, conditions_confirmed: false } : x,
                            ),
                          })
                        }}
                      >
                        Reinclude for review
                      </button>
                    </>
                  ) : (
                    <details>
                      <summary>Correct an entry</summary>
                      <p>
                        Keep this original record, exclude it from checks, and add a corrected
                        record. Do not exclude a real low result just to make a setup look better.
                      </p>
                      <label>
                        Why should this record be excluded?
                        <input
                          maxLength={500}
                          value={exclusionReasons[r.id] ?? ''}
                          onChange={(e) =>
                            setExclusionReasons({ ...exclusionReasons, [r.id]: e.target.value })
                          }
                        />
                      </label>
                      <button
                        disabled={!exclusionReasons[r.id]?.trim()}
                        onClick={() =>
                          onChange({
                            ...w,
                            record_exclusions: {
                              ...w.record_exclusions,
                              [r.id]: exclusionReasons[r.id].trim(),
                            },
                          })
                        }
                      >
                        Exclude this record; keep its history
                      </button>
                    </details>
                  )}
                  <details>
                    <summary>Setup, method and grouping</summary>
                    <p>{r.method}</p>
                    <p>
                      {w.configurations.find(
                        (c) =>
                          c.id === r.configuration_id && c.revision === r.configuration_revision,
                      )?.process || 'Process not recorded'}
                    </p>
                    <p>
                      {w.configurations.find(
                        (c) =>
                          c.id === r.configuration_id && c.revision === r.configuration_revision,
                      )?.geometry || 'Shape / installation not recorded'}
                    </p>
                    {r.readings.map((v, i) => (
                      <p key={i}>
                        Reading {i + 1}: {v.value} {r.unit} · specimen {v.specimen_id || 'unknown'}{' '}
                        · run {v.run_id || 'unknown'} · batch {v.batch_id || 'unknown'}
                        {v.repeat_of ? ` · repeat of ${v.repeat_of}` : ''}
                      </p>
                    ))}
                  </details>
                  {!r.conditions_confirmed && !w.record_exclusions?.[r.id] && (
                    <label className="pw-checkbox">
                      <input
                        type="checkbox"
                        onChange={() =>
                          onChange({
                            ...w,
                            records: w.records.map((x) =>
                              x.id === r.id ? { ...x, conditions_confirmed: true } : x,
                            ),
                          })
                        }
                      />
                      I reviewed this record’s setup, unit, method and conditions.
                    </label>
                  )}
                </article>
              ))}
            </details>
          )}
        </>
      )}
    </div>
  )
}
