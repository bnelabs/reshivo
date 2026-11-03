import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api'
import { confirmRecordedRecipeReview, confirmSavedMixAdjustment, mixAdjustmentKey, mixAdjustmentPrecisionProblem, mixAdjustmentRequest, mixDraftNeedsProjectReview, mixMassCanonical, mixMassEntryState, recordedRecipeDiscussion, recordedRecipeNeedsReview, savedMixAdjustment, savedMixAdjustmentRecord, updateSavedMixAdjustment, useRecordedRecipeTarget } from '../mixAdjustment'
import { describeMixOutcome } from '../mixCandidate'
import { MixAdditionResult } from './MixAdditionResult'
import { prepareMixCalculation } from '../mixQuestion'
import type { PreparedMixCalculation } from '../mixQuestion'
import type { MixAdjustmentDraft } from '../mixAdjustment'
import type { ProjectWorkspace } from '../projectWorkspace'
import type { AdvisorBrief, BalanceMixRequest, BalanceMixResult } from '../types'
import { UnitInput, unitLabel, useUnitSystem } from '../units'
import type { UnitSystem } from '../unitConversion'
import { currentSetups, setupKey } from './TrialWorkspace'
import { selectedCurrentSetup, setupRevisionNotice } from '../setupSelection'
import { safeSetupName } from '../savedGuidanceReview'
import { RecordedRecipeReference } from './RecordedRecipeReference'
import { downloadTextFile, explainUnreachableMix, formatMixSummary, printTextReport } from '../readableSummary'
import { mixInputProblems } from '../mixInputHelp'

function SingleBatchHelp({ onAskForHelp }: { onAskForHelp: () => void }) {
  return <div className="pw-card pw-spaced">
    <h2>Have one batch? Start here</h2>
    <p>Explore how to use your material and what to check first. You do not need to know every material’s percentage to ask.</p>
    <button type="button" className="pw-primary" onClick={onAskForHelp}>Explore my material</button>
    <p className="pw-muted">The calculator below is optional. Use it when you want to explore adding another material and know the shares needed for that calculation.</p>
  </div>
}

/** Arithmetic on user-entered composition, not a material-property model. */
export type MixPlanningContext = {
  brief: AdvisorBrief
  question: string
  history?: { role: string; content: string }[]
  project_context: { configurations: { id: string; revision: number; process: string; geometry: string; materials: { name: string }[] }[] }
}

export function MixAdjustment({ workspace: w, enabled, showHistoricalIdeas, planningContext, onDraftChange, onDiscuss, onSummary, onGoToPlans, onGoToChecks, onAskForHelp, calculatorOpenRequest, restoreCalculations = false }: {
  workspace: ProjectWorkspace
  enabled: boolean
  showHistoricalIdeas: boolean
  planningContext: MixPlanningContext
  onSummary: (summary: string) => void
  onGoToPlans: () => void
  onGoToChecks: () => void
  onAskForHelp: () => void
  calculatorOpenRequest: number
  restoreCalculations?: boolean
  onDraftChange: (update: (current: ProjectWorkspace) => ProjectWorkspace) => void
  onDiscuss?: (question: string, calculation: PreparedMixCalculation) => void
}) {
  const system = useUnitSystem()
  const [calculatorOpen, setCalculatorOpen] = useState(false)
  const lastOpenRequest = useRef(calculatorOpenRequest)
  useEffect(() => {
    if (calculatorOpenRequest !== lastOpenRequest.current) {
      lastOpenRequest.current = calculatorOpenRequest
      setCalculatorOpen(true)
    }
  }, [calculatorOpenRequest])
  const setups = currentSetups(w.configurations)
  const recoveredDraft = restoreCalculations ? [...(w.mix_adjustment_drafts ?? [])].reverse().find((saved) => {
    const current = setups.find((item) => item.id === saved.configuration_id && item.revision === saved.configuration_revision)
    const component = current?.materials.find((item) => item.id === saved.component_id && item.name === saved.component_name)
    return saved.case_id === w.case_id && component && mixAdjustmentRequest(component.name, saved.values)
      && !mixAdjustmentPrecisionProblem(saved.values, saved.values.inputMassOrigin ?? system)
      && !mixDraftNeedsProjectReview(saved, w.project) && !recordedRecipeNeedsReview(w, saved)
  }) : undefined
  const setupName = (item: (typeof setups)[number]) => showHistoricalIdeas ? item.name : safeSetupName(w, item, 'Plan')
  const [selectedSetup, setSelectedSetup] = useState(() => recoveredDraft?.configuration_id ?? setups[0]?.id ?? '')
  const [selectedMaterial, setSelectedMaterial] = useState(() => recoveredDraft?.component_id ?? '')
  const [versionNotice, setVersionNotice] = useState('')
  const previousSetup = useRef<{ id: string; revision: number } | null>(null)
  const [result, setResult] = useState<{ key: string; request: BalanceMixRequest; value: BalanceMixResult } | null>(null)
  const resultCard = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [massEditingSystem, setMassEditingSystem] = useState<UnitSystem | null>(null)
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
  const inputProblems = mixInputProblems(material?.name ?? '', draft, system)
  const fullPortion = [draft.inputMin, draft.inputMax].every((value) => /^100(?:\.0+)?\s*%?$/.test(value.trim()))
  const referenceVersions = savedDraft?.reference ? w.configurations.filter((item) => item.id === savedDraft.reference?.setup_id) : []
  const signature = mixAdjustmentKey(w.case_id, { setup, project: w.project, reference: savedDraft?.reference, referenceVersions }, material?.id ?? '', draft)
  const stockKey = JSON.stringify({ ...planningContext, history: [...(planningContext.history ?? []), { role: 'user', content: `Added stock: ${draft.additionName}` }] })
  const stockReady = enabled && stockMode?.key === stockKey && !stockMode.failed && !stockMode.planningOnly
  const canCalculate = Boolean(stockReady && !needsProjectReview && !needsReferenceReview)
  const visibleResult = canCalculate && result?.key === signature ? result : null
  // Only the first complete, still-current saved draft is recalculated. Later edits
  // invalidate that result and require the normal explicit calculation action.
  const restoreSignature = useRef(restoreCalculations && savedDraft && request ? signature : null)
  const restoreAttempted = useRef(false)
  const massUnit = unitLabel('kg', system)
  const massEntry = mixMassEntryState(draft, system)
  const reportPlanName = setup ? setupName(setup) : ''
  const reportPlanRevision = setup?.revision
  const showRange = (minimum: number | null, maximum: number | null) => minimum === maximum ? String(minimum) : `${minimum}–${maximum}`

  useLayoutEffect(() => {
    onSummary(visibleResult && reportPlanRevision !== undefined ? formatMixSummary(visibleResult.request, visibleResult.value, system, { name: reportPlanName, revision: reportPlanRevision }) : '')
  }, [visibleResult, system, onSummary, reportPlanName, reportPlanRevision])

  useEffect(() => {
    if (result && calculatorOpen && resultCard.current) {
      resultCard.current.scrollIntoView({ block: 'start' })
      resultCard.current.focus({ preventScroll: true })
    }
  }, [result])

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

  function change(field: Exclude<keyof MixAdjustmentDraft, 'inputMassOrigin'>, value: string, massOrigin: UnitSystem = system) {
    if (!setup || !material) return
    const caseId = w.case_id
    const capturedSetup = structuredClone(setup)
    const capturedComponent = { id: material.id, name: material.name }
    const capturedProject = structuredClone(w.project)
    onDraftChange((current) => updateSavedMixAdjustment(current, caseId, capturedSetup, capturedComponent, capturedProject, field, value, massOrigin))
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
  useEffect(() => {
    if (restoreAttempted.current || !restoreSignature.current || restoreSignature.current !== signature || !canCalculate || !request || busy) return
    restoreAttempted.current = true
    void calculate()
  }, [canCalculate, signature, request, busy])
  function discuss() {
    if (!visibleResult || !onDiscuss || !setup || !material) return
    const { request: input, value } = visibleResult
    const binding = prepareMixCalculation(w, setup, material, input)
    if (!binding) { setError('The setup or mix inputs changed. Calculate again before asking about them.'); return }
    const outcome = describeMixOutcome(value, system)
    const source = recordedRecipeDiscussion(w, setup, material, w.project, setupName)
    onDiscuss(`Help me interpret this mix simulation for ${setupName(setup)}, version ${setup.revision}, and suggest the next actions and product checks.\n\nPortion: ${input.input_mass_kg} kg, with ${showRange(input.input_min_percent, input.input_max_percent)} mass percent ${input.component}. Added stock: ${input.addition_name}, with ${input.addition_percent} mass percent ${input.component}. Chosen mix: ${showRange(input.target_min_percent, input.target_max_percent)} mass percent ${input.component}.${source ? `\n\n${source}` : ''}\n\n${outcome} Figures are approximate and assume complete, loss-free mixing.`, binding)
  }

  if (!enabled) return <section className="pw-section"><h1>Adjust a mix</h1><SingleBatchHelp onAskForHelp={onAskForHelp} /><p>Adjustment calculations are unavailable while this case is being checked or needs local planning.</p><button type="button" onClick={onAskForHelp}>Ask for help in Options</button></section>
  if (missingSelected && setups.length > 0) return <section className="pw-section"><h1>Adjust a mix</h1><div className="pw-empty"><h2>Choose a setup</h2><p>Your earlier selection is unavailable in this project.</p><label>Plan<select value="" onChange={(event) => { setSelectedSetup(event.target.value); setSelectedMaterial('') }}><option value="" disabled>Choose a setup</option>{setups.map((item) => <option key={setupKey(item)} value={item.id}>{setupName(item)} · version {item.revision}</option>)}</select></label></div></section>
  if (missingSelectedMaterial && setup && setup.materials.length > 0) return <section className="pw-section"><h1>Adjust a mix</h1><div className="pw-empty"><h2>Choose a component</h2><p>Your earlier component is unavailable in this version of {setupName(setup)}.</p><label>Component you want to track<select value="" onChange={(event) => setSelectedMaterial(event.target.value)}><option value="" disabled>Choose a component</option>{setup.materials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div></section>
  if (!setup || !material) return <section className="pw-section"><h1>Adjust a mix</h1><SingleBatchHelp onAskForHelp={onAskForHelp} /><div className="pw-empty"><h2>{setup ? 'Add a material to this plan' : 'Add a plan first'}</h2>{setup && <label>Plan<select value={setup.id} onChange={(event) => { setSelectedSetup(event.target.value); setSelectedMaterial('') }}>{setups.map((item) => <option key={setupKey(item)} value={item.id}>{setupName(item)} · version {item.revision}</option>)}</select></label>}{versionNotice && <p className="pw-notice" role="status">{versionNotice}</p>}<p>Save a plan with at least one material to explore an adjustment.</p><button type="button" className="pw-primary" onClick={onGoToPlans}>Go to Plans</button></div></section>

  return (
    <section className="pw-section">
      <div className="pw-section-heading"><div><h1>Adjust a mix</h1></div></div>
      <SingleBatchHelp onAskForHelp={onAskForHelp} />
      <details className="pw-card pw-spaced" open={calculatorOpen} onToggle={(event) => setCalculatorOpen(event.currentTarget.open)}>
      <summary><strong>Calculate an addition</strong> <span className="pw-muted">(optional)</span></summary>
      <p>Choose one material or stream and explore how adding a known material changes its share.</p>
      <p className="pw-muted">Enter values you know or want to explore.</p>
      <div className="pw-card">
        <div className="pw-form-grid">
          <label>Plan<select value={setup.id} onChange={(event) => { setSelectedSetup(event.target.value); setSelectedMaterial('') }}>{setups.map((item) => <option key={setupKey(item)} value={item.id}>{setupName(item)} · version {item.revision}</option>)}</select></label>
          <label>Component you want to track<select value={material.id} onChange={(event) => setSelectedMaterial(event.target.value)}>{setup.materials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        {versionNotice && <p className="pw-notice" role="status">{versionNotice}</p>}
        <p>Choose one material or named stream to track. The percentages below describe its share in your portion, the material you could add, and the mix you want to explore.</p>
        <p className="pw-muted">If one plan entry names several materials and you want to track one of them, edit it in Plans and add the materials separately. You can also track a whole named stream when your percentages describe that stream in both mixtures.</p>
        <button type="button" onClick={onAskForHelp}>Ask for help in Options</button>
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
            <label>Mass of this portion ({massEntry.invalid ? massEntry.enteredUnit : unitLabel('kg', massEditingSystem ?? system)})<UnitInput unit="kg" value={massEntry.displayValue} disabled={massEntry.locked} maxLength={160} invalidMessage="" displaySystem={massEditingSystem ?? massEntry.origin ?? system} onFocus={() => setMassEditingSystem(massEntry.origin ?? system)} onBlur={() => setMassEditingSystem(null)} canonicalize={(display, _unit, unitSystem) => mixMassCanonical(display, unitSystem)} onChange={(value) => change('inputMass', value, massEditingSystem ?? massEntry.origin ?? system)} /></label>
          </div>
          {massEntry.invalid && <div className="pw-notice">{massEntry.origin ? <p>Finish editing this value in {massEntry.enteredUnit}.{massEntry.origin !== system && ` It will convert to ${massUnit} when you leave the field.`}</p> : <><p>This saved value has no unit recorded. Choose the unit you originally entered to finish editing it.</p><div className="pw-actions"><button type="button" onClick={() => change('inputMass', massEntry.displayValue, 'metric')}>It was kg</button><button type="button" onClick={() => change('inputMass', massEntry.displayValue, 'us')}>It was lb</button><button type="button" onClick={() => change('inputMass', '')}>Clear value</button></div></>}</div>}
          <p>How much of this portion is {material.name}, by mass? If you know one value, enter it in both boxes.</p>
          {fullPortion && <p className="pw-notice">100% to 100% treats the whole portion as {material.name}. It does not show how materials inside that stream vary.</p>}
          <div className="pw-form-grid">
            <label>Lowest possible amount (mass %)<input type="text" maxLength={160} inputMode="decimal" value={draft.inputMin} onChange={(event) => change('inputMin', event.target.value)} /></label>
            <label>Highest possible amount (mass %)<input type="text" maxLength={160} inputMode="decimal" value={draft.inputMax} onChange={(event) => change('inputMax', event.target.value)} /></label>
          </div>
          <h2>2. Describe the material you could add</h2>
          <div className="pw-form-grid">
            <label>Name of the material you could add<input maxLength={120} value={draft.additionName} onChange={(event) => change('additionName', event.target.value)} placeholder="For example, a characterized recycled plastic" /></label>
            <label>{material.name} in the material you could add (mass %)<input type="text" maxLength={160} inputMode="decimal" value={draft.additionPercent} onChange={(event) => change('additionPercent', event.target.value)} /></label>
          </div>
          <small>Enter zero only when you know the material you could add contains none of the tracked component.</small>
          <h2>3. Choose the composition to explore</h2>
          <p>What range of {material.name} would you like to try, by mass?</p>
          {savedDraft?.reference && <div className="pw-notice">
            <p>{savedDraft.reference.range ? `Rounded plan range: ${savedDraft.reference.range.min}–${savedDraft.reference.range.max}% (source fraction ${savedDraft.reference.range.numerator}/${savedDraft.reference.range.denominator})` : `Plan point: ${savedDraft.reference.fraction}%`} of the whole recipe from {referenceSource ? setupName(referenceSource) : 'recorded setup'} · version {savedDraft.reference.setup_revision} ({savedDraft.reference.component_name}).</p>
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
            <label>Minimum to explore (mass %)<input type="text" maxLength={160} inputMode="decimal" value={draft.targetMin} onChange={(event) => change('targetMin', event.target.value)} /></label>
            <label>Maximum to explore (mass %)<input type="text" maxLength={160} inputMode="decimal" value={draft.targetMax} onChange={(event) => change('targetMax', event.target.value)} /></label>
          </div>
          <div className="pw-actions"><button className="pw-primary" type="submit" aria-describedby={!request && inputProblems.length ? "mix-input-help" : undefined} disabled={!request || !canCalculate || busy}>{busy ? 'Calculating…' : 'Calculate an addition'}</button></div>
          {!request && inputProblems.length > 0 && <div className="pw-notice" id="mix-input-help">
            <strong>To calculate, complete or correct:</strong>
            <ul>{inputProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
            <small>You can include the % sign. If you do not know a value, ask for help in Options.</small>
          </div>}
          {request && !canCalculate && <div className="pw-notice">
            {needsProjectReview && <p>Review the changed project details above.</p>}
            {needsReferenceReview && <p>Review the recorded recipe above.</p>}
            {stockMode?.key !== stockKey && <p>Checking the material you could add…</p>}
            {stockMode?.key === stockKey && stockMode.planningOnly && !stockMode.failed && <p>This material needs planning before this calculation. Ask for help in Options.</p>}
            {stockMode?.key === stockKey && stockMode.failed && <p>The local check could not be completed. Change an entry or reopen the app to retry.</p>}
          </div>}
          {precisionProblem && <p className="pw-error" role="alert">The {precisionProblem} has more precision than the calculator can preserve. Enter a shorter number or a range that accurately represents what you know.</p>}
          <small>Your project saves these entries with this setup. A complete, unchanged calculation is recalculated when you return.</small>
        </form>
        {error && <p className="pw-error" role="alert">{error}</p>}
      </div>
      {visibleResult && <div ref={resultCard} tabIndex={-1} className="pw-card pw-spaced" aria-live="polite">
        <span className="pw-overline">Composition simulation · entered setup and values</span>
        {visibleResult.value.feasible ? <>
          <h2>Amount to explore</h2>
          <MixAdditionResult result={visibleResult.value} system={system} />
        </> : <>
          <h2>No single addition fits the whole range</h2>
          <p>{explainUnreachableMix(visibleResult.request) ?? 'For the material you entered, no fixed addition reaches your chosen composition across the full input range. If the actual fraction of this portion becomes known, enter that value and recalculate. You can also explore a different material or composition range.'}</p>
        </>}
        <p>Choose what to measure for this plan.</p>
        <button type="button" onClick={onGoToChecks}>Set up product checks</button>
        <button type="button" onClick={() => downloadTextFile('reshivo-mix-result.txt', formatMixSummary(visibleResult.request, visibleResult.value, system))}>Download result as text</button>
        <button type="button" onClick={() => { try { printTextReport(formatMixSummary(visibleResult.request, visibleResult.value, system, { name: setupName(setup), revision: setup.revision })) } catch (e) { setError((e as Error).message) } }}>Print / Save as PDF</button>
        {onDiscuss && <button onClick={discuss}>Ask about this result</button>}
      </div>}
      </details>
    </section>
  )
}
