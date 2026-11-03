import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { PromptProjectStart } from './PromptProjectStart'
import { ProviderSettings } from './ProviderSettings'
import { SoundGuidance } from './SoundGuidance'
import { MixAdjustment } from './MixAdjustment'
import { CheckSuggestionHandoff } from './CheckSuggestionHandoff'
import { TrialWorkspace, currentSetups } from './TrialWorkspace'
import { CostWorkspace } from './CostWorkspace'
import { emptyProjectDraft, PROJECT_INTAKE_FIELDS, reviewProjectDraft } from '../projectIntake'
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
import { mixQuestionFingerprint, mixQuestionIsCurrent } from '../mixQuestion'
import { briefFrom } from '../projectBrief'
import { savedGuidanceTexts, safeSetupName } from '../savedGuidanceReview'
import './ProjectWorkbench.css'

const LegacyWorkshop = lazy(() => import('./Workshop').then((m) => ({ default: m.Workshop })))
const FIELD_LABEL: Record<ProjectIntakeField, string> = {
  product: 'What do you want to make?',
  input: 'What materials do you have?',
  use: 'Where and how will it be used?',
  priorities: 'What should it do well?',
  variation: 'What changes in your input?',
  process: 'What tools and processes can you use?',
  constraints: 'Other limits or unknowns',
}
export function ProjectWorkbench() {
  const { system, setSystem } = useUnitSettings()
  const [w, setW] = useState<ProjectWorkspace>(() => newProjectWorkspace())
  const [page, setPage] = useState<
    'start' | 'manual' | 'options' | 'trials' | 'adjust' | 'checks' | 'costs' | 'legacy'
  >('start')
  const [providerOpen, setProviderOpen] = useState(false)
  const [status, setStatus] = useState({
    configured: false,
    provider_name: 'AI provider',
    model: '',
  })
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [notice, setNotice] = useState('')
  const [manual, setManual] = useState<ProjectIntakeDraft>(emptyProjectDraft)
  const [advice, setAdvice] = useState<AdvisorResult | AdvisorFollowupResult | LocalPlanningResult | null>(null)
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
  const [workspaceOpenEpoch, setWorkspaceOpenEpoch] = useState(0)
  const [mixQuestionContext, setMixQuestionContext] = useState<string | null>(null)
  const [previousQuestion, setPreviousQuestion] = useState('')
  const [lastAdviceUsedIdea, setLastAdviceUsedIdea] = useState(false)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [planningMode, setPlanningMode] = useState<{ key: string; planningOnly: boolean; failed: boolean } | null>(null)
  const [savedGuidanceReview, setSavedGuidanceReview] = useState<{ key: string; needsReview: boolean; failed: boolean } | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const request = useRef<AbortController | null>(null)
  const currentProject = JSON.stringify(w.project)
  const currentAdviceContext = JSON.stringify({
    project: w.project,
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
  const planningPayload = {
    brief: briefFrom(w.project),
    question,
    ...(advice && adviceCase === currentAdviceContext && adviceQuestion ? { history: [{ role: 'user', content: adviceQuestion }] } : {}),
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
    void refreshProvider()
    return () => request.current?.abort()
  }, [])
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [page])
  function update(next: ProjectWorkspace) {
    setW(next)
    setNotice('Unsaved changes. Save a project file to keep this work.')
  }
  function apply(d: ProjectIntakeDraft, intake?: ProjectIntakeResult) {
    request.current?.abort()
    if (question.trim()) setPreviousQuestion(question)
    setPreparedCheckName('')
    setMixQuestionContext(null)
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
    const withNote = (project: ProjectWorkspace): ProjectWorkspace =>
      note && (project.advice_notes?.length ?? 0) < 30
        ? { ...project, advice_notes: [...(project.advice_notes ?? []), note] } : project
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
    setPage('options')
    setNotice(
      note && (w.advice_notes?.length ?? 0) >= 30
        ? 'The starting guidance stays onscreen. This project already has thirty saved planning notes, so this reply will not be in the saved file.'
        : changed && w.records.length
        ? 'Project updated. Review the recorded test conditions before checking again.'
        : 'Project details are shared across options, trials, checks and costs. Save a file to keep them.',
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
      setWorkspaceOpenEpoch((epoch) => epoch + 1)
      setPreviousQuestion(question)
      setQuestion('')
      setMixQuestionContext(null)
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
  async function explore(forceOptions = false) {
    if (!modeReady) {
      setError('The local planning check is unavailable. Please try again when the app is connected.')
      return
    }
    if (!mixQuestionIsCurrent(mixQuestionContext, currentMixQuestionContext)) {
      setError('The project, setup or mix inputs changed after this calculation. Recalculate and ask again, or clear the calculation question below.')
      return
    }
    if (!savedReviewReady) {
      setError('The saved ideas could not be checked yet. Please try again.')
      return
    }
    if (selectedIdea && !showHistoricalIdeas) {
      setError('This saved idea is unavailable. Clear it before asking a new question.')
      return
    }
    const configurationsForModel = savedNeedsReview ? w.configurations.map((c) => ({
      ...c, name: safeSetupName(w, c, 'Trial setup'),
      notes: c.notes.startsWith('Unverified trial idea:') ? '' : c.notes,
    })) : w.configurations
    const activeIdea = showHistoricalIdeas ? selectedIdea : null
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
      question.trim() ||
      'Help me choose a practical first approach for this product. Explain the material, preparation, process or design changes I could try and the trade-offs. If I do not know the right performance measurements, help me choose them in plain language. Ask only the essential missing questions.'
    try {
      const result = await api<AdvisorResult | AdvisorFollowupResult | LocalPlanningResult>(
        forceOptions || !question.trim() ? '/api/advisor/help' : '/api/advisor/follow-up',
        {
          brief: briefFrom(w.project),
          question: prompt,
          history:
            advice && adviceCase === currentAdviceContext && adviceQuestion && !lastAdviceUsedIdea && !activeIdea
              ? [
                  { role: 'user', content: adviceQuestion },
                  ...(showCurrentGuidance ? [{ role: 'assistant', content: [advice.answer, ...advice.questions].join('\n').slice(0, 3000) }] : []),
                ]
              : [],
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
        setAdvice(result)
        setStartingGuidance(null)
        setLastAdviceUsedIdea(Boolean(activeIdea))
        setSelectedIdea(null)
        setAdviceCase(currentAdviceContext)
        setAdviceProject(currentProject)
        setAdviceQuestion(prompt)
        const noteId = crypto.randomUUID()
        setAdviceNoteId((w.advice_notes?.length ?? 0) < 30 ? noteId : null)
        const text = [
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
                  },
                ],
              }
            : current,
        )
        setNotice(
          (w.advice_notes?.length ?? 0) >= 30
            ? 'This reply remains onscreen. The project already contains thirty saved planning notes.'
            : result.result_kind==='local_planning_guidance'?'Local planning guidance retained. Save the project file to keep it.':'Planning reply retained as a proposal. Save the project file to keep it.',
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
    if (!advice) return
    const noteId =
      adviceNoteId && w.advice_notes?.some((note) => note.id === adviceNoteId) ? adviceNoteId : null
    const idea = {
      title: r.title,
      change: r.change,
      why: r.why,
      steps: [...r.steps],
      tradeoffs: [...r.tradeoffs],
      check: r.check,
      provider: advice.provider,
      model: advice.model,
      ...(noteId ? { note_id: noteId } : {}),
    }
    update({
      ...w,
      configurations: [...w.configurations, next],
      trial_ideas: { ...w.trial_ideas, [`${next.id}@${next.revision}`]: idea },
    })
    setPage('trials')
  }
  function askAboutIdea(configuration: TrialConfiguration, idea: TrialIdea) {
    if (question.trim()) setPreviousQuestion(question)
    setMixQuestionContext(null)
    setSelectedIdea({
      caseId: w.case_id,
      key: `${configuration.id}@${configuration.revision}`,
      idea: structuredClone(idea),
    })
    setQuestion('How could I use this idea for my current setup, and what needs checking?')
    setPage('options')
  }
  function save() {
    try {
      downloadProjectWorkspace(w)
      setNotice(
        'Project file saved. It contains your entered inputs; API keys are kept separately on this computer.',
      )
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const hasProject = Boolean(w.project.product || w.project.input)
  return (
    <div className="project-workbench">
      <header className="pw-header">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            setPage(hasProject ? 'options' : 'start')
          }}
          className="pw-brand"
        >
          ReMatter<span>Your upcycling engineer</span>
        </a>
        <div className="pw-header-actions">
          <button onClick={() => setProviderOpen(true)}>
            {statusLoaded && status.configured ? status.provider_name : 'AI provider'}
            <span aria-hidden="true">⌄</span>
          </button>
          <details
            onClick={(e) => {
              if ((e.target as Element).closest('button')) e.currentTarget.removeAttribute('open')
            }}
          >
            <summary>Menu</summary>
            <div className="pw-menu">
              <button onClick={() => file.current?.click()}>Open project</button>
              <button onClick={save}>Save project</button>
              <button
                onClick={() => {
                  try {
                    downloadProjectWorkspace(w)
                    request.current?.abort()
                    setBusy(false)
                    setW(newProjectWorkspace())
                    setPreparedCheckName('')
                    setPreviousQuestion(question)
                    setMixQuestionContext(null)
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
                  New trial amounts and supported mass calculations use this display. Existing trial
                  amounts, readings, prices and geometry retain their entered units.
                </p>
              </details>
              <button onClick={() => setPage('legacy')}>
                Earlier workspace &amp; detailed tools
              </button>
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
      {error && (
        <div className="pw-global-error" role="alert">
          {error}
        </div>
      )}
      {page === 'start' ? (
        <PromptProjectStart
          key={w.case_id + currentProject}
          initialDraft={hasProject ? w.project : undefined}
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
              disabled={!manual.product?.value || !manual.input?.value}
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
        <div className="pw-layout">
          <aside className="pw-project-rail">
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
              {currentSetups(w.configurations).length} current trial setup(s) · {w.checks.length}{' '}
              product check(s)
            </small>
          </aside>
          <main className="pw-main">
            <div className="pw-topbar">
              <nav aria-label="Project workspace">
                {(['options', 'trials', 'adjust', 'checks', 'costs'] as const).map((k) => (
                  <button
                    key={k}
                    aria-current={page === k ? 'page' : undefined}
                    onClick={() => setPage(k)}
                  >
                    {k === 'options'
                      ? '1. Options'
                      : k === 'trials'
                        ? '2. Trials'
                      : k === 'adjust'
                          ? '3. Adjust mix'
                          : k === 'checks'
                            ? '4. Checks'
                            : '5. Costs'}
                  </button>
                ))}
              </nav>
              <div className="pw-actions">
                <button onClick={() => file.current?.click()}>Open</button>
                <button onClick={save}>Save</button>
              </div>
            </div>
            {page === 'options' && (
              <section className="pw-section">
                <div className="pw-section-heading">
                  <div>
                    <h1>Find a way to use what you have</h1>
                    <p>
                      Explore changes to the materials, preparation, process or product design. Then
                      keep a trial setup to compare.
                    </p>
                  </div>
                </div>
                <section className="pw-card">
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
                    What would you like help with?
                    <textarea
                      value={question}
                      maxLength={3000}
                      onChange={(e) => { setQuestion(e.target.value); if (!e.target.value.trim()) setMixQuestionContext(null) }}
                      placeholder="For example: How can I make a comfortable mat from these pieces? What could I change if it does not hold together?"
                    />
                  </label>
                  {mixQuestionContext && <div className="pw-notice">
                    <p>This question includes a mix calculation. If its project, setup or inputs change, recalculate before sending it.</p>
                    <button type="button" onClick={() => { setPreviousQuestion(question); setQuestion(''); setMixQuestionContext(null) }}>Clear calculation question</button>
                  </div>}
                  {showHistoricalIdeas && previousQuestion && <details>
                    <summary>Previous question kept for reference</summary>
                    <p className="pw-saved-note">{previousQuestion}</p>
                    <small>This text is not sent with the current question.</small>
                  </details>}
                  <div className="pw-actions">
                    <button className="pw-primary" onClick={() => void explore()} disabled={busy || !modeReady || !savedReviewReady}>
                      {busy
                        ? 'Working through your options…'
                        : question.trim()
                          ? 'Ask this question'
                          : 'Explore my options'}
                    </button>
                    {question.trim() && (
                      <button disabled={busy || !modeReady || !savedReviewReady} onClick={() => void explore(true)}>
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
                      : 'Some requests need an AI connection. Local planning and calculations can work without one.'}
                  </small>
                  <details><summary>What is sent to my AI provider?</summary>
                    <small>Your current setups, selected readings, entered costs and any idea shown above. Local calculations stay on this computer.</small>
                  </details>
                  {planningMode?.key === planningKey && planningMode.failed && <p role="alert">The local planning check is unavailable. Reopen the app and try again.</p>}
                  {modeReady && planningMode?.planningOnly && <p className="pw-notice">Earlier AI ideas are kept but hidden while this material needs local planning.</p>}
                  {savedNeedsReview && <p className="pw-notice">Some saved ideas are unavailable. You can still explore new options.</p>}
                  {savedGuidanceReview?.key === savedReviewKey && savedGuidanceReview.failed && <p role="alert">Saved suggestions could not be checked. Reopen the project and try again.</p>}
                </section>
                <SoundGuidance project={w.project} question={question} />
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
                  </section>
                )}
                {modeReady && advice && adviceProject === currentProject && (showCurrentGuidance || advice.result_kind === 'local_planning_guidance') && (
                  <>
                    {adviceCase !== currentAdviceContext && (
                      <p className="pw-notice">
                        These suggestions were made before your latest setup, check or cost changes.
                        Ask again to include the new information.
                      </p>
                    )}
                    <section className="pw-answer" aria-live="polite">
                      <span className="pw-overline">
                        {advice.result_kind==='local_planning_guidance'?'Local planning guide · no AI call':`Proposed next steps · ${advice.provider} / ${advice.model}`}
                      </span>
                      {advice.answer
                        .split('\n')
                        .filter(Boolean)
                        .map((p, i) => (
                          <p key={i}>{p}</p>
                        ))}
                      <h2>What to do next</h2>
                      <ol>
                        {advice.next_steps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                      <button onClick={() => setPage('trials')}>
                        Record or update a trial setup
                      </button>
                      {advice.questions.length > 0 && (
                        <div className="pw-question-box">
                          <h2>To make the next step useful</h2>
                          <ul>
                            {advice.questions.map((q, i) => (
                              <li key={i}>{q}</li>
                            ))}
                          </ul>
                          <button
                            onClick={() => {
                              setQuestion('')
                              setMixQuestionContext(null)
                              document
                                .querySelector<HTMLTextAreaElement>('.pw-main textarea')
                                ?.focus()
                            }}
                          >
                            Answer or ask above
                          </button>
                        </div>
                      )}
                    </section>
                    {'material_routes' in advice &&
                      [
                        { title: 'Materials and preparation', routes: advice.material_routes },
                        { title: 'Shape and assembly', routes: advice.engineering_routes },
                      ].map((group) => (
                        <section key={group.title}>
                          <h2>{group.title}</h2>
                          <div className="pw-card-grid">
                            {group.routes.map((r) => (
                              <article key={r.id} className="pw-card">
                                <h3>{r.title}</h3>
                                <p>{r.change}</p>
                                <p className="pw-muted">{r.why}</p>
                                <ol>
                                  {r.steps.map((s, i) => (
                                    <li key={i}>{s}</li>
                                  ))}
                                </ol>
                                <details>
                                  <summary>Trade-offs and next check</summary>
                                  <ul>
                                    {r.tradeoffs.map((t, i) => (
                                      <li key={i}>{t}</li>
                                    ))}
                                  </ul>
                                  <CheckSuggestionHandoff suggestion={r.check} onPrepare={(name) => { setPreparedCheckName(name); setPage('checks') }} />
                                </details>
                                <button onClick={() => useRoute(r)}>Keep as a trial idea</button>
                              </article>
                            ))}
                          </div>
                        </section>
                      ))}
                  </>
                )}
                {visibleSavedNotes.length > 0 && (
                  <details className="pw-card pw-spaced">
                    <summary>Saved planning notes ({visibleSavedNotes.length})</summary>
                    <p>Ideas saved with earlier project details.</p>
                    {visibleSavedNotes.map((note) => (
                      <details key={note.id}>
                        <summary>
                          {note.project_snapshot.product?.value ?? 'Project'} · {note.kind==='local_guidance'?'Local planning guide':`${note.provider} / ${note.model}`} · {note.created_at.slice(0, 16).replace('T', ' ')} UTC
                        </summary>
                        <p className="pw-saved-note">{note.text}</p>
                      </details>
                    ))}
                  </details>
                )}
              </section>
            )}
            <div hidden={page !== 'trials' && page !== 'checks'}>
              <TrialWorkspace
                key={`${w.case_id}:${workspaceOpenEpoch}`}
                workspace={w}
                onChange={update}
                section={page === 'trials' ? 'trials' : 'checks'}
                readingKind={adviceKind}
                onReadingKindChange={setAdviceKind}
                onAskIdea={askAboutIdea}
                showHistoricalIdeas={showHistoricalIdeas}
                checkingPlanningMode={!modeReady || !savedReviewReady}
                preparedCheckName={showCurrentGuidance ? preparedCheckName : ''}
                onPreparedCheckUsed={() => setPreparedCheckName('')}
              />
            </div>
            <div hidden={page !== 'adjust'}>
              <MixAdjustment
                key={`${w.case_id}:${workspaceOpenEpoch}`}
                workspace={w}
                enabled={Boolean(modeReady && !planningMode?.planningOnly)}
                showHistoricalIdeas={showHistoricalIdeas}
                planningContext={planningPayload}
                onDraftChange={(updateDraft) => {
                  setW((current) => updateDraft(current))
                  setNotice('Unsaved changes. Save a project file to keep this work.')
                }}
                onDiscuss={(prompt) => { if (question.trim()) setPreviousQuestion(question); setSelectedIdea(null); setLastAdviceUsedIdea(true); setMixQuestionContext(currentMixQuestionContext); setQuestion(prompt); setPage('options') }}
              />
            </div>
            <div hidden={page !== 'costs'}>
              <CostWorkspace
                key={w.case_id}
                workspace={w}
                onChange={update}
                readingKind={adviceKind}
                onReadingKindChange={setAdviceKind}
                showHistoricalIdeas={showHistoricalIdeas}
              />
            </div>
          </main>
        </div>
      )}
      <footer className="pw-footer"><small>Test your product before production.</small></footer>
    </div>
  )
}
