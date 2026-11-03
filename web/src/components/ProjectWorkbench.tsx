import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { PromptProjectStart } from './PromptProjectStart'
import { ProviderSettings } from './ProviderSettings'
import { TrialWorkspace, currentSetups } from './TrialWorkspace'
import { CostWorkspace } from './CostWorkspace'
import { emptyProjectDraft, PROJECT_INTAKE_FIELDS, reviewProjectDraft } from '../projectIntake'
import type { ProjectIntakeDraft, ProjectIntakeField } from '../projectIntake'
import {
  newProjectWorkspace,
  parseProjectWorkspace,
  downloadProjectWorkspace,
  PROJECT_WORKSPACE_MAX_BYTES,
} from '../projectWorkspace'
import type { ProjectWorkspace } from '../projectWorkspace'
import type { AdvisorBrief, AdvisorResult, AdvisorFollowupResult, AdvisorRoute } from '../types'
import { useUnitSettings } from '../units'
import { costRequest } from '../manufacturingCost'
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
function briefFrom(d: ProjectIntakeDraft): AdvisorBrief {
  return {
    product: d.product?.value ?? 'Product not specified',
    input: d.input?.value ?? 'Materials not specified',
    use_case: d.use?.value ?? 'Use not specified',
    targets: d.priorities?.value ?? 'Requirements not yet set; help choose suitable checks',
    variation: d.variation?.value ?? '',
    process: d.process?.value ?? '',
    contamination: 'Not separately characterized. Do not infer contaminant identity or amount.',
    available_changes: d.constraints?.value ?? '',
  }
}
export function ProjectWorkbench() {
  const { system, setSystem } = useUnitSettings()
  const [w, setW] = useState<ProjectWorkspace>(() => newProjectWorkspace())
  const [page, setPage] = useState<
    'start' | 'manual' | 'options' | 'trials' | 'checks' | 'costs' | 'legacy'
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
  const [advice, setAdvice] = useState<AdvisorResult | AdvisorFollowupResult | null>(null)
  const [adviceCase, setAdviceCase] = useState('')
  const [adviceQuestion, setAdviceQuestion] = useState('')
  const [adviceKind, setAdviceKind] = useState<'user_reported' | 'synthetic'>('user_reported')
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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
    adviceKind,
  })
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
  function apply(d: ProjectIntakeDraft) {
    request.current?.abort()
    request.current = null
    setBusy(false)
    const changed = JSON.stringify(d) !== currentProject
    if (w.project.product?.value !== d.product?.value && w.configurations.length) {
      try {
        downloadProjectWorkspace(w)
        setW(newProjectWorkspace(reviewProjectDraft(d)))
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
    setW({
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
    })
    setAdvice(null)
    setQuestion('')
    setPage('options')
    setNotice(
      changed && w.records.length
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
      setAdvice(null)
      setPage('trials')
      setNotice(
        'Project opened. Review imported reading conditions before recalculating; saved files contain inputs, not verified results.',
      )
      setError('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      e.target.value = ''
    }
  }
  async function explore(forceOptions = false) {
    if (!status.configured) {
      setProviderOpen(true)
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
      const result = await api<AdvisorResult | AdvisorFollowupResult>(
        forceOptions || !question.trim() ? '/api/advisor/help' : '/api/advisor/follow-up',
        {
          brief: briefFrom(w.project),
          question: prompt,
          history:
            advice && adviceCase === currentAdviceContext
              ? [
                  { role: 'user', content: adviceQuestion },
                  {
                    role: 'assistant',
                    content: [advice.answer, ...advice.questions].join('\n').slice(0, 3000),
                  },
                ]
              : [],
          ...(w.configurations.length
            ? {
                project_context: {
                  case_id: w.case_id,
                  configurations: w.configurations,
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
        },
        controller.signal,
      )
      if (request.current === controller && !controller.signal.aborted) {
        setAdvice(result)
        setAdviceCase(currentAdviceContext)
        setAdviceQuestion(prompt)
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
                    id: crypto.randomUUID(),
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
                    kind: 'model_proposal',
                  },
                ],
              }
            : current,
        )
        setNotice(
          (w.advice_notes?.length ?? 0) >= 30
            ? 'This reply remains onscreen. The project already contains thirty saved planning notes.'
            : 'Planning reply retained as a proposal. Save the project file to keep it.',
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
    const text = w.project.input?.value ?? ''
    const next = {
      id: crypto.randomUUID(),
      revision: 1,
      name: r.title,
      materials: [
        {
          id: crypto.randomUUID(),
          name: text.length <= 160 ? text : '',
          amount: '',
          unit: system === 'us' ? 'lb' : 'kg',
        },
      ],
      process: w.project.process?.value ?? '',
      geometry: '',
      notes: `Unverified trial idea: ${r.title}. Full proposed steps and trade-offs remain in Options. Record the actual materials, process and shape before treating this as a planned setup.`,
    }
    update({ ...w, configurations: [...w.configurations, next] })
    setPage('trials')
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
                    setAdvice(null)
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
                  New trial amounts
                  <select
                    value={system}
                    onChange={(e) => setSystem(e.target.value as typeof system)}
                  >
                    <option value="metric">Metric (kg)</option>
                    <option value="us">US customary (lb)</option>
                  </select>
                </label>
                <p>
                  Existing trial amounts, readings, prices and geometry retain their entered units.
                  Earlier mass and balance tools convert their displays.
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
                {(['options', 'trials', 'checks', 'costs'] as const).map((k) => (
                  <button
                    key={k}
                    aria-current={page === k ? 'page' : undefined}
                    onClick={() => setPage(k)}
                  >
                    {k === 'options'
                      ? '1. Options'
                      : k === 'trials'
                        ? '2. Trials'
                        : k === 'checks'
                          ? '3. Checks'
                          : '4. Costs'}
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
                      <small>
                        Current setup versions only. Excluded records are not used. No physical
                        result is predicted.
                      </small>
                    </label>
                  )}
                  <label>
                    What would you like help with?
                    <textarea
                      value={question}
                      maxLength={3000}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="For example: How can I make a comfortable mat from these pieces? What could I change if it does not hold together?"
                    />
                  </label>
                  <div className="pw-actions">
                    <button className="pw-primary" onClick={() => void explore()} disabled={busy}>
                      {busy
                        ? 'Working through your options…'
                        : question.trim()
                          ? 'Ask this question'
                          : 'Explore my options'}
                    </button>
                    {question.trim() && (
                      <button disabled={busy} onClick={() => void explore(true)}>
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
                      : 'Choose an AI connection to get planning help. You can record trials and calculations without it.'}
                  </small>
                  <small>
                    Asking sends this project’s current setups, selected readings and entered cost
                    records to the chosen provider. Calculations alone stay local.
                  </small>
                </section>
                {advice && adviceCase === currentAdviceContext && (
                  <>
                    <section className="pw-answer" aria-live="polite">
                      <span className="pw-overline">
                        Proposed next steps · {advice.provider} / {advice.model}
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
                                  <p>{r.check}</p>
                                </details>
                                <button onClick={() => useRoute(r)}>Keep as a trial idea</button>
                              </article>
                            ))}
                          </div>
                        </section>
                      ))}
                    <p className="pw-muted">
                      These are proposals, not tested recipes or product results. Numeric checks use
                      only the readings you enter.
                    </p>
                  </>
                )}
                {advice && adviceCase !== currentAdviceContext && (
                  <p className="pw-notice">
                    Your setups, checks or costs have changed. Ask above to include them in the next
                    reply. Earlier suggestions remain in Saved planning notes.
                  </p>
                )}
                {(w.advice_notes?.length ?? 0) > 0 && (
                  <details className="pw-card pw-spaced">
                    <summary>Saved planning notes ({w.advice_notes!.length})</summary>
                    <p>
                      Historical model proposals, not measurements. Review them against the current
                      project before acting.
                    </p>
                    {w.advice_notes!.map((note) => (
                      <details key={note.id}>
                        <summary>
                          {note.project_snapshot.product?.value ?? 'Project'} · {note.provider} /{' '}
                          {note.model} · {note.created_at.slice(0, 16).replace('T', ' ')} UTC
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
                key={w.case_id}
                workspace={w}
                onChange={update}
                section={page === 'trials' ? 'trials' : 'checks'}
              />
            </div>
            <div hidden={page !== 'costs'}>
              <CostWorkspace key={w.case_id} workspace={w} onChange={update} />
            </div>
          </main>
        </div>
      )}
    </div>
  )
}
