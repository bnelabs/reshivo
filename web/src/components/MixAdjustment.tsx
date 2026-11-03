import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { confirmRecordedRecipeReview, confirmSavedMixAdjustment, formatMixMass, mixAdditionKind, mixAdjustmentKey, mixAdjustmentPrecisionProblem, mixAdjustmentRequest, mixDraftNeedsProjectReview, mixMassCanonical, mixMassEntryState, recordedRecipeDiscussion, recordedRecipeNeedsReview, savedMixAdjustment, savedMixAdjustmentRecord, updateSavedMixAdjustment, useRecordedRecipeTarget } from '../mixAdjustment'
import type { MixAdjustmentDraft } from '../mixAdjustment'
import type { ProjectWorkspace } from '../projectWorkspace'
import type { AdvisorBrief, BalanceMixRequest, BalanceMixResult } from '../types'
import { UnitInput, unitLabel, useUnitSystem } from '../units'
import { currentSetups, setupKey } from './TrialWorkspace'
import { selectedCurrentSetup, setupRevisionNotice } from '../setupSelection'
import { safeSetupName } from '../savedGuidanceReview'
import { RecordedRecipeReference } from './RecordedRecipeReference'

/** Arithmetic on user-entered composition, not a material-property model. */
export type MixPlanningContext = {
  brief: AdvisorBrief
  question: string
  history?: { role: string; content: string }[]
  project_context: { configurations: { id: string; revision: number; process: string; geometry: string; materials: { name: string }[] }[] }
}

export function MixAdjustment({ workspace: w, enabled, showHistoricalIdeas, planningContext, onDraftChange, onDiscuss }: {
  workspace: ProjectWorkspace
  enabled: boolean
  showHistoricalIdeas: boolean
  planningContext: MixPlanningContext
  onDraftChange: (update: (current: ProjectWorkspace) => ProjectWorkspace) => void
  onDiscuss?: (question: string) => void
}) {
  const system = useUnitSystem()
  const setups = currentSetups(w.configurations)
  const setupName = (item: (typeof setups)[number]) => showHistoricalIdeas ? item.name : safeSetupName(w, item, 'Trial setup')
  const [selectedSetup, setSelectedSetup] = useState(() => setups[0]?.id ?? '')
  const [selectedMaterial, setSelectedMaterial] = useState('')
  const [versionNotice, setVersionNotice] = useState('')
  const previousSetup = useRef<{ id: string; revision: number } | null>(null)
  const [result, setResult] = useState<{ key: string; request: BalanceMixRequest; value: BalanceMixResult } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [stockMode, setStockMode] = useState<{ key: string; planningOnly: boolean; failed: boolean } | null>(null)
  const pending = useRef<AbortController | null>(null)
  const setup = selectedCurrentSetup(setups, selectedSetup)
  const missingSelected = Boolean(selectedSetup && !setups.some((item) => item.id === selectedSetup))
  const material = selectedMaterial ? setup?.materials.find((item) => item.id === selectedMaterial) : setup?.materials[0]
  const missingSelectedMaterial = Boolean(selectedMaterial && setup && !setup.materials.some((item) => item.id === selectedMaterial))
  const savedDraft = savedMixAdjustmentRecord(w, setup, material)
  const draft = savedMixAdjustment(w, setup, material)
  const needsProjectReview = mixDraftNeedsProjectReview(savedDraft, w.project)
  const needsReferenceReview = recordedRecipeNeedsReview(w, savedDraft)
  const referenceSource = w.configurations.find((item) => item.id === savedDraft?.reference?.setup_id && item.revision === savedDraft?.reference?.setup_revision)
  const referenceLatest = w.configurations.filter((item) => item.id === savedDraft?.reference?.setup_id).reduce<typeof referenceSource>((latest, item) => !latest || item.revision > latest.revision ? item : latest, undefined)
  const request = material ? mixAdjustmentRequest(material.name, draft) : null
  const precisionProblem = mixAdjustmentPrecisionProblem(draft, draft.inputMassOrigin ?? system)
  const referenceVersions = savedDraft?.reference ? w.configurations.filter((item) => item.id === savedDraft.reference?.setup_id) : []
  const signature = mixAdjustmentKey(w.case_id, { setup, project: w.project, reference: savedDraft?.reference, referenceVersions }, material?.id ?? '', draft)
  const stockKey = JSON.stringify({ ...planningContext, history: [...(planningContext.history ?? []), { role: 'user', content: `Added stock: ${draft.additionName}` }] })
  const stockReady = enabled && stockMode?.key === stockKey && !stockMode.failed && !stockMode.planningOnly
  const canCalculate = Boolean(stockReady && !needsProjectReview && !needsReferenceReview)
  const visibleResult = canCalculate && result?.key === signature ? result : null
  const massUnit = unitLabel('kg', system)
  const massEntry = mixMassEntryState(draft, system)
  const showMass = (value: number) => formatMixMass(value, system)
  const showRange = (minimum: number | null, maximum: number | null) => minimum === maximum ? String(minimum) : `${minimum}–${maximum}`

  useEffect(() => {
    if (!selectedSetup && setup) setSelectedSetup(setup.id)
    setVersionNotice(setupRevisionNotice(previousSetup.current, setup))
    previousSetup.current = setup ? { id: setup.id, revision: setup.revision } : null
  }, [selectedSetup, setup?.id, setup?.revision])
  useEffect(() => {
    if (!selectedMaterial && material) setSelectedMaterial(material.id)
  }, [selectedMaterial, material?.id])

  useEffect(() => {
    pending.current?.abort()
    pending.current = null
    setBusy(false)
    setError('')
    return () => { pending.current?.abort(); pending.current = null }
  }, [signature, enabled])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void api<{ planning_only: boolean }>('/api/project/planning-mode', JSON.parse(stockKey), controller.signal)
        .then((value) => {
          if (typeof value.planning_only !== 'boolean') throw new Error('Invalid local planning check')
          if (!controller.signal.aborted) setStockMode({ key: stockKey, planningOnly: value.planning_only, failed: false })
        })
        .catch(() => { if (!controller.signal.aborted) setStockMode({ key: stockKey, planningOnly: true, failed: true }) })
    }, 200)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [stockKey, enabled])

  function change(field: Exclude<keyof MixAdjustmentDraft, 'inputMassOrigin'>, value: string) {
    if (!setup || !material) return
    const caseId = w.case_id
    const capturedSetup = structuredClone(setup)
    const capturedComponent = { id: material.id, name: material.name }
    const capturedProject = structuredClone(w.project)
    onDraftChange((current) => updateSavedMixAdjustment(current, caseId, capturedSetup, capturedComponent, capturedProject, field, value, system))
  }
  function confirmProjectReview() {
    if (!setup || !material || !needsProjectReview) return
    const caseId = w.case_id
    const capturedSetup = structuredClone(setup)
    const capturedComponent = { id: material.id, name: material.name }
    const capturedProject = structuredClone(w.project)
    onDraftChange((current) => confirmSavedMixAdjustment(current, caseId, capturedSetup, capturedComponent, capturedProject))
  }
  function confirmReferenceReview() {
    if (!setup || !material || !needsReferenceReview || !referenceLatest) return
    const caseId = w.case_id
    const capturedSetup = structuredClone(setup)
    const capturedComponent = { id: material.id, name: material.name }
    const capturedProject = structuredClone(w.project)
    const capturedLatest = referenceLatest.revision
    onDraftChange((current) => confirmRecordedRecipeReview(current, caseId, capturedSetup, capturedComponent, capturedProject, capturedLatest))
  }
  async function calculate() {
    if (!canCalculate || !request || busy) return
    const controller = new AbortController()
    pending.current?.abort()
    pending.current = controller
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const value = await api<BalanceMixResult>('/api/advisor/balance-mix', request, controller.signal)
      if (!controller.signal.aborted) setResult({ key: signature, request, value })
    } catch (failure) {
      if (!controller.signal.aborted) setError((failure as Error).message)
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false) }
    }
  }
  function discuss() {
    if (!visibleResult || !onDiscuss || !setup) return
    const { request: input, value } = visibleResult
    const outcome = value.feasible
      ? `Estimated addition: ${value.addition_min_kg === 0 ? 'none needed' : value.addition_min_kg === value.addition_max_kg ? `approximately ${value.addition_min_kg} kg` : `approximately ${value.addition_min_kg} kg to ${value.addition_max_kg === null ? 'an unbounded maximum' : `${value.addition_max_kg} kg`}`}. Example: approximately ${value.example_addition_kg} kg gives approximately ${showRange(value.resulting_min_percent, value.resulting_max_percent)} mass percent ${input.component}.`
      : 'No single addition fits the whole entered range.'
    const source = material ? recordedRecipeDiscussion(w, setup, material, w.project, setupName) : ''
    onDiscuss(`Help me interpret this mix simulation for ${setupName(setup)}, version ${setup.revision} (ID ${setup.id}), and suggest the next actions and product checks.\n\nPortion: ${input.input_mass_kg} kg, with ${showRange(input.input_min_percent, input.input_max_percent)} mass percent ${input.component}. Added stock: ${input.addition_name}, with ${input.addition_percent} mass percent ${input.component}. Chosen mix: ${showRange(input.target_min_percent, input.target_max_percent)} mass percent ${input.component}.${source ? `\n\n${source}` : ''}\n\n${outcome} Figures are approximate and assume complete, loss-free mixing.`)
  }

  if (!enabled) return <section className="pw-section"><h1>Adjust a mix</h1><p>Adjustment calculations are unavailable while this case is being checked or needs local planning. See Options for guidance.</p></section>
  if (missingSelected && setups.length > 0) return <section className="pw-section"><h1>Adjust a mix</h1><div className="pw-empty"><h2>Choose a setup</h2><p>Your earlier selection is unavailable in this project.</p><label>Trial setup<select value="" onChange={(event) => { setSelectedSetup(event.target.value); setSelectedMaterial('') }}><option value="" disabled>Choose a setup</option>{setups.map((item) => <option key={setupKey(item)} value={item.id}>{setupName(item)} · version {item.revision}</option>)}</select></label></div></section>
  if (missingSelectedMaterial && setup && setup.materials.length > 0) return <section className="pw-section"><h1>Adjust a mix</h1><div className="pw-empty"><h2>Choose a component</h2><p>Your earlier component is unavailable in this version of {setupName(setup)}.</p><label>Component you want to track<select value="" onChange={(event) => setSelectedMaterial(event.target.value)}><option value="" disabled>Choose a component</option>{setup.materials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div></section>
  if (!setup || !material) return <section className="pw-section"><h1>Adjust a mix</h1><div className="pw-empty"><h2>{setup ? 'Add a material to this setup' : 'Add a setup first'}</h2>{setup && <label>Trial setup<select value={setup.id} onChange={(event) => { setSelectedSetup(event.target.value); setSelectedMaterial('') }}>{setups.map((item) => <option key={setupKey(item)} value={item.id}>{setupName(item)} · version {item.revision}</option>)}</select></label>}{versionNotice && <p className="pw-notice" role="status">{versionNotice}</p>}<p>Your saved materials will be available here. Enter a material in Trials, then return to calculate an adjustment.</p></div></section>

  return (
    <section className="pw-section">
      <div className="pw-section-heading"><div><h1>Adjust a mix</h1><p>When the amount of one component changes, explore how much of a known stock could bring it back to a composition you choose.</p></div></div>
      <p className="pw-muted">Enter values you know or want to explore.</p>
      <div className="pw-card">
        <div className="pw-form-grid">
          <label>Trial setup<select value={setup.id} onChange={(event) => { setSelectedSetup(event.target.value); setSelectedMaterial('') }}>{setups.map((item) => <option key={setupKey(item)} value={item.id}>{setupName(item)} · version {item.revision}</option>)}</select></label>
          <label>Component you want to track<select value={material.id} onChange={(event) => setSelectedMaterial(event.target.value)}>{setup.materials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        {versionNotice && <p className="pw-notice" role="status">{versionNotice}</p>}
        <p className="pw-muted">The material names come from your setup; enter the fraction for this portion below.</p>
        {needsProjectReview && savedDraft && <div className="pw-notice">
          <h2>Review these inputs for the changed project</h2>
          <p>Project details have changed since these numbers were entered. Compare the earlier and current details and check the numbers below before using them again.</p>
          <div className="pw-form-grid">
            <div><strong>When these inputs were entered</strong>{(['product', 'input', 'variation', 'use', 'priorities', 'process', 'constraints'] as const).map((field) => <p key={field}><strong>{field === 'use' ? 'Use' : field === 'priorities' ? 'What matters' : field === 'constraints' ? 'Constraints' : field === 'input' ? 'Materials' : field === 'variation' ? 'What changes' : field === 'process' ? 'Process' : 'Product'}:</strong> {savedDraft.project_snapshot[field]?.value ?? 'Not entered'}</p>)}</div>
            <div><strong>Current project</strong>{(['product', 'input', 'variation', 'use', 'priorities', 'process', 'constraints'] as const).map((field) => <p key={field}><strong>{field === 'use' ? 'Use' : field === 'priorities' ? 'What matters' : field === 'constraints' ? 'Constraints' : field === 'input' ? 'Materials' : field === 'variation' ? 'What changes' : field === 'process' ? 'Process' : 'Product'}:</strong> {w.project[field]?.value ?? 'Not entered'}</p>)}</div>
          </div>
          <button type="button" onClick={confirmProjectReview}>I reviewed these inputs for the current project</button>
        </div>}
        <form onSubmit={(event) => { event.preventDefault(); void calculate() }}>
          <h2>1. Describe the portion you have</h2>
          <div className="pw-form-grid">
            <label>Mass of this portion ({massEntry.enteredUnit})<UnitInput unit="kg" value={massEntry.displayValue} disabled={massEntry.locked} maxLength={160} invalidMessage="" canonicalize={(display, _unit, unitSystem) => mixMassCanonical(display, unitSystem)} onChange={(value) => change('inputMass', value)} /></label>
          </div>
          {massEntry.invalid && <p className="pw-notice">{massEntry.origin ? `This unfinished value was entered in ${massEntry.enteredUnit}. ${massEntry.locked ? `Switch back to ${massEntry.enteredUnit} to correct it, or clear it and re-enter it in ${massUnit}.` : 'Correct it before calculating.'}` : `This older unfinished value has no recorded unit. Clear it and re-enter it in ${massUnit} before calculating; its original unit cannot be inferred.`} {massEntry.locked && <button type="button" onClick={() => change('inputMass', '')}>Clear and re-enter in {massUnit}</button>}</p>}
          <p>How much of this portion is {material.name}, by mass? If you know one value, enter it in both boxes.</p>
          <div className="pw-form-grid">
            <label>Lowest possible amount (mass %)<input type="text" maxLength={160} inputMode="decimal" value={draft.inputMin} onChange={(event) => change('inputMin', event.target.value)} /></label>
            <label>Highest possible amount (mass %)<input type="text" maxLength={160} inputMode="decimal" value={draft.inputMax} onChange={(event) => change('inputMax', event.target.value)} /></label>
          </div>
          <h2>2. Describe the stock you could add</h2>
          <div className="pw-form-grid">
            <label>Name of the added stock<input maxLength={120} value={draft.additionName} onChange={(event) => change('additionName', event.target.value)} placeholder="For example, a characterized recycled plastic" /></label>
            <label>{material.name} in that stock (mass %)<input type="text" maxLength={160} inputMode="decimal" value={draft.additionPercent} onChange={(event) => change('additionPercent', event.target.value)} /></label>
          </div>
          <small>Enter zero only when you know the added stock contains none of the tracked component.</small>
          <h2>3. Choose the composition to explore</h2>
          <p>What range of {material.name} would you like to try, by mass?</p>
          {savedDraft?.reference && <div className="pw-notice">
            <p>{savedDraft.reference.range ? `Rounded trial range: ${savedDraft.reference.range.min}–${savedDraft.reference.range.max}% (source fraction ${savedDraft.reference.range.numerator}/${savedDraft.reference.range.denominator})` : `Trial point: ${savedDraft.reference.fraction}%`} of the whole recipe from {referenceSource ? setupName(referenceSource) : 'recorded setup'} · version {savedDraft.reference.setup_revision} ({savedDraft.reference.component_name}).</p>
            {needsReferenceReview && <><p>A newer version of this reference setup exists. Compare the recipes before continuing.</p>
              <div className="pw-form-grid">{[referenceSource, referenceLatest].filter((item): item is NonNullable<typeof item> => Boolean(item)).map((item) => <div key={JSON.stringify([item.id, item.revision])}><strong>{setupName(item)} · version {item.revision}</strong><ul>{item.materials.map((ingredient) => <li key={ingredient.id}>{ingredient.name}: {ingredient.amount || 'unknown'} {ingredient.unit}</li>)}</ul><p>Process: {item.process || 'not entered'}</p><p>Shape: {item.geometry || 'not entered'}</p></div>)}</div>
              <button type="button" disabled={needsProjectReview} onClick={confirmReferenceReview}>Keep using this earlier recipe point</button></>}
          </div>}
          <RecordedRecipeReference key={JSON.stringify([setup.id, setup.revision, material.id])} workspace={w} destination={setup} component={material} setupName={setupName} targetOccupied={Boolean(draft.targetMin.trim() || draft.targetMax.trim())} appliedReference={savedDraft?.reference} disabled={needsProjectReview || needsReferenceReview} onUse={(source, sourceComponent, latestRevision) => {
            const caseId = w.case_id
            const capturedSetup = structuredClone(setup)
            const capturedComponent = { id: material.id, name: material.name }
            const capturedProject = structuredClone(w.project)
            const capturedSource = structuredClone(source)
            const capturedSourceComponent = { id: sourceComponent.id, name: sourceComponent.name }
            onDraftChange((current) => useRecordedRecipeTarget(current, caseId, capturedSetup, capturedComponent, capturedProject, capturedSource, capturedSourceComponent, latestRevision))
          }} />
          <div className="pw-form-grid">
            <label>Trial minimum (mass %)<input type="text" maxLength={160} inputMode="decimal" value={draft.targetMin} onChange={(event) => change('targetMin', event.target.value)} /></label>
            <label>Trial maximum (mass %)<input type="text" maxLength={160} inputMode="decimal" value={draft.targetMax} onChange={(event) => change('targetMax', event.target.value)} /></label>
          </div>
          <div className="pw-actions"><button className="pw-primary" type="submit" disabled={!request || !canCalculate || busy}>{busy ? 'Calculating…' : 'Calculate an addition'}</button></div>
          {!request && <small>Enter a positive portion mass, both ends of each range, and the added stock and its fraction. Percentages must be between zero and one hundred.</small>}
          {precisionProblem && <p className="pw-error" role="alert">The {precisionProblem} has more precision than the calculator can preserve. Enter a shorter number or a range that accurately represents what you know.</p>}
          <small>Your project file saves these entries with this setup version. It does not save the calculation result.</small>
          {stockMode?.key === stockKey && stockMode.planningOnly && !stockMode.failed && <p className="pw-notice">This added stock needs local planning first. Identify the material and its handling conditions before using the adjustment calculator.</p>}
          {stockMode?.key === stockKey && stockMode.failed && <p className="pw-error" role="alert">The local check could not be completed. Your entries remain here; reopen the app or change an entry to retry.</p>}
        </form>
        {error && <p className="pw-error" role="alert">{error}</p>}
      </div>
      {visibleResult && <div className="pw-card pw-spaced" aria-live="polite">
        <span className="pw-overline">Composition simulation · entered setup and values</span>
        {visibleResult.value.feasible ? <>
          <h2>{visibleResult.value.addition_min_kg === 0 ? 'No addition needed for this composition' : 'An estimated addition to explore'}</h2>
          {visibleResult.value.addition_min_kg === 0 ? <p>Based on the entered values, no addition is needed to reach your chosen composition for the stated input range. {mixAdditionKind(visibleResult.value.addition_min_kg, visibleResult.value.addition_max_kg) === 'zero_only' ? 'The calculation does not allow a positive addition within this target.' : visibleResult.value.addition_max_kg === null ? 'Other additions are optional; this composition check sets no finite upper limit.' : <>Optional positive additions are estimated up to <strong>{showMass(visibleResult.value.addition_max_kg!)}</strong> in this composition check.</>}</p> : mixAdditionKind(visibleResult.value.addition_min_kg!, visibleResult.value.addition_max_kg) === 'one_amount' ? <p>For the entered portion and stock, the estimated addition is <strong>{showMass(visibleResult.value.addition_min_kg!)}</strong>.</p> : <p>For the entered portion and stock, the estimated minimum addition is <strong>{showMass(visibleResult.value.addition_min_kg!)}</strong>{visibleResult.value.addition_max_kg === null ? ' and this composition check gives no finite upper limit.' : <> and the estimated maximum is <strong>{showMass(visibleResult.value.addition_max_kg)}</strong>.</>}</p>}
          <p>{visibleResult.value.example_addition_kg === 0 ? 'With no addition, the estimated composition is' : <>For example, <strong>{showMass(visibleResult.value.example_addition_kg!)}</strong> of {visibleResult.request.addition_name} gives an estimated</>} {showRange(visibleResult.value.resulting_min_percent, visibleResult.value.resulting_max_percent)} mass % {visibleResult.request.component}, with even mixing and no losses.</p>
          <small>Displayed amounts are rounded.</small>
        </> : <>
          <h2>No single addition fits the whole range</h2>
          <p>For the entered stock, no fixed addition reaches your chosen composition across the full input range. If the actual fraction of this portion becomes known, enter that value and recalculate. You can also explore a different characterized stock or trial range.</p>
        </>}
        {onDiscuss && <button onClick={discuss}>Ask about this result</button>}
      </div>}
    </section>
  )
}
