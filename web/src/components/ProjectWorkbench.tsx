import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { version as appVersion } from '../../package.json'
import { api } from '../api'
import { PromptProjectStart } from './PromptProjectStart'
import { ProviderSettings } from './ProviderSettings'
import { ConceptSketch } from './ConceptSketch'
import { sketchFingerprint } from '../sketchContext'
import type { RectangularSection } from '../sectionDrawing'
import { reportResultContext, type ReportResultKind } from '../reportResults'
import { decisionResults } from '../decisionOverview'
import { createProjectAutosave } from '../projectAutosave'
import { CheckedMixAdvice } from './CheckedMixAdvice'
import { SoundGuidance } from './SoundGuidance'
import { buildIdeaComparisonQuestion } from '../ideaComparison'
import { isSoundProject } from '../soundGuidance'
import { MixAdjustment } from './MixAdjustment'
import { CheckSuggestionHandoff } from './CheckSuggestionHandoff'
import { TrialWorkspace, currentSetups } from './TrialWorkspace'
import { CostWorkspace } from './CostWorkspace'
import { emptyProjectDraft, hasProjectContext, PROJECT_INTAKE_FIELDS, reviewProjectDraft } from '../projectIntake'
import type { ProjectIntakeDraft, ProjectIntakeField, ProjectIntakeResult } from '../projectIntake'
import {
  newProjectWorkspace,
  parseProjectWorkspace,
  downloadProjectWorkspace,
  PROJECT_WORKSPACE_MAX_BYTES,
} from '../projectWorkspace'
import type { ProjectWorkspace, TrialConfiguration, TrialIdea, ProjectAdviceNote } from '../projectWorkspace'
import type { AdvisorResult, AdvisorFollowupResult, AdvisorRoute, LocalPlanningResult } from '../types'
import { useUnitSettings } from '../units'
import { costRequest } from '../manufacturingCost'
import { canReattachMixCalculation, mixQuestionFingerprint, mixQuestionIsCurrent } from '../mixQuestion'
import type { PreparedMixCalculation } from '../mixQuestion'
import { briefFrom } from '../projectBrief'
import { savedGuidanceTexts, safeSetupName } from '../savedGuidanceReview'
import { downloadTextFile, formatAdviceForReport, formatEarlierAdviceForReport, formatPrintableProjectReport, formatProjectNotes, formatProjectSummary, printTextReport } from '../readableSummary'
import './ProjectWorkbench.css'

const LegacyWorkshop = lazy(() => import('./Workshop').then((m) => ({ default: m.Workshop })))
const AUTOSAVE_DISABLED_KEY = 'reshivo:project-autosave:disabled'
const FIELD_LABEL: Record<ProjectIntakeField, string> = {
  product: 'What do you want to make?',
  input: 'What materials do you have?',
  use: 'Where and how will it be used?',
  priorities: 'What should it do well?',
  variation: 'What changes in your input?',
  process: 'What tools and processes can you use?',
  constraints: 'Other limits or unknowns',
}
function usableAdvice(value: unknown): value is AdvisorResult | AdvisorFollowupResult | LocalPlanningResult {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  const strings = (input: unknown) => Array.isArray(input) && input.every((part) => typeof part === 'string')
  const routeList = (input: unknown) => Array.isArray(input) && input.every((route) => {
    if (!route || typeof route !== 'object') return false
    const r = route as Record<string, unknown>
    return ['id', 'title', 'change', 'why', 'check'].every((key) => typeof r[key] === 'string') && strings(r.steps) && strings(r.tradeoffs)
  })
  if (!['engineering_proposals', 'engineering_followup', 'local_planning_guidance'].includes(String(item.result_kind))
    || typeof item.answer !== 'string' || !item.answer.trim() || typeof item.provider !== 'string' || typeof item.model !== 'string'
    || !strings(item.next_steps) || !strings(item.questions)) return false
  if (item.result_kind === 'engineering_proposals' && (!routeList(item.material_routes) || !routeList(item.engineering_routes))) return false
  if (item.mix_calculation !== undefined && item.mix_calculation !== null) {
    const mix = item.mix_calculation as Record<string, unknown>
    if (typeof mix !== 'object' || !mix.result || typeof mix.result !== 'object' || !mix.inputs || typeof mix.inputs !== 'object'
      || typeof (mix.result as Record<string, unknown>).feasible !== 'boolean' || typeof (mix.inputs as Record<string, unknown>).addition_name !== 'string') return false
  }
  return true
}

function intakeHistory(notes?: string) {
  if (!notes?.trim()) return []
  const characters = Array.from(notes)
  const messages: { role: 'user'; content: string }[] = []
  for (let start = 0; start < characters.length; start += 5000) {
    messages.push({ role: 'user', content: `Earlier setup details; current project fields take precedence:\n${characters.slice(start, start + 5000).join('')}` })
  }
  return messages
}

function CurrentCalculations({ results, earlierAnswer, onOpen }: {
  results: ReturnType<typeof decisionResults>
  earlierAnswer: boolean
  onOpen: (page: 'adjust' | 'costs' | 'checks') => void
}) {
  if (!results.mix && !results.cost && !results.checks) return null
  return <section className="pw-decision-results" aria-label="Your current calculations">
    <h2>Your current calculations</h2>
    <p>{earlierAnswer ? 'These results use your current entries. The earlier answer may not include them.' : 'Each result stays with the plan shown below.'}</p>
    <div className="pw-decision-result-grid">
      {results.mix && <article><h3>Mix</h3>{results.mix.summary.map((line, index) => <p key={index}>{line}</p>)}<details><summary>Calculation details</summary><p className="pw-result-details">{results.mix.detail}</p></details><button type="button" onClick={() => onOpen('adjust')}>Open mix</button></article>}
      {results.cost && <article><h3>Cost</h3>{results.cost.summary.map((line, index) => <p key={index}>{line}</p>)}<details><summary>Cost details</summary><p className="pw-result-details">{results.cost.detail}</p></details><button type="button" onClick={() => onOpen('costs')}>Open costs</button></article>}
      {results.checks && <article><h3>Checks</h3>{results.checks.summary.map((line, index) => <p key={index}>{line}</p>)}<details><summary>Check details</summary><p className="pw-result-details">{results.checks.detail}</p></details><button type="button" onClick={() => onOpen('checks')}>Open checks</button></article>}
    </div>
  </section>
}

export function ProjectWorkbench() {
  const { system, setSystem } = useUnitSettings()
  const [autosave] = useState(() => {
    try { return createProjectAutosave(window.localStorage, window.sessionStorage) }
    catch { return null }
  })
  const [autosaveEnabled, setAutosaveEnabled] = useState(() => {
    try { return Boolean(autosave) && window.sessionStorage.getItem(AUTOSAVE_DISABLED_KEY) !== '1' }
    catch { return false }
  })
  const [autosaveError, setAutosaveError] = useState(autosave ? '' : 'Local saving is unavailable. Save a backup to keep your work.')
  const [w, setW] = useState<ProjectWorkspace>(() => autosaveEnabled ? autosave?.recovered?.workspace ?? newProjectWorkspace() : newProjectWorkspace())
  const [restoreCalculations, setRestoreCalculations] = useState(Boolean(autosaveEnabled && autosave?.recovered))
  const [page, setPage] = useState<
    'start' | 'manual' | 'options' | 'trials' | 'adjust' | 'checks' | 'costs' | 'legacy'
  >(() => autosaveEnabled && autosave?.recovered && hasProjectContext(autosave.recovered.workspace.project) ? 'options' : 'start')
  const [calculatorOpenRequest, setCalculatorOpenRequest] = useState(0)
  const [providerOpen, setProviderOpen] = useState(false)
  const [status, setStatus] = useState({
    configured: false,
    provider: '',
    provider_name: 'AI provider',
    model: '',
  })
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [sketch, setSketch] = useState<{ fingerprint: string; image: string } | null>(null)
  const [section, setSection] = useState<{ fingerprint: string; section: RectangularSection } | null>(null)
  const [reportResults, setReportResults] = useState<Partial<Record<ReportResultKind, { text: string; context: string }>>>({})
  const [mixSummary, setMixSummary] = useState('')
  const [notice, setNotice] = useState(autosaveEnabled && autosave?.recovered ? 'Your project was restored from this browser.' : '')
  const [manual, setManual] = useState<ProjectIntakeDraft>(emptyProjectDraft)
  const [advice, setAdvice] = useState<AdvisorResult | AdvisorFollowupResult | LocalPlanningResult | null>(null)
  const [showWorkspaceTools, setShowWorkspaceTools] = useState(false)
  const adviceResult = useRef<HTMLElement>(null)
  const questionDetails = useRef<HTMLDetailsElement>(null)
  const routeDetails = useRef<HTMLElement>(null)
  const [comparisonOrigin, setComparisonOrigin] = useState<{ context: string; advice: AdvisorResult; noteId: string | null } | null>(null)
  const [showAnswerFollowup, setShowAnswerFollowup] = useState(false)
  useEffect(() => {
    setShowAnswerFollowup(false)
  }, [advice])
  const pendingAdviceFocus = useRef<{ result: AdvisorResult | AdvisorFollowupResult | LocalPlanningResult; question: string } | null>(null)
  const currentPage = useRef(page)
  currentPage.current = page
  const [startingGuidance, setStartingGuidance] = useState<ProjectIntakeResult | null>(null)
  const [adviceCase, setAdviceCase] = useState('')
  const [adviceProject, setAdviceProject] = useState('')
  const [adviceQuestion, setAdviceQuestion] = useState('')
  const [adviceNoteId, setAdviceNoteId] = useState<string | null>(null)
  const [adviceKind, setAdviceKind] = useState<'user_reported' | 'synthetic'>('user_reported')
  const [selectedIdea, setSelectedIdea] = useState<{
    caseId: string
    key: string
    idea: TrialIdea
  } | null>(null)
  const [preparedCheckName, setPreparedCheckName] = useState('')
  const [preparedCheckSuggestion, setPreparedCheckSuggestion] = useState<{ caseId: string; key: string; text: string } | null>(null)
  const [workspaceOpenEpoch, setWorkspaceOpenEpoch] = useState(0)
  const [mixQuestionContext, setMixQuestionContext] = useState<string | null>(null)
  const [preparedMix, setPreparedMix] = useState<PreparedMixCalculation | null>(null)
  const [recentMixContext, setRecentMixContext] = useState<string | null>(null)
  const [previousQuestion, setPreviousQuestion] = useState('')
  const [lastAdviceUsedIdea, setLastAdviceUsedIdea] = useState(false)
  const [question, setQuestion] = useState('')
  const [focusHelpQuestion, setFocusHelpQuestion] = useState(false)
  const helpQuestion = useRef<HTMLTextAreaElement>(null)
  const optionsHeading = useRef<HTMLHeadingElement>(null)
  const pendingOptionsHeadingFocus = useRef(false)
  const pendingPlanFocus = useRef('')
  const pendingPlanRecheck = useRef<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [inlineError, setInlineError] = useState('')
  const workbench = useRef<HTMLDivElement>(null)
  const [planningMode, setPlanningMode] = useState<{ key: string; planningOnly: boolean; failed: boolean } | null>(null)
  const [savedGuidanceReview, setSavedGuidanceReview] = useState<{ key: string; needsReview: boolean; failed: boolean } | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const request = useRef<AbortController | null>(null)
  const currentProject = JSON.stringify(w.project)
  const currentAdviceContext = JSON.stringify({
    project: w.project,
    intake_notes: w.intake_notes,
    configurations: w.configurations,
    checks: w.checks,
    records: w.records,
    record_exclusions: w.record_exclusions,
    costs: w.costs,
    trial_ideas: w.trial_ideas,
    mix_adjustment_drafts: w.mix_adjustment_drafts,
    adviceKind,
  })
  const currentMixQuestionContext = mixQuestionFingerprint(w, workspaceOpenEpoch)
  const recentMixIsCurrent = canReattachMixCalculation(preparedMix, recentMixContext, currentMixQuestionContext)
  const planningPayload = {
    brief: briefFrom(w.project),
    question,
    ...((w.intake_notes?.trim() || (advice && adviceCase === currentAdviceContext && adviceQuestion)) ? { history: [
      ...intakeHistory(w.intake_notes),
      ...(advice && adviceCase === currentAdviceContext && adviceQuestion ? [{ role: 'user', content: adviceQuestion }] : []),
    ] } : {}),
    project_context: { configurations: currentSetups(w.configurations).map((c) => ({
      id: c.id, revision: c.revision, process: c.process, geometry: c.geometry,
      materials: c.materials.map((m) => ({ name: m.name })),
    })) },
  }
  const planningKey = JSON.stringify(planningPayload)
  const modeReady = planningMode?.key === planningKey && !planningMode.failed
  const savedTexts = savedGuidanceTexts(w)
  const savedReviewKey = JSON.stringify({ texts: savedTexts })
  const savedReviewReady = savedTexts.length === 0 || (savedGuidanceReview?.key === savedReviewKey && !savedGuidanceReview.failed)
  const savedNeedsReview = savedTexts.length > 0 && savedGuidanceReview?.key === savedReviewKey && savedGuidanceReview.needsReview
  const showCurrentGuidance = Boolean(modeReady && !planningMode?.planningOnly)
  const showHistoricalIdeas = Boolean(showCurrentGuidance && savedReviewReady && !savedNeedsReview)
  const visibleSavedNotes = (w.advice_notes ?? []).filter((note) => modeReady && savedReviewReady && !savedNeedsReview && (showHistoricalIdeas || note.kind === 'local_guidance'))
  useEffect(() => {
    const focusHeading = pendingOptionsHeadingFocus.current
    pendingOptionsHeadingFocus.current = false
    const planKey = pendingPlanFocus.current
    pendingPlanFocus.current = ''
    if (page === 'trials' && planKey) {
      const target = Array.from(workbench.current?.querySelectorAll<HTMLElement>('[data-plan-key]') ?? []).find((item) => item.dataset.planKey === planKey)
      if (target) {
        target.scrollIntoView({ block: 'start' })
        target.focus({ preventScroll: true })
        pendingPlanRecheck.current = target
        return
      }
    }
    if (focusHeading && page === 'options' && optionsHeading.current) {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      optionsHeading.current.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
      optionsHeading.current.focus({ preventScroll: true })
    } else {
      window.scrollTo({ top: 0 })
    }
  }, [page])
  useEffect(() => {
    const cancelRecheck = () => { pendingPlanRecheck.current = null }
    for (const event of ['pointerdown', 'wheel', 'touchstart', 'keydown']) window.addEventListener(event, cancelRecheck, { passive: true })
    return () => { for (const event of ['pointerdown', 'wheel', 'touchstart', 'keydown']) window.removeEventListener(event, cancelRecheck) }
  }, [])
  useEffect(() => {
    const target = pendingPlanRecheck.current
    if (!target) return
    if (page !== 'trials' || !target.isConnected || document.activeElement !== target) {
      pendingPlanRecheck.current = null
      return
    }
    if (!modeReady || !savedReviewReady) return
    const rect = target.getBoundingClientRect()
    if (rect.top >= window.innerHeight || rect.bottom <= 0) target.scrollIntoView({ block: 'start' })
    pendingPlanRecheck.current = null
  }, [page, modeReady, savedReviewReady, showHistoricalIdeas])
  useEffect(() => {
    if (!focusHelpQuestion || page !== 'options' || !helpQuestion.current) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    helpQuestion.current.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
    helpQuestion.current.focus({ preventScroll: true })
    setFocusHelpQuestion(false)
  }, [focusHelpQuestion, page])
  useEffect(() => {
    const pending = pendingAdviceFocus.current
    if (!pending) return
    if (page !== 'options' || advice !== pending.result || question !== pending.question ||
        adviceProject !== currentProject || adviceCase !== currentAdviceContext) {
      pendingAdviceFocus.current = null
      return
    }
    if (!modeReady) return
    if (!showCurrentGuidance && advice.result_kind !== 'local_planning_guidance') {
      pendingAdviceFocus.current = null
      return
    }
    const target = adviceResult.current
    if (!target) return
    pendingAdviceFocus.current = null
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    target.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
    target.focus({ preventScroll: true })
  }, [advice, adviceCase, adviceProject, currentAdviceContext, currentProject, modeReady, page, question, showCurrentGuidance])
  useEffect(() => {
    if (!savedTexts.length) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void api<{ needs_review: boolean }>('/api/project/review-saved-guidance', JSON.parse(savedReviewKey), controller.signal)
        .then((result) => {
          if (typeof result.needs_review !== 'boolean') throw new Error('Invalid saved guidance review')
          if (!controller.signal.aborted) setSavedGuidanceReview({ key: savedReviewKey, needsReview: result.needs_review, failed: false })
        })
        .catch(() => { if (!controller.signal.aborted) setSavedGuidanceReview({ key: savedReviewKey, needsReview: true, failed: true }) })
    }, 200)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [savedReviewKey])
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void api<{ planning_only: boolean }>('/api/project/planning-mode', JSON.parse(planningKey), controller.signal)
        .then((r) => {
          if (typeof r.planning_only !== 'boolean') throw new Error('Invalid local planning check')
          setPlanningMode({ key: planningKey, planningOnly: r.planning_only, failed: false })
        })
        .catch(() => { if (!controller.signal.aborted) setPlanningMode({ key: planningKey, planningOnly: true, failed: true }) })
    }, 200)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [planningKey])
  async function refreshProvider() {
    try {
      const result = await api<any>('/api/inference/providers')
      setStatus({
        configured: result.settings.configured,
        provider: result.settings.provider,
        provider_name: result.settings.provider_name,
        model: result.settings.model,
      })
      setStatusLoaded(true)
    } catch (e) {
      setNotice((e as Error).message)
      setStatusLoaded(true)
    }
  }
  useEffect(() => {
    const root = workbench.current
    if (!root) return
    const observer = new MutationObserver((changes) => {
      for (const change of changes) {
        const target = change.target instanceof Element ? change.target : change.target.parentElement
        if (target?.closest('.pw-global-error')) continue
        const alerts = Array.from(change.addedNodes).flatMap((added) => {
          if (!(added instanceof Element)) return []
          return added.matches('[role=alert]') ? [added] : Array.from(added.querySelectorAll('[role=alert]'))
        })
        const containingAlert = target?.closest('[role=alert]')
        if (containingAlert) alerts.push(containingAlert)
        for (const alert of alerts) {
          if (!alert.isConnected || alert.getClientRects().length === 0 || getComputedStyle(alert).visibility === 'hidden') continue
          const message = alert.textContent?.trim()
          if (message) setInlineError(message)
        }
        for (const removed of Array.from(change.removedNodes)) {
          if (!(removed instanceof Element)) continue
          const alert = removed.matches('[role=alert]') ? removed : removed.querySelector('[role=alert]')
          const message = alert?.textContent?.trim()
          if (message) setInlineError((current) => current === message ? '' : current)
        }
      }
    })
    observer.observe(root, { childList: true, characterData: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    void refreshProvider()
    return () => request.current?.abort()
  }, [])
  useEffect(() => {
    if (!autosaveEnabled || !autosave) return
    try { autosave.save(w); setAutosaveError('') }
    catch { setAutosaveError('Local saving failed. Save a backup to keep your work.') }
  }, [w, autosave, autosaveEnabled])
  function update(next: ProjectWorkspace) {
    setW(next)
  }
  function apply(d: ProjectIntakeDraft, intake?: ProjectIntakeResult, discussion?: string) {
    request.current?.abort()
    if (question.trim()) setPreviousQuestion(question)
    setPreparedCheckName('')
    setPreparedCheckSuggestion(null)
    setMixQuestionContext(null)
    setPreparedMix(null)
    setRecentMixContext(null)
    request.current = null
    setBusy(false)
    setStartingGuidance(intake ?? null)
    const localIntakeGuidance = intake?.origin === 'local' || intake?.guidance_origin === 'local'
    const note: ProjectAdviceNote | null = intake ? {
      id: crypto.randomUUID(), created_at: new Date().toISOString(), provider: localIntakeGuidance ? 'local' : intake.provider,
      model: localIntakeGuidance ? 'Local planning guide' : intake.model, project_snapshot: reviewProjectDraft(intake.project_draft),
      configuration_versions: [], assessment_kind: 'user_reported',
      text: [intake.reply, `First step: ${intake.first_step}`, ...intake.questions.map((q) => `Question to resolve: ${q}`)].join('\n\n'),
      kind: localIntakeGuidance ? 'local_guidance' : 'model_proposal',
    } : null
    const withNote = (project: ProjectWorkspace): ProjectWorkspace => {
      const updated = discussion?.trim() ? { ...project, intake_notes: discussion } : project
      return note && (updated.advice_notes?.length ?? 0) < 30
        ? { ...updated, advice_notes: [...(updated.advice_notes ?? []), note] } : updated
    }
    const changed = JSON.stringify(d) !== currentProject
    if (w.project.product?.value !== d.product?.value && w.configurations.length) {
      try {
        downloadProjectWorkspace(w)
        setW(withNote(newProjectWorkspace(reviewProjectDraft(d))))
        setAdviceKind('user_reported')
        setSelectedIdea(null)
        setLastAdviceUsedIdea(false)
        setAdvice(null)
        setQuestion('')
        if (page === 'start' || page === 'manual') pendingOptionsHeadingFocus.current = true
        setPage('options')
        setNotice(
          'The earlier product project was downloaded. This product has a separate project and no transferred measurements.',
        )
        return
      } catch (e) {
        setError((e as Error).message)
        return
      }
    }
    setW(withNote({
      ...w,
      project: reviewProjectDraft(d),
      records: changed ? w.records.map((r) => ({ ...r, conditions_confirmed: false })) : w.records,
      costs: changed
        ? Object.fromEntries(
            Object.entries(w.costs).map(([key, cost]) => [
              key,
              { ...cost, functional_basis: '', acceptance_basis: '' },
            ]),
          )
        : w.costs,
    }))
    setAdvice(null)
    setSelectedIdea(null)
    setLastAdviceUsedIdea(false)
    setQuestion('')
    if (page === 'start' || page === 'manual') pendingOptionsHeadingFocus.current = true
    setPage('options')
    setNotice(
      note && (w.advice_notes?.length ?? 0) >= 30
        ? 'The starting guidance stays onscreen. This project already has thirty saved planning notes, so this reply will not be in the saved file.'
        : changed && w.records.length
        ? 'Project updated. Review the recorded test conditions before checking again.'
        : autosaveEnabled ? 'Your project is saved in this browser. Connected AI keys are not included.' : 'Project details follow you across options, plans, checks and costs. Save a backup to keep them.',
    )
  }
  function manualEntry() {
    setManual(structuredClone(w.project))
    setPage('manual')
  }
  async function openFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      if (f.size > PROJECT_WORKSPACE_MAX_BYTES)
        throw new Error('Choose a project file no larger than four megabytes.')
      const next = parseProjectWorkspace(await f.text())
      request.current?.abort()
      request.current = null
      setBusy(false)
      setW(next)
      setRestoreCalculations(true)
      setWorkspaceOpenEpoch((epoch) => epoch + 1)
      setPreviousQuestion(question)
      setQuestion('')
      setMixQuestionContext(null)
      setPreparedMix(null)
      setRecentMixContext(null)
      setPreparedCheckName('')
      setStartingGuidance(null)
      setAdvice(null)
      setAdviceKind('user_reported')
      setSelectedIdea(null)
      setLastAdviceUsedIdea(false)
      setPage('trials')
      setNotice(
        'Project opened. Review the test conditions before recalculating.',
      )
      setError('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      e.target.value = ''
    }
  }
  async function explore(forceOptions = false, comparison?: { question: string; advice: AdvisorResult; noteId: string | null }) {
    pendingAdviceFocus.current = null
    if (!modeReady) {
      setError('The local planning check is unavailable. Please try again when the app is connected.')
      return
    }
    if (!comparison && !mixQuestionIsCurrent(mixQuestionContext, currentMixQuestionContext)) {
      setError('The project, setup or mix inputs changed after this calculation. Recalculate and ask again, or clear the calculation question below.')
      return
    }
    if (!savedReviewReady) {
      setError('The saved ideas could not be checked yet. Please try again.')
      return
    }
    if (!comparison && selectedIdea && !showHistoricalIdeas) {
      setError('This saved idea is unavailable. Clear it before asking a new question.')
      return
    }
    const configurationsForModel = savedNeedsReview ? w.configurations.map((c) => ({
      ...c, name: safeSetupName(w, c, 'Plan'),
      notes: c.notes.startsWith('Unverified trial idea:') ? '' : c.notes,
    })) : w.configurations
    const activeIdea = !comparison && showHistoricalIdeas ? selectedIdea : null
    if (
      activeIdea &&
      (activeIdea.caseId !== w.case_id ||
        !currentSetups(w.configurations).some(
          (c) => `${c.id}@${c.revision}` === activeIdea.key,
        ) ||
        JSON.stringify(w.trial_ideas?.[activeIdea.key]) !== JSON.stringify(activeIdea.idea))
    ) {
      setSelectedIdea(null)
      setError('This setup or idea has changed. Choose the idea again before asking about it.')
      return
    }
    setBusy(true)
    setError('')
    const controller = new AbortController()
    request.current = controller
    const prompt =
      comparison?.question || question.trim() ||
      'Help me choose a practical first approach for this product. Explain the material, preparation, process or design changes I could try and the trade-offs. If I do not know the right performance measurements, help me choose them in plain language. Ask only the essential missing questions.'
    try {
      const result = await api<AdvisorResult | AdvisorFollowupResult | LocalPlanningResult>(
        forceOptions || (!comparison && !question.trim()) ? '/api/advisor/help' : '/api/advisor/follow-up',
        {
          brief: briefFrom(w.project),
          question: prompt,
          history: [
            ...intakeHistory(w.intake_notes),
            ...(
            advice && adviceCase === currentAdviceContext && adviceQuestion && !lastAdviceUsedIdea && !activeIdea
              ? [
                  { role: 'user', content: adviceQuestion },
                  ...(showCurrentGuidance ? [{ role: 'assistant', content: [advice.answer, ...advice.questions].join('\n').slice(0, 3000) }] : []),
                ]
              : []),
          ],
          ...(w.configurations.length
            ? {
                project_context: {
                  case_id: w.case_id,
                  configurations: configurationsForModel,
                  checks: w.checks,
                  records: w.records.filter((r) => !w.record_exclusions?.[r.id]),
                  assessment_kind: adviceKind,
                },
              }
            : {}),
          ...(!comparison && mixQuestionContext && preparedMix ? { mix_calculation: preparedMix } : {}),
          ...(w.configurations.some((c) => w.costs[`${c.id}@${c.revision}`])
            ? {
                manufacturing_costs: currentSetups(w.configurations)
                  .filter((c) => w.costs[`${c.id}@${c.revision}`])
                  .map((c) => costRequest(w, c, w.costs[`${c.id}@${c.revision}`])),
              }
            : {}),
          ...(activeIdea ? { trial_ideas: { [activeIdea.key]: activeIdea.idea } } : {}),
        },
        controller.signal,
      )
      if (request.current === controller && !controller.signal.aborted) {
        if (!usableAdvice(result)) throw new Error('We could not use that reply. Your project is still here; please try again.')
        pendingAdviceFocus.current = currentPage.current === 'options' ? { result, question } : null
        setComparisonOrigin(comparison ? { context: currentAdviceContext, advice: comparison.advice, noteId: comparison.noteId } : null)
        setAdvice(result)
        setShowWorkspaceTools(false)
        setStartingGuidance(null)
        setLastAdviceUsedIdea(Boolean(activeIdea))
        setSelectedIdea(null)
        setAdviceCase(currentAdviceContext)
        setAdviceProject(currentProject)
        setAdviceQuestion(prompt)
        const noteId = crypto.randomUUID()
        setAdviceNoteId((w.advice_notes?.length ?? 0) < 30 ? noteId : null)
        const boundMix = 'mix_calculation' in result && result.mix_calculation
          ? (({ result: _result, ...snapshot }) => structuredClone(snapshot))(result.mix_calculation)
          : null
        const text = [
          ...('guidance_adjusted' in result && result.guidance_adjusted ? ['Locally adapted for planning.'] : []),
          ...('mix_guidance_adjusted' in result && result.mix_guidance_adjusted ? ['Mix amount corrected using the calculator.'] : []),
          `Question: ${prompt}`,
          result.answer,
          ...result.next_steps.map((step) => `Next action: ${step}`),
          ...result.questions.map((q) => `Question to resolve: ${q}`),
          ...('material_routes' in result ? result.material_routes : []).map((r) =>
            [
              'MATERIAL / PREPARATION OPTION',
              r.title,
              r.change,
              r.why,
              ...r.steps,
              ...r.tradeoffs,
              `Next check: ${r.check}`,
            ].join('\n'),
          ),
          ...('engineering_routes' in result ? result.engineering_routes : []).map((r) =>
            [
              'SHAPE / ASSEMBLY OPTION',
              r.title,
              r.change,
              r.why,
              ...r.steps,
              ...r.tradeoffs,
              `Next check: ${r.check}`,
            ].join('\n'),
          ),
        ].join('\n\n')
        setW((current) =>
          current.case_id === w.case_id && (current.advice_notes?.length ?? 0) < 30
            ? {
                ...current,
                advice_notes: [
                  ...(current.advice_notes ?? []),
                  {
                    id: noteId,
                    created_at: new Date().toISOString(),
                    provider: result.provider,
                    model: result.model,
                    project_snapshot: structuredClone(w.project),
                    configuration_versions: currentSetups(w.configurations).map((c) => ({
                      id: c.id,
                      revision: c.revision,
                    })),
                    assessment_kind: adviceKind,
                    text,
                    kind: result.result_kind==='local_planning_guidance'?'local_guidance':'model_proposal',
                    ...(boundMix ? { mix_context: boundMix } : {}),
                  },
                ],
              }
            : current,
        )
        setNotice(
          (w.advice_notes?.length ?? 0) >= 30
            ? 'This reply remains onscreen. The project already contains thirty saved planning notes.'
            : autosaveEnabled ? 'Your answer is saved in this browser.' : 'Save a backup to keep this answer.',
        )
      }
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message)
    } finally {
      if (request.current === controller) {
        request.current = null
        setBusy(false)
      }
    }
  }
  function useRoute(r: AdvisorRoute) {
    if (adviceCase !== currentAdviceContext) {
      setError('Your project changed. Ask for fresh ideas before saving a plan.')
      return
    }
    if (w.configurations.length >= 100) {
      setError(
        'This project already has 100 setup versions. Save it and start a separate project to add more.',
      )
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const text = w.project.input?.value ?? ''
    const next = {
      id: crypto.randomUUID(),
      revision: 1,
      name: r.title,
      materials: [
        {
          id: crypto.randomUUID(),
          name:
            text.trim() && text.length <= 160
              ? text
              : text.trim()
                ? 'Project materials (see project description)'
                : 'Material not yet specified',
          amount: '',
          unit: system === 'us' ? 'lb' : 'kg',
        },
      ],
      process: w.project.process?.value ?? '',
      geometry: '',
      notes:
        text.trim() && text.length <= 160
          ? ''
          : 'This line represents your project description. Add the ingredients and amounts when known.',
    }
    const sourceAdvice = advice && 'material_routes' in advice ? advice : comparisonOrigin?.context === currentAdviceContext ? comparisonOrigin.advice : null
    if (!sourceAdvice) return
    const sourceNoteId = sourceAdvice === comparisonOrigin?.advice ? comparisonOrigin.noteId : adviceNoteId
    const noteId =
      sourceNoteId && w.advice_notes?.some((note) => note.id === sourceNoteId) ? sourceNoteId : null
    const idea = {
      title: r.title,
      change: r.change,
      why: r.why,
      steps: [...r.steps],
      tradeoffs: [...r.tradeoffs],
      check: r.check,
      provider: sourceAdvice.provider,
      model: sourceAdvice.model,
      ...(noteId ? { note_id: noteId } : {}),
    }
    update({
      ...w,
      configurations: [...w.configurations, next],
      trial_ideas: { ...w.trial_ideas, [`${next.id}@${next.revision}`]: idea },
    })
    pendingPlanFocus.current = `${next.id}@${next.revision}`
    setPage('trials')
  }
  function askAboutIdea(configuration: TrialConfiguration, idea: TrialIdea, questionText?: string) {
    if (question.trim()) setPreviousQuestion(question)
    setMixQuestionContext(null)
    setSelectedIdea({
      caseId: w.case_id,
      key: `${configuration.id}@${configuration.revision}`,
      idea: structuredClone(idea),
    })
    setQuestion(questionText || 'How could I use this idea for my current setup, and what needs checking?')
    setShowAnswerFollowup(true)
    setFocusHelpQuestion(true)
    setPage('options')
  }
  function compareIdeas() {
    const source = advice && 'material_routes' in advice ? advice : comparisonOrigin?.context === currentAdviceContext ? comparisonOrigin.advice : null
    if (!source || busy) return
    if (adviceCase !== currentAdviceContext) {
      setError('Your project changed. Ask for fresh ideas before comparing them.')
      return
    }
    const routes = [...source.material_routes, ...source.engineering_routes]
    if (!routes.length) return
    if (!status.configured && !planningMode?.planningOnly) { setProviderOpen(true); return }
    void explore(false, { question: buildIdeaComparisonQuestion(routes), advice: source,
      noteId: source === comparisonOrigin?.advice ? comparisonOrigin.noteId : adviceNoteId })
  }
  function save() {
    try {
      downloadProjectWorkspace(w)
      setNotice(
        'Project backup saved. Open this file later to continue your work. API keys are not included.',
      )
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const drawingFingerprint = sketchFingerprint(w, showHistoricalIdeas)
  const currentSketch = sketch?.fingerprint === drawingFingerprint ? sketch.image : null
  const currentSection = section?.fingerprint === drawingFingerprint ? section.section : null
  const displayedIdeas = adviceCase === currentAdviceContext && advice && 'material_routes' in advice ? advice : showHistoricalIdeas && comparisonOrigin?.context === currentAdviceContext && adviceCase === currentAdviceContext ? comparisonOrigin.advice : null
  const currentReportAdvice = modeReady && advice && adviceProject === currentProject &&
    adviceCase === currentAdviceContext && (showCurrentGuidance || advice.result_kind === 'local_planning_guidance')
    ? advice : null
  const currentReportStartingGuidance = modeReady && !advice && startingGuidance &&
    (showCurrentGuidance || startingGuidance.origin === 'local' || startingGuidance.guidance_origin === 'local') &&
    !PROJECT_INTAKE_FIELDS.some((field) => (startingGuidance.project_draft[field]?.value ?? '') !== (w.project[field]?.value ?? ''))
    ? startingGuidance : null
  const resultContexts = {
    checks: reportResultContext(w, adviceKind, showHistoricalIdeas, 'checks'),
    cost: reportResultContext(w, adviceKind, showHistoricalIdeas, 'cost'),
    comparison: reportResultContext(w, adviceKind, showHistoricalIdeas, 'comparison'),
  }
  const overviewResults = decisionResults(mixSummary, reportResults, resultContexts)
  const earlierReportNote = !currentReportAdvice && !currentReportStartingGuidance
    ? [...visibleSavedNotes].reverse().find((note) => PROJECT_INTAKE_FIELDS.every((field) =>
        (note.project_snapshot[field]?.value ?? '') === (w.project[field]?.value ?? '')))
    : undefined
  const adviceVisible = Boolean(modeReady && advice && adviceProject === currentProject && (showCurrentGuidance || advice.result_kind === 'local_planning_guidance'))
  function summaryText() {
    const guidance = formatAdviceForReport(currentReportAdvice ?? currentReportStartingGuidance) || formatEarlierAdviceForReport(earlierReportNote)
    const comparedIdeas = currentReportAdvice && showHistoricalIdeas && comparisonOrigin?.context === currentAdviceContext
      ? formatAdviceForReport(comparisonOrigin.advice).replace('Ideas and next steps', 'Ideas compared') : ''
    const results = (['checks', 'cost', 'comparison'] as const)
      .map((kind) => reportResults[kind]?.context === resultContexts[kind] ? reportResults[kind]!.text : '').join('')
    return formatProjectSummary(w, showHistoricalIdeas) + guidance + comparedIdeas + (mixSummary ? `\n${mixSummary}` : '') + results + formatProjectNotes(w)
  }
  function rememberReportResult(kind: ReportResultKind, text: string, context: string) {
    setReportResults((current) => ({ ...current, [kind]: { text, context } }))
  }
  function downloadSummary() {
    downloadTextFile('reshivo-summary.txt', summaryText())
  }
  function printSummary() {
    const guidance = formatAdviceForReport(currentReportAdvice ?? currentReportStartingGuidance)
    const comparedIdeas = currentReportAdvice && showHistoricalIdeas && comparisonOrigin?.context === currentAdviceContext
      ? formatAdviceForReport({ ...comparisonOrigin.advice, answer: '', next_steps: [], questions: [] }).replace('Ideas and next steps', 'Ideas compared') : ''
    const results = (['checks', 'cost', 'comparison'] as const)
      .map((kind) => reportResults[kind]?.context === resultContexts[kind] ? reportResults[kind]!.text : '').join('')
    try { printTextReport(formatPrintableProjectReport(w, showHistoricalIdeas, guidance + comparedIdeas, mixSummary, results), currentSketch, currentSection) }
    catch (e) { setError((e as Error).message) }
  }
  function exploreMyMaterial() {
    if (!question.trim()) setQuestion('Help me explore ways to use my available material to make my product. Ask only for the missing details that matter first.')
    setPage('options')
    setFocusHelpQuestion(true)
  }
  function requestIdeas(forceOptions = false) {
    if (!status.configured && !planningMode?.planningOnly) {
      setProviderOpen(true)
      return
    }
    void explore(forceOptions)
  }
  const hasProject = Boolean(w.project.product || w.project.input)
  const answerFocused = page === 'options' && modeReady && advice && adviceProject === currentProject && (showCurrentGuidance || advice.result_kind === 'local_planning_guidance') && !showWorkspaceTools
  return (
    <div className="project-workbench" ref={workbench}>
      <header className="pw-header">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            setPage(hasProject ? 'options' : 'start')
          }}
          className="pw-brand"
        >
          <img className="pw-brand-mark" src="/reshivo-mark.svg" alt="" />
          Reshivo<span>Plan products from recycled materials</span>
        </a>
        <div className="pw-header-actions">
          <button onClick={() => setProviderOpen(true)}>
            AI settings
            <span aria-hidden="true">⌄</span>
          </button>
          <details
            onClick={(e) => {
              if ((e.target as Element).closest('button')) e.currentTarget.removeAttribute('open')
            }}
          >
            <summary>Menu</summary>
            <div className="pw-menu">
              <button onClick={() => file.current?.click()}>Open project backup</button>
              <button onClick={save}>Save project backup</button>
              <button onClick={downloadSummary}>Download readable summary</button>
              <button onClick={printSummary}>Print / Save as PDF</button>
              <button
                onClick={() => {
                  try {
                    downloadProjectWorkspace(w)
                    request.current?.abort()
                    setBusy(false)
                    const blank = newProjectWorkspace()
                    if (autosaveEnabled && autosave) {
                      try { autosave.save(blank, true) }
                      catch { setAutosaveError('Local saving failed. Save a backup to keep your work.') }
                    }
                    setW(blank)
                    setRestoreCalculations(false)
                    setPreparedCheckName('')
                    setPreviousQuestion(question)
                    setMixQuestionContext(null)
                    setPreparedMix(null)
                    setRecentMixContext(null)
                    setAdvice(null)
                    setStartingGuidance(null)
                    setAdviceKind('user_reported')
                    setSelectedIdea(null)
                    setLastAdviceUsedIdea(false)
                    setQuestion('')
                    setPage('start')
                    setNotice('Previous project downloaded. Start a separate project here.')
                  } catch (e) {
                    setError((e as Error).message)
                  }
                }}
              >
                Save &amp; start a new project
              </button>
              <button onClick={() => setProviderOpen(true)}>AI connections</button>
              <details>
                <summary>Local project recovery</summary>
                <p>{autosaveError || (autosaveEnabled ? 'Project data is saved in this browser. Connected AI keys are not included.' : 'Local saving is off for this tab.')}</p>
                {autosaveEnabled && <p>Removing local copies clears this project from this browser; another open tab may save it again.</p>}
                {autosave && (autosaveEnabled ? <button type="button" onClick={() => {
                  try { autosave.forget(w); setAutosaveEnabled(false); window.sessionStorage.setItem(AUTOSAVE_DISABLED_KEY, '1'); setNotice('Local copies of this project were removed. Local saving is off for this tab.') }
                  catch { setAutosaveError('Could not remove local project copies. Check browser storage settings.') }
                }}>Remove saved copies of this project from this browser</button> : <button type="button" onClick={() => { try { window.sessionStorage.removeItem(AUTOSAVE_DISABLED_KEY); setAutosaveEnabled(true) } catch { setAutosaveError('Local saving is unavailable. Save a backup to keep your work.') } }}>Turn on local saving</button>)}
              </details>
              <details>
                <summary>Preferred mass units</summary>
                <label>
                  Mass display
                  <select
                    value={system}
                    onChange={(e) => setSystem(e.target.value as typeof system)}
                  >
                    <option value="metric">Metric (kg)</option>
                    <option value="us">US customary (lb)</option>
                  </select>
                </label>
                <p>
                  New plan amounts and supported mass calculations use this display. Existing plan
                  amounts, readings, prices and geometry retain their entered units.
                </p>
              </details>
              <details>
                <summary>More tools</summary>
                <button onClick={() => setPage('legacy')}>Open earlier workspace</button>
              </details>
              <button
                onClick={() => {
                  setNotice(
                    'The current project remains in this tab until you replace it. Save it before starting another.',
                  )
                  setPage('start')
                }}
              >
                Review this project’s idea
              </button>
              <small className="pw-menu-version">Reshivo v{appVersion}</small>
            </div>
          </details>
        </div>
      </header>
      <input ref={file} type="file" accept=".json,application/json" hidden onChange={openFile} />
      <ProviderSettings
        open={providerOpen}
        onClose={() => setProviderOpen(false)}
        onSaved={() => void refreshProvider()}
      />
      {notice && (
        <div className="pw-toast" role="status">
          {notice}
          <button onClick={() => setNotice('')} aria-label="Dismiss message">
            ×
          </button>
        </div>
      )}
      {autosaveError && <div className="pw-notice" role="status">{autosaveError}</div>}
      {(error || inlineError) && (
        <div className="pw-global-error" role="region" aria-label="Something needs your attention">
          <div>
            <strong>Let's sort this out</strong>
            <p role={error ? 'alert' : undefined}>{error || inlineError}</p>
          </div>
          <button type="button" onClick={() => { setError(''); setInlineError('') }} aria-label="Dismiss message">×</button>
        </div>
      )}
      {page === 'start' ? (
        <PromptProjectStart
          key={w.case_id + currentProject}
          initialDraft={hasProject ? w.project : undefined}
          initialDiscussion={w.intake_notes}
          onApply={apply}
          onManualEntry={manualEntry}
          providerStatus={statusLoaded ? status : undefined}
          onConfigureProvider={() => setProviderOpen(true)}
        />
      ) : page === 'manual' ? (
        <main className="pw-manual">
          <h1>Describe your project</h1>
          <p>
            Use everyday words. Unknown details can stay blank. These details will follow you
            through the workspace.
          </p>
          <p>To continue, add a product, materials, and either where it will be used or what it should do.</p>
          {PROJECT_INTAKE_FIELDS.map((k) => (
            <label key={k}>
              {FIELD_LABEL[k]}
              <textarea
                maxLength={1000}
                value={manual[k]?.value ?? ''}
                onChange={(e) =>
                  setManual({
                    ...manual,
                    [k]: e.target.value.trim()
                      ? { value: e.target.value, source: 'user_review', quote: e.target.value }
                      : null,
                  })
                }
              />
            </label>
          ))}
          <div className="pw-actions">
            <button
              className="pw-primary"
              disabled={!hasProjectContext(manual)}
              onClick={() => apply(manual)}
            >
              Use this project
            </button>
            <button onClick={() => setPage('start')}>Back</button>
          </div>
        </main>
      ) : page === 'legacy' ? (
        <main>
          <div className="pw-legacy-bar">
            <button onClick={() => setPage(hasProject ? 'options' : 'start')}>
              Back to current project
            </button>
            <p>
              Earlier tools keep their separate workspace files. Current project records are
              retained in this tab.
            </p>
          </div>
          <Suspense fallback={<p>Loading earlier tools…</p>}>
            <LegacyWorkshop />
          </Suspense>
        </main>
      ) : (
        <div className={`pw-layout${answerFocused ? ' pw-layout--answer' : ''}`}>
          {!answerFocused && <aside className="pw-project-rail">
            <span className="pw-overline">Your project</span>
            <h2>{w.project.product?.value ?? 'Product not named'}</h2>
            {(['input', 'use', 'priorities', 'variation'] as const).map((k) => (
              <div key={k}>
                <h3>
                  {k === 'input'
                    ? 'Materials'
                    : k === 'use'
                      ? 'Use'
                      : k === 'priorities'
                        ? 'What matters'
                        : 'What changes'}
                </h3>
                <p>{w.project[k]?.value ?? 'Not described yet'}</p>
              </div>
            ))}
            <button className="pw-text-button" onClick={manualEntry}>
              Edit project
            </button>
            <small>
              {currentSetups(w.configurations).length} current plan(s) · {w.checks.length}{' '}
              product check(s)
            </small>
          </aside>}
          <main className="pw-main">
            {answerFocused && <div className="pw-actions pw-spaced"><button type="button" onClick={manualEntry}>Edit project</button><button type="button" onClick={() => setShowWorkspaceTools(true)}>Project &amp; tools</button></div>}
            {!answerFocused && <div className="pw-topbar">
              <nav aria-label="Project workspace">
                {(['options', 'trials', 'adjust', 'checks', 'costs'] as const).map((k) => (
                  <button
                    key={k}
                    aria-current={page === k ? 'page' : undefined}
                    onClick={() => setPage(k)}
                  >
                    {k === 'options'
                      ? 'Options'
                      : k === 'trials'
                        ? 'Plans'
                      : k === 'adjust'
                          ? 'Adjust mix'
                          : k === 'checks'
                            ? 'Checks'
                            : 'Costs'}
                  </button>
                ))}
              </nav>
              <div className="pw-actions">
                <button onClick={() => file.current?.click()}>Open backup</button>
                <button onClick={save}>Save backup</button>
              </div>
            </div>}
            {showWorkspaceTools && page === 'options' && advice && adviceProject === currentProject && <button type="button" onClick={() => setShowWorkspaceTools(false)}>Focus on answer</button>}
            {!answerFocused && <p className="pw-section-hint">Choose any section; you can return whenever you need.</p>}
            {page === 'options' && (
              <section className="pw-section">
                {!answerFocused && <div className="pw-section-heading">
                  <div>
                    <h1 ref={optionsHeading} tabIndex={-1}>Find a way to use what you have</h1>
                    <p>
                      Get ideas for using your material. Add details if you have them; unknowns can stay blank.
                    </p>
                  </div>
                </div>}
                {modeReady && startingGuidance && !advice && (showCurrentGuidance || startingGuidance.origin === 'local' || startingGuidance.guidance_origin === 'local') && (
                  <section className="pw-answer" aria-live="polite">
                    <span className="pw-overline">{startingGuidance.origin === 'local' ? 'Local planning guide · no AI call' : startingGuidance.guidance_origin === 'local' ? `Local next step · project draft by ${startingGuidance.provider} / ${startingGuidance.model}` : `Starting suggestion · ${startingGuidance.provider} / ${startingGuidance.model}`}</span>
                    {PROJECT_INTAKE_FIELDS.some((field) => (startingGuidance.project_draft[field]?.value ?? '') !== (w.project[field]?.value ?? '')) && (
                      <p className="pw-notice">You edited the project after this suggestion. Ask again to include your changes.</p>
                    )}
                    <p>{startingGuidance.reply}</p>
                    <h2>A useful first step</h2>
                    <p>{startingGuidance.first_step}</p>
                    {startingGuidance.questions.length > 0 && <><h2>Still worth considering</h2><ul>{startingGuidance.questions.map((q) => <li key={q}>{q}</li>)}</ul></>}
                    <div className="pw-actions pw-spaced">
                      <button type="button" className="pw-primary" disabled={busy || !modeReady || !savedReviewReady || !statusLoaded} onClick={() => requestIdeas(true)}>
                        {busy ? 'Working through your options…' : 'Get ideas for my material'}
                      </button>
                      {currentReportStartingGuidance && <>
                        <button type="button" onClick={downloadSummary}>Download summary</button>
                        <button type="button" onClick={printSummary}>Print / Save as PDF</button>
                      </>}
                    </div>
                  </section>
                )}
                {!advice && !startingGuidance && earlierReportNote && <section className="pw-card pw-spaced" aria-label="Previous answer">
                  <h2>Previous answer</h2>
                  <p>This answer was saved earlier. Ask again if your project details or measurements have changed.</p>
                  <p className="pw-saved-note">{earlierReportNote.text}</p>
                </section>}
                {!adviceVisible && <CurrentCalculations results={overviewResults} earlierAnswer={Boolean(earlierReportNote || startingGuidance)} onOpen={setPage} />}
                {modeReady && advice && adviceProject === currentProject && (showCurrentGuidance || advice.result_kind === 'local_planning_guidance') && (
                  <>
                    {adviceCase !== currentAdviceContext && !overviewResults.mix && !overviewResults.cost && !overviewResults.checks && (
                      <p className="pw-notice">
                        These suggestions were made before your latest setup, check or cost changes.
                        Ask again to include the new information.
                      </p>
                    )}
                    <section className="pw-answer" aria-live="polite" aria-label="Your planning result" ref={adviceResult} tabIndex={-1}>
                      <h2>{adviceCase === currentAdviceContext ? 'Your answer' : 'Earlier answer'}</h2>
                      {'mix_calculation' in advice && advice.mix_calculation && adviceCase === currentAdviceContext && (
                        <CheckedMixAdvice feasible={advice.mix_calculation.result.feasible} bounds={advice.mix_calculation.result.exact_addition_kg} stock={advice.mix_calculation.inputs.addition_name} system={system} />
                      )}
                      <span className="pw-overline">
                        {advice.result_kind==='local_planning_guidance'?'Local planning guide · no AI call':`Proposed next steps · ${advice.provider} / ${advice.model}${advice.guidance_adjusted ? ' · locally adapted for planning' : ''}`}
                      </span>
                      {'mix_guidance_adjusted' in advice && advice.mix_guidance_adjusted && (
                        <p className="pw-notice" role="status">A mix amount was corrected using your calculation.</p>
                      )}
                      {advice.answer
                        .split('\n')
                        .filter(Boolean)
                        .map((p, i) => (
                          <p key={i}>{p}</p>
                        ))}
                      {advice.next_steps.length > 0 && <><h2>What to do next</h2>
                      <ol>{advice.next_steps.map((step, i) => <li key={i}>{step}</li>)}</ol></>}
                      <details className="pw-decision-context">
                        <summary>Material and goal</summary>
                        <div className="pw-decision-brief" aria-label="Your project at a glance">
                          {w.project.input?.value && <div><strong>Your material</strong><p>{w.project.input.value}</p></div>}
                          {w.project.variation?.value && <div><strong>What changes</strong><p>{w.project.variation.value}</p></div>}
                          {w.project.priorities?.value && <div><strong>Your goal</strong><p>{w.project.priorities.value}</p></div>}
                        </div>
                      </details>
                      <CurrentCalculations results={overviewResults} earlierAnswer={adviceCase !== currentAdviceContext} onOpen={setPage} />
                      <div className="pw-actions pw-spaced">
                        {(displayedIdeas ? displayedIdeas.material_routes.length + displayedIdeas.engineering_routes.length > 0 : advice.next_steps.length > 0) && <button className="pw-primary" type="button" onClick={() => {
                          if (displayedIdeas) routeDetails.current?.scrollIntoView({ block: 'start' })
                          else setPage('trials')
                        }}>
                          {displayedIdeas ? 'See ideas' : 'Open plans'}
                        </button>}
                        <button type="button" onClick={() => {
                          if (!advice.next_steps.length && !('material_routes' in advice && advice.material_routes.length + advice.engineering_routes.length > 0)) setQuestion('')
                          setShowAnswerFollowup(true)
                          requestAnimationFrame(() => {
                            if (questionDetails.current) questionDetails.current.open = true
                            helpQuestion.current?.scrollIntoView({ block: 'center' })
                            helpQuestion.current?.focus({ preventScroll: true })
                          })
                        }}>{!advice.next_steps.length && !('material_routes' in advice && advice.material_routes.length + advice.engineering_routes.length > 0) ? 'Ask about my project' : 'Ask a follow-up'}</button>
                      </div>
                      {advice.questions.length > 0 && (!answerFocused || showAnswerFollowup) && (
                        <details className="pw-question-box">
                          <summary>Questions you can answer later</summary>
                          <ul>
                            {advice.questions.map((q, i) => (
                              <li key={i}>{q}</li>
                            ))}
                          </ul>
                          <button
                            onClick={() => {
                              setQuestion('')
                              setMixQuestionContext(null)
                              setShowAnswerFollowup(true)
                              requestAnimationFrame(() => {
                                if (questionDetails.current) questionDetails.current.open = true
                                helpQuestion.current?.scrollIntoView({ block: 'center' })
                                helpQuestion.current?.focus({ preventScroll: true })
                              })
                            }}
                          >
                            Answer or ask a question
                          </button>
                        </details>
                      )}
                      {currentReportAdvice && <div className="pw-actions pw-spaced">
                        <button type="button" onClick={downloadSummary}>Download summary</button>
                        <button type="button" onClick={printSummary}>Print / Save as PDF</button>
                      </div>}
                    </section>
                    {displayedIdeas && displayedIdeas.material_routes.length + displayedIdeas.engineering_routes.length > 0 && <section ref={routeDetails} className="pw-card pw-spaced" aria-label="Your ideas">
                      <h2>Your ideas</h2>
                      <p>{displayedIdeas.material_routes.length + displayedIdeas.engineering_routes.length > 1
                        ? 'Look at what each idea changes, its trade-offs and what to check. Some ideas can work together. Use one to save it as a plan and review what to do next.'
                        : 'Review what this idea changes, its trade-offs and what to check. Use it to save a plan and review what to do next.'}</p>
                      <button type="button" disabled={busy || !modeReady || !savedReviewReady || !statusLoaded} onClick={compareIdeas}>{busy ? 'Comparing…' : displayedIdeas.material_routes.length + displayedIdeas.engineering_routes.length > 1 ? 'Help me choose' : 'Help me understand'}</button>
                      {
                      [
                        { title: 'Materials and preparation', routes: displayedIdeas.material_routes },
                        { title: 'Shape and assembly', routes: displayedIdeas.engineering_routes },
                      ].filter((group) => group.routes.length).map((group) => (
                        <section key={group.title}>
                          <h2>{group.title}</h2>
                          <div className="pw-card-grid">
                            {group.routes.map((r) => (
                              <article key={r.id} className="pw-card">
                                <h3>{r.title}</h3>
                                <p>{r.change}</p>
                                <p><strong>Why consider it:</strong> {r.why}</p>
                                <p><strong>Trade-offs:</strong> {r.tradeoffs.join(' ')}</p>
                                <p><strong>What to check:</strong> {r.check}</p>
                                <p><strong>Steps:</strong></p>
                                <ol>
                                  {r.steps.map((s, i) => (
                                    <li key={i}>{s}</li>
                                  ))}
                                </ol>
                                <details>
                                  <summary>Set up this check</summary>
                                  <CheckSuggestionHandoff suggestion={r.check} onPrepare={(name) => { setPreparedCheckName(name); setPage('checks') }} />
                                </details>
                                <button onClick={() => useRoute(r)}>Use this idea</button>
                              </article>
                            ))}
                          </div>
                        </section>
                      ))}
                    </section>}
                  </>
                )}
                {(!answerFocused || showAnswerFollowup) && <details className="pw-card" ref={questionDetails} open={showAnswerFollowup || !(modeReady && advice && adviceProject === currentProject && (showCurrentGuidance || advice.result_kind === 'local_planning_guidance'))}>
                  <summary>{advice && adviceProject === currentProject ? 'Ask another question or explore more ideas' : 'Get ideas for your material'}</summary>
                  <p>We’ll use the product and materials in your project. Add a question if you want to focus the answer.</p>
                  {w.intake_notes && <details>
                    <summary>Your setup answers</summary>
                    <p>These answers are included when you ask for ideas. Edit them if anything has changed.</p>
                    <textarea aria-label="Your setup answers" maxLength={20000} rows={4} value={w.intake_notes}
                      onChange={(event) => update({ ...w, intake_notes: event.target.value })} />
                  </details>}
                  {showHistoricalIdeas && selectedIdea && (
                    <div className="pw-notice">
                      <strong>Earlier idea selected for this question</strong>
                      <p>Review this idea against your current setup.</p>
                      <p>
                        <strong>{selectedIdea.idea.title}</strong> · {selectedIdea.idea.provider} /{' '}
                        {selectedIdea.idea.model}
                      </p>
                      <p>{selectedIdea.idea.change}</p>
                      <p>{selectedIdea.idea.why}</p>
                      <ol>
                        {selectedIdea.idea.steps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                      <p>
                        <strong>Trade-offs:</strong> {selectedIdea.idea.tradeoffs.join(' ')}
                      </p>
                      <p>
                        <strong>Next check:</strong> {selectedIdea.idea.check}
                      </p>
                      <button onClick={() => setSelectedIdea(null)}>
                        Remove idea from this question
                      </button>
                    </div>
                  )}
                  {selectedIdea && !showHistoricalIdeas && savedReviewReady && <div className="pw-notice">
                    <p>This saved idea is unavailable for this question.</p>
                    <button onClick={() => setSelectedIdea(null)}>Clear saved idea</button>
                  </div>}
                  {w.records.length > 0 && (
                    <label>
                      Use these readings when helping me
                      <select
                        value={adviceKind}
                        onChange={(e) => setAdviceKind(e.target.value as typeof adviceKind)}
                      >
                        <option value="user_reported">My entered measurements</option>
                        <option value="synthetic">Software simulation only</option>
                      </select>
                      <small>Uses current setup versions and included readings.</small>
                    </label>
                  )}
                  <label>
                    Your question (optional)
                    <textarea
                      ref={helpQuestion}
                      value={question}
                      maxLength={3000}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="For example: What could I make from this batch? What should I check first?"
                    />
                  </label>
                  {preparedMix && (mixQuestionContext || recentMixIsCurrent) && <div className="pw-notice">
                    <strong>{mixQuestionContext ? 'Mix calculation attached' : 'Recent mix calculation available'}</strong>
                    <p>Setup: {(() => { const setup = w.configurations.find((item) => item.id === preparedMix.configuration_id && item.revision === preparedMix.configuration_revision); return setup ? (showHistoricalIdeas ? setup.name : safeSetupName(w, setup, 'Plan')) : 'Unavailable setup' })()} · version {preparedMix.configuration_revision}. Component: {preparedMix.inputs.component}.</p>
                    <p>Portion: {preparedMix.inputs.input_mass_kg} kg, {preparedMix.inputs.input_min_percent}–{preparedMix.inputs.input_max_percent}% component. Added stock: {preparedMix.inputs.addition_name}, {preparedMix.inputs.addition_percent}% component. Chosen range: {preparedMix.inputs.target_min_percent}–{preparedMix.inputs.target_max_percent}%.</p>
                    {preparedMix.source && <p>Recorded whole-recipe reference: {(() => { const source = w.configurations.find((item) => item.id === preparedMix.source?.configuration_id && item.revision === preparedMix.source?.configuration_revision); const ingredient = source?.materials.find((item) => item.id === preparedMix.source?.component_id); return source ? `${showHistoricalIdeas ? source.name : safeSetupName(w, source, 'Recorded setup')} · version ${source.revision} · ${ingredient?.name ?? 'Unavailable ingredient'}` : 'Unavailable setup' })()}.</p>}
                    {mixQuestionContext ? <>
                      <p>{mixQuestionIsCurrent(mixQuestionContext, currentMixQuestionContext) ? 'This calculation will be sent with your question and recalculated from these inputs.' : 'The project, setup or mix inputs changed. Recalculate before sending this calculation.'}</p>
                      <button type="button" onClick={() => { setPreviousQuestion(question); setQuestion(''); setMixQuestionContext(null) }}>Remove calculation and clear question</button>
                    </> : <button type="button" onClick={() => setMixQuestionContext(recentMixContext)}>Attach this calculation to my question</button>}
                  </div>}
                  {showHistoricalIdeas && previousQuestion && <details>
                    <summary>Previous question kept for reference</summary>
                    <p className="pw-saved-note">{previousQuestion}</p>
                    <small>This text is not sent with the current question.</small>
                  </details>}
                  <div className="pw-actions">
                    <button className="pw-primary" onClick={() => requestIdeas()} disabled={busy || !modeReady || !savedReviewReady || !statusLoaded}>
                      {busy
                        ? 'Working through your options…'
                        : question.trim()
                          ? 'Ask this question'
                          : 'Get ideas for my material'}
                    </button>
                    <button type="button" onClick={() => setPage('trials')}>View plans</button>
                    {question.trim() && (
                      <button disabled={busy || !modeReady || !savedReviewReady || !statusLoaded} onClick={() => requestIdeas(true)}>
                        Explore alternatives
                      </button>
                    )}
                    {busy && (
                      <button
                        onClick={() => {
                          request.current?.abort()
                          request.current = null
                          setBusy(false)
                          setNotice('Stopped. Your project and question are still here.')
                        }}
                      >
                        Stop
                      </button>
                    )}
                  </div>
                  <small>
                    {status.configured
                      ? `${status.provider_name} · ${status.model}`
                      : modeReady && planningMode?.planningOnly
                        ? 'Local guidance is available without an AI connection.'
                        : 'Connect your own AI provider to get ideas.'}
                  </small>
                  {statusLoaded && !status.configured && <button type="button" className="pw-text-button" onClick={() => setProviderOpen(true)}>Open AI settings</button>}
                  <details><summary>What is sent to my AI provider?</summary>
                    <small>Your current setups, selected readings, entered costs and any idea shown above. Local calculations stay on this computer.</small>
                  </details>
                  {planningMode?.key === planningKey && planningMode.failed && <p role="alert">The local planning check is unavailable. Reopen the app and try again.</p>}
                  {modeReady && planningMode?.planningOnly && <p className="pw-notice">Earlier AI ideas are kept but hidden while this material needs local planning.</p>}
                  {savedNeedsReview && <p className="pw-notice">Some saved ideas are unavailable. You can still explore new options.</p>}
                  {savedGuidanceReview?.key === savedReviewKey && savedGuidanceReview.failed && <p role="alert">Saved suggestions could not be checked. Reopen the project and try again.</p>}
                </details>}
                {!answerFocused && isSoundProject(w.project, question) && <details className="pw-spaced">
                  <summary>About sound checks</summary>
                  <SoundGuidance project={w.project} question={question} />
                </details>}
                {!answerFocused && visibleSavedNotes.length > 0 && (
                  <details className="pw-card pw-spaced">
                    <summary>Saved planning notes ({visibleSavedNotes.length})</summary>
                    <p>Ideas saved with earlier project details.</p>
                    {visibleSavedNotes.map((note) => (
                      <details key={note.id}>
                        <summary>
                          {note.project_snapshot.product?.value ?? 'Project'} · {note.kind==='local_guidance'?'Local planning guide':`${note.provider} / ${note.model}`} · {note.created_at.slice(0, 16).replace('T', ' ')} UTC
                        </summary>
                        <p className="pw-saved-note">{note.text}</p>
                        {note.mix_context && <details>
                          <summary>Recorded mix context</summary>
                          <p>Destination: {note.mix_context.destination.component_name} · version {note.mix_context.destination.revision}.</p>
                          {note.mix_context.destination.tracked_component && <p>Tracked within that material: {note.mix_context.destination.tracked_component}.</p>}
                          {note.mix_context.source_recipe && <>
                            <p>Reference: {note.mix_context.source_recipe.name} · version {note.mix_context.source_recipe.revision}. Ingredient: {note.mix_context.source_recipe.component_name}. Whole-recipe fraction: {note.mix_context.source_recipe.fraction.numerator}/{note.mix_context.source_recipe.fraction.denominator}.</p>
                            <ul>{note.mix_context.source_recipe.materials.map((item) => <li key={item.id}>{item.name}: {item.amount} {item.unit.replaceAll('_', ' ')}</li>)}</ul>
                            <p>Process: {note.mix_context.source_recipe.process || 'not entered'} · Shape: {note.mix_context.source_recipe.geometry || 'not entered'}</p>
                          </>}
                        </details>}
                      </details>
                    ))}
                  </details>
                )}
                <ConceptSketch workspace={w} includeIdeas={showHistoricalIdeas} canGenerate={status.provider === 'meta' && status.configured} image={currentSketch} section={currentSection} onImage={(image, fingerprint) => setSketch(image ? { fingerprint, image } : null)} onSection={(value, fingerprint) => setSection(value ? { fingerprint, section: value } : null)} onConfigureProvider={() => setProviderOpen(true)} />
              </section>
            )}
            <div hidden={page !== 'trials' && page !== 'checks'}>
              <TrialWorkspace
                key={`${w.case_id}:${workspaceOpenEpoch}`}
                workspace={w}
                onReportResult={rememberReportResult}
                onChange={update}
                section={page === 'trials' ? 'trials' : 'checks'}
                readingKind={adviceKind}
                onReadingKindChange={setAdviceKind}
                onAskIdea={askAboutIdea}
                onChooseCheck={(configuration, idea) => {
                  setPreparedCheckSuggestion({ caseId: w.case_id, key: `${configuration.id}@${configuration.revision}`, text: idea.check })
                  setPage('checks')
                }}
                onExploreMaterial={exploreMyMaterial}
                onGoToPlans={() => setPage('trials')}
                onDownloadSummary={downloadSummary}
                onPrintSummary={printSummary}
                onSaveBackup={save}
                showHistoricalIdeas={showHistoricalIdeas}
                checkingPlanningMode={!modeReady || !savedReviewReady}
                preparedCheckName={showCurrentGuidance ? preparedCheckName : ''}
                preparedCheckSuggestion={showHistoricalIdeas && preparedCheckSuggestion?.caseId === w.case_id && w.trial_ideas?.[preparedCheckSuggestion.key]?.check === preparedCheckSuggestion.text ? preparedCheckSuggestion.text : ''}
                preparedCheckPlanKey={showHistoricalIdeas && preparedCheckSuggestion?.caseId === w.case_id && w.trial_ideas?.[preparedCheckSuggestion.key]?.check === preparedCheckSuggestion.text ? preparedCheckSuggestion.key : ''}
                onPreparedCheckUsed={() => setPreparedCheckName('')}
              />
            </div>
            <div hidden={page !== 'adjust'}>
              <MixAdjustment
                restoreCalculations={restoreCalculations}
                calculatorOpenRequest={calculatorOpenRequest}
                onGoToPlans={() => setPage('trials')}
                onGoToChecks={() => setPage('checks')}
                onAskForHelp={exploreMyMaterial}
                onSummary={setMixSummary}
                key={`${w.case_id}:${workspaceOpenEpoch}`}
                workspace={w}
                enabled={Boolean(modeReady && !planningMode?.planningOnly)}
                showHistoricalIdeas={showHistoricalIdeas}
                planningContext={planningPayload}
                onDraftChange={(updateDraft) => {
                  setW((current) => updateDraft(current))
                }}
                onDiscuss={(prompt, calculation) => { if (question.trim()) setPreviousQuestion(question); setSelectedIdea(null); setLastAdviceUsedIdea(true); setPreparedMix(calculation); setRecentMixContext(currentMixQuestionContext); setMixQuestionContext(currentMixQuestionContext); setQuestion(prompt); setShowAnswerFollowup(true); setFocusHelpQuestion(true); setPage('options') }}
              />
            </div>
            <div hidden={page !== 'costs'}>
              <CostWorkspace
                active={page === 'costs'}
                onGoToPlans={() => setPage('trials')}
                key={w.case_id}
                workspace={w}
                onReportResult={rememberReportResult}
                onChange={update}
                readingKind={adviceKind}
                onReadingKindChange={setAdviceKind}
                showHistoricalIdeas={showHistoricalIdeas}
              />
            </div>
          </main>
        </div>
      )}
      <footer className="pw-footer"><small>Reshivo v{appVersion}</small></footer>
    </div>
  )
}
