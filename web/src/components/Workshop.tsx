import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { BalanceMix } from './BalanceMix'
import { TrialPlan } from './TrialPlan'
import { CaseDetails } from './CaseDetails'
import { AssemblyMassPlanner as WeightAdjustment } from './AssemblyMassPlanner'
import { EngineeringNoteReader } from './EngineeringNoteReader'
import type { EngineeringNotePatch } from '../engineeringNote'
import type {
  AdvisorBrief,
  AdvisorMessage,
  AdvisorResult,
  AdvisorRoute,
  AdvisorStatus,
  AdvisorTrialResult,
  AssemblyObservationFields,
  CalculationDetails,
  WorkshopCase,
} from '../types'
import type { BalancePreset } from './BalancePlanner'
import {
  balanceDemoBrief,
  balanceDemoDetails,
  balanceDemoObservation,
  balanceDemoFields,
} from '../balanceDemo'

const CalculationTools = lazy(() =>
  import('./ProductPlanner').then((module) => ({ default: module.ProductPlanner })),
)
const emptyBrief: AdvisorBrief = {
  input: '',
  variation: '',
  contamination: '',
  product: '',
  use_case: '',
  targets: '',
  process: '',
  available_changes: '',
}
const newCalculationDetails = (): CalculationDetails => ({
  label: '',
  components: [{ id: 1, name: '', role: 'main', amount: '' }],
  amount_unit: 'mass_percent',
  amount_basis: '',
  mass_target_min_kg: '',
  mass_target_max_kg: '',
})
const newAssemblyObservation = (): AssemblyObservationFields => ({
  id: '',
  kind: '',
  mass: '',
  error: '',
  maxAdd: '',
  maxRemove: '',
  adjustmentError: '',
  idealFeedback: false,
})
const counterweightExample: AdvisorBrief = {
  input:
    'Mostly metal dust, with a small portion of cable-plastic residue that might act as a binder. Metal composition and binder identity have not been confirmed.',
  variation:
    'The metal/plastic proportions and particle sizes vary between the material we receive. The range has not been measured yet.',
  contamination:
    'Cable-plastic identity and other contamination are unknown; amounts are not yet measured.',
  product: 'A contained counterweight',
  use_case:
    'A fixed ballast unit with dust contained and a robust outer case. Not for lifting or another safety-critical use.',
  targets:
    'Assembled mass 10 kg ±0.1 kg; contained dust and a durable outer case. Mechanical durability still needs an appropriate check.',
  process:
    'Assembly and weighing at home. No heating of unknown cable plastics. No laboratory or specialist moulding equipment available.',
  available_changes:
    'A rigid enclosure, mechanical containment, adjustable fill compartments, or an appropriate known binder may be considered. Keep dust contained; no open dust sorting at home.',
}
const briefFields: {
  key: keyof AdvisorBrief
  label: string
  placeholder: string
  required?: boolean
  rows?: number
}[] = [
  {
    key: 'input',
    label: 'What you have',
    placeholder: 'Materials, their approximate amounts and the form they arrive in',
    required: true,
    rows: 3,
  },
  {
    key: 'variation',
    label: 'What changes from one input to another',
    placeholder: 'Mix, proportions, particle sizes or anything you can control',
    rows: 2,
  },
  {
    key: 'product',
    label: 'What you want to make',
    placeholder: 'A counterweight, a panel, a fixture, or another product',
    required: true,
  },
  {
    key: 'use_case',
    label: 'How it will be used',
    placeholder: 'Where it goes, what it does and what it must withstand',
    required: true,
    rows: 2,
  },
  {
    key: 'targets',
    label: 'What must it do?',
    placeholder: 'The physical properties and target ranges that matter to you',
    required: true,
    rows: 2,
  },
]
const optionalFields: { key: keyof AdvisorBrief; label: string; placeholder: string }[] = [
  {
    key: 'contamination',
    label: 'Contamination',
    placeholder: 'Name and amount if known. Say unknown when it is unknown.',
  },
  {
    key: 'process',
    label: 'Your equipment and process',
    placeholder: 'Tools, assembly methods and process conditions you can use',
  },
  {
    key: 'available_changes',
    label: 'What you can add or change',
    placeholder:
      'Known binders, fillers, enclosures, sorting, geometry, cost or other restrictions',
  },
]

type Section = 'material' | 'engineering' | 'next'

function RouteCard({
  route,
  selected,
  onSelect,
  onDevelop,
  busy,
}: {
  route: AdvisorRoute
  selected: boolean
  onSelect: () => void
  onDevelop: () => void
  busy: boolean
}) {
  return (
    <article className={`workshop-route${selected ? ' is-selected' : ''}`}>
      <div className="workshop-route-heading">
        <h3>{route.title}</h3>
        <button type="button" aria-pressed={selected} onClick={onSelect} disabled={busy}>
          {selected ? 'Selected' : 'Select route'}
        </button>
      </div>
      <p className="workshop-route-change">{route.change}</p>
      <p>{route.why}</p>
      <details>
        <summary>Steps &amp; trade-offs</summary>
        <ol>
          {route.steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
        {route.tradeoffs.length > 0 && (
          <ul>
            {route.tradeoffs.map((tradeoff, index) => (
              <li key={index}>{tradeoff}</li>
            ))}
          </ul>
        )}
      </details>
      <div className="workshop-route-check">
        <span>Next check</span>
        <p>{route.check}</p>
      </div>
      <button type="button" className="workshop-route-develop" disabled={busy} onClick={onDevelop}>
        Plan a trial <span aria-hidden="true">↗</span>
      </button>
    </article>
  )
}

export function Workshop() {
  const [brief, setBrief] = useState<AdvisorBrief>(emptyBrief)
  const [calculationDetails, setCalculationDetails] =
    useState<CalculationDetails>(newCalculationDetails)
  const [assemblyObservation, setAssemblyObservation] =
    useState<AssemblyObservationFields>(newAssemblyObservation)
  const [balancePreset, setBalancePreset] = useState<BalancePreset | undefined>()
  const caseData: WorkshopCase = { brief, details: calculationDetails }
  const materialKey = JSON.stringify([
    brief.input,
    brief.variation,
    brief.contamination,
    brief.process,
    calculationDetails.components,
    calculationDetails.amount_unit,
    calculationDetails.amount_basis,
  ])
  const [section, setSection] = useState<Section>('material')
  const [focusWorkspace, setFocusWorkspace] = useState(false)
  const [status, setStatus] = useState<AdvisorStatus | null>(null)
  const [statusAttempt, setStatusAttempt] = useState(0)
  const [statusError, setStatusError] = useState('')
  const [plan, setPlan] = useState<AdvisorResult | null>(null)
  const [history, setHistory] = useState<AdvisorMessage[]>([])
  const [question, setQuestion] = useState('')
  const [lastQuestion, setLastQuestion] = useState('')
  const [selectedRoute, setSelectedRoute] = useState<AdvisorRoute | null>(null)
  const [trial, setTrial] = useState<AdvisorTrialResult | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [exampleLoaded, setExampleLoaded] = useState(false)
  const [activity, setActivity] = useState<'routes' | 'trial' | null>(null)
  const busy = activity !== null
  const [elapsed, setElapsed] = useState(0)
  const [toolsOpen, setToolsOpen] = useState(false)
  const request = useRef<AbortController | null>(null)
  const answer = useRef<HTMLElement | null>(null)
  const followup = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setStatusError('')
    api<AdvisorStatus>('/api/advisor/status', undefined, controller.signal)
      .then(setStatus)
      .catch((failure) => {
        if (!controller.signal.aborted)
          setStatusError(failure instanceof Error ? failure.message : 'Meta status could not load.')
      })
    return () => controller.abort()
  }, [statusAttempt])
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (!busy) return
    const start = Date.now()
    setElapsed(0)
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    )
    return () => window.clearInterval(timer)
  }, [busy])
  useEffect(() => {
    if (plan || trial) {
      answer.current?.focus({ preventScroll: true })
      answer.current?.scrollIntoView({ block: 'start' })
    }
  }, [plan, trial])

  function invalidate() {
    request.current?.abort()
    setActivity(null)
    setPlan(null)
    setHistory([])
    setSelectedRoute(null)
    setTrial(null)
    setError('')
    setQuestion('')
    setLastQuestion('')
  }
  function editBrief(key: keyof AdvisorBrief, value: string) {
    if (plan || busy) setNotice('Brief changed. Find updated routes for this case.')
    invalidate()
    setExampleLoaded(false)
    setBalancePreset(undefined)
    if (
      ['input', 'variation', 'contamination', 'process', 'product', 'use_case'].includes(key) &&
      brief[key] !== value
    )
      setAssemblyObservation(newAssemblyObservation())
    setBrief((current) => ({ ...current, [key]: value }))
    if (key === 'input')
      setCalculationDetails((current) => ({
        ...newCalculationDetails(),
        mass_target_min_kg: current.mass_target_min_kg,
        mass_target_max_kg: current.mass_target_max_kg,
        ...(current.balance ? { balance: current.balance } : {}),
      }))
    if (key === 'targets')
      setCalculationDetails((current) => ({
        ...current,
        mass_target_min_kg: '',
        mass_target_max_kg: '',
        ...(current.balance
          ? { balance: { ...current.balance, target_min_mm: '', target_max_mm: '' } }
          : {}),
      }))
  }
  function editCalculationDetails(details: CalculationDetails) {
    if (plan || busy) setNotice('Case details changed. Find updated routes for this case.')
    invalidate()
    setExampleLoaded(false)
    if (
      JSON.stringify([details.components, details.amount_unit, details.amount_basis]) !==
      JSON.stringify([
        calculationDetails.components,
        calculationDetails.amount_unit,
        calculationDetails.amount_basis,
      ])
    ) {
      setAssemblyObservation(newAssemblyObservation())
      setBalancePreset(undefined)
    }
    setCalculationDetails(details)
  }
  function openCaseDetails() {
    setFocusWorkspace(false)
    requestAnimationFrame(() => {
      const details = document.getElementById(
        'case-calculation-details',
      ) as HTMLDetailsElement | null
      if (details) {
        details.open = true
        details.scrollIntoView({ block: 'center' })
        details.querySelector('input')?.focus({ preventScroll: true })
      }
      if (!brief.process.trim()) {
        const processDetails = document.getElementById(
          'case-process-details',
        ) as HTMLDetailsElement | null
        if (processDetails) processDetails.open = true
      }
    })
  }
  function loadExample() {
    invalidate()
    setBalancePreset(undefined)
    setAssemblyObservation(newAssemblyObservation())
    setBrief({ ...counterweightExample })
    setCalculationDetails({
      ...newCalculationDetails(),
      label: 'Hypothetical counterweight case',
      components: [
        { id: 1, name: 'Metal dust (identity unconfirmed)', role: 'main', amount: '' },
        { id: 2, name: 'Cable-plastic residue (polymer unconfirmed)', role: 'binder', amount: '' },
      ],
      mass_target_min_kg: '9.9',
      mass_target_max_kg: '10.1',
    })
    setNotice('')
    setExampleLoaded(true)
    setSection('material')
  }
  function loadBalanceDemo() {
    invalidate()
    setBrief(structuredClone(balanceDemoBrief))
    setCalculationDetails(structuredClone(balanceDemoDetails))
    setAssemblyObservation(structuredClone(balanceDemoObservation))
    setBalancePreset({ serial: Date.now(), fields: structuredClone(balanceDemoFields) })
    setExampleLoaded(false)
    setNotice(
      'Synthetic software example loaded. Its measurements do not describe your waste or a tested product.',
    )
    setSection('engineering')
  }
  function applyEngineeringNote(patch: EngineeringNotePatch) {
    if (
      JSON.stringify([
        calculationDetails.mass_target_min_kg,
        calculationDetails.mass_target_max_kg,
        calculationDetails.balance,
      ]) !==
      JSON.stringify([
        patch.details.mass_target_min_kg,
        patch.details.mass_target_max_kg,
        patch.details.balance,
      ])
    )
      invalidate()
    setCalculationDetails(patch.details)
    setAssemblyObservation(patch.observation)
    setBalancePreset({ serial: Date.now(), fields: patch.fields, source: 'note' })
    setExampleLoaded(false)
    setNotice(
      'Reviewed note applied. The calculations below use this observation and your shared targets.',
    )
  }
  const briefReady = ['input', 'product', 'use_case', 'targets'].every((key) =>
    brief[key as keyof AdvisorBrief].trim(),
  )

  async function ask(nextQuestion = '') {
    if (!briefReady || !status?.configured || busy) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    const submittedQuestion =
      nextQuestion.trim() ||
      'How can I use this variable input to make the product within my targets? Propose practical material and engineering adjustments.'
    const selectedContext: AdvisorMessage | null = trial
      ? {
          role: 'assistant',
          content: [
            `Chosen route: ${trial.selected_route.title}. ${trial.selected_route.change}`,
            `Proposed trial: ${trial.title}. ${trial.objective}`,
            `Targets: ${trial.targets}`,
            `Compare: ${trial.comparison}. Change: ${trial.change}`,
            `Keep fixed: ${trial.keep_fixed.join('; ')}`,
            `Have ready: ${trial.materials.join('; ')}`,
            ...trial.steps.map((step) => `Action: ${step.action} Record: ${step.record}`),
            ...trial.checks.map(
              (check) =>
                `Check ${check.property}: ${check.target}. ${check.method} If outside: ${check.if_outside}`,
            ),
            ...trial.questions,
          ]
            .join('\n')
            .slice(0, 6000),
        }
      : selectedRoute
        ? {
            role: 'assistant',
            content: [
              `Chosen route: ${selectedRoute.title}. ${selectedRoute.change} ${selectedRoute.why}`,
              ...selectedRoute.steps,
              ...selectedRoute.tradeoffs,
              `Next check: ${selectedRoute.check}`,
            ]
              .join('\n')
              .slice(0, 6000),
          }
        : null
    const recentHistory = selectedContext
      ? [...history.slice(-5), selectedContext]
      : history.slice(-6)
    setActivity('routes')
    setError('')
    setNotice('')
    setLastQuestion(nextQuestion.trim())
    try {
      const response = await api<AdvisorResult>(
        '/api/advisor/help',
        {
          brief,
          question: submittedQuestion,
          history: recentHistory,
          calculation_context: calculationDetails,
        },
        controller.signal,
      )
      if (!controller.signal.aborted) {
        setPlan(response)
        const prompt =
          submittedQuestion ||
          'Find practical material and engineering routes for this batch and product.'
        setHistory(() =>
          [
            ...recentHistory,
            { role: 'user', content: prompt } as AdvisorMessage,
            {
              role: 'assistant',
              content: [
                response.answer,
                ...response.material_routes.map(
                  (route) =>
                    `Material route: ${route.title}. ${route.change} ${route.why} Next check: ${route.check}`,
                ),
                ...response.engineering_routes.map(
                  (route) =>
                    `Engineering route: ${route.title}. ${route.change} ${route.why} Next check: ${route.check}`,
                ),
                ...response.next_steps,
              ]
                .join('\n')
                .slice(0, 6000),
            } as AdvisorMessage,
          ].slice(-6),
        )
        setQuestion('')
        setSelectedRoute(null)
        setTrial(null)
        setSection((current) => (current === 'next' ? 'material' : current))
      }
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Meta could not finish this request. Your brief is still here.',
        )
    } finally {
      if (!controller.signal.aborted) setActivity(null)
    }
  }
  function stopWaiting() {
    request.current?.abort()
    setActivity(null)
    setNotice('Stopped waiting. Your brief is still here.')
  }
  function selectRoute(route: AdvisorRoute) {
    if (busy) return
    if (selectedRoute?.id !== route.id) setTrial(null)
    setSelectedRoute(route)
    setError('')
    setNotice('')
  }
  async function planTrial(route: AdvisorRoute) {
    if (!briefReady || !status?.configured || busy) return
    selectRoute(route)
    setSection('next')
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    setActivity('trial')
    setError('')
    setNotice('')
    try {
      const response = await api<AdvisorTrialResult>(
        '/api/advisor/trial',
        { brief, route, calculation_context: calculationDetails },
        controller.signal,
      )
      if (!controller.signal.aborted) {
        if (response.route_id !== route.id)
          throw new Error('The trial did not match the selected route. Your route is still here.')
        setTrial(response)
        setSelectedRoute(response.selected_route)
      }
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Meta could not finish the trial plan. Your selected route is still here.',
        )
    } finally {
      if (!controller.signal.aborted) setActivity(null)
    }
  }
  function download() {
    if (!plan) return
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              brief,
              calculation_details: calculationDetails,
              plan,
              history,
              selected_route: selectedRoute,
              trial,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'rematter-batch-plan.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const routes = plan
    ? section === 'material'
      ? plan.material_routes
      : plan.engineering_routes
    : []
  const chosen = selectedRoute

  return (
    <div className="workshop">
      <div className="workshop-intro">
        <div>
          <p className="workshop-eyebrow">Recycled input. Practical next steps.</p>
          <h1>What can we make from this batch?</h1>
          <p>
            Work through the mix, product design and process together—even when your input changes.
          </p>
        </div>
        <div className="workshop-connection" role="status">
          <span
            className={`workshop-connection-dot${status?.configured ? ' is-configured' : ''}`}
            aria-hidden="true"
          />
          <div>
            <strong>
              {statusError
                ? 'Connection unavailable'
                : status
                  ? status.configured
                    ? 'Meta configured'
                    : 'Meta needs a key'
                  : 'Checking Meta…'}
            </strong>
            {status && <small>{status.model}</small>}
          </div>
          {(statusError || (status && !status.configured)) && (
            <button type="button" onClick={() => setStatusAttempt((attempt) => attempt + 1)}>
              Retry
            </button>
          )}
        </div>
      </div>
      <main className={`workshop-grid${focusWorkspace ? ' is-focused' : ''}`}>
        <aside className="workshop-brief" hidden={focusWorkspace}>
          <div className="workshop-brief-heading">
            <div>
              <p className="workshop-eyebrow">Your case</p>
              <h2>Start with what you have</h2>
            </div>
            <span>01</span>
          </div>
          <button className="workshop-example" type="button" onClick={loadExample}>
            Try a counterweight example <span aria-hidden="true">↗</span>
          </button>
          <button className="workshop-example" type="button" onClick={loadBalanceDemo}>
            Try a synthetic mass-and-balance example <span aria-hidden="true">↗</span>
          </button>
          {exampleLoaded && (
            <p className="workshop-example-note" role="status">
              Hypothetical example loaded. Edit it to fit your batch; these are not material
              measurements.
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void ask()
            }}
          >
            {briefFields.map((field) => (
              <label key={field.key}>
                {field.label}
                {field.rows ? (
                  <textarea
                    rows={field.rows}
                    maxLength={3000}
                    required={field.required}
                    value={brief[field.key]}
                    placeholder={field.placeholder}
                    onChange={(event) => editBrief(field.key, event.target.value)}
                  />
                ) : (
                  <input
                    maxLength={3000}
                    required={field.required}
                    value={brief[field.key]}
                    placeholder={field.placeholder}
                    onChange={(event) => editBrief(field.key, event.target.value)}
                  />
                )}
              </label>
            ))}
            <details className="workshop-constraints" id="case-process-details">
              <summary>Contamination, process & allowed changes</summary>
              {optionalFields.map((field) => (
                <label key={field.key}>
                  {field.label}
                  <textarea
                    rows={2}
                    maxLength={3000}
                    value={brief[field.key]}
                    placeholder={field.placeholder}
                    onChange={(event) => editBrief(field.key, event.target.value)}
                  />
                </label>
              ))}
            </details>
            <CaseDetails details={calculationDetails} onChange={editCalculationDetails} />
            {status && !status.configured && (
              <p className="workshop-help">
                Add a Meta Model API key to the local server configuration, then retry the
                connection. Your brief stays available.
              </p>
            )}
            {statusError && <p className="workshop-error">{statusError}</p>}
            <button
              className="workshop-submit"
              type="submit"
              disabled={!briefReady || !status?.configured || busy}
            >
              {busy ? 'Working through your case…' : 'Find ways to use this batch'}
              <span aria-hidden="true">→</span>
            </button>
            <p className="workshop-submit-note">
              Sends this brief to Meta. You can describe unknowns in plain language.
            </p>
          </form>
        </aside>
        <section
          className="workshop-workspace"
          ref={answer}
          tabIndex={-1}
          aria-label="Batch workspace"
        >
          <nav className="workshop-tabs" aria-label="Workshop sections">
            {(
              [
                { id: 'material', label: 'Material Lab' },
                { id: 'engineering', label: 'Engineering' },
                { id: 'next', label: 'Next run' },
              ] as { id: Section; label: string }[]
            ).map((tab) => (
              <button
                type="button"
                key={tab.id}
                aria-current={section === tab.id ? 'page' : undefined}
                onClick={() => setSection(tab.id)}
              >
                {tab.label}
              </button>
            ))}
            <button
              type="button"
              className="workshop-focus"
              aria-pressed={focusWorkspace}
              onClick={() => setFocusWorkspace((value) => !value)}
            >
              {focusWorkspace ? 'Show case' : 'Focus workspace'}
            </button>
          </nav>
          {focusWorkspace && (
            <p className="workshop-focus-case">
              {brief.product || 'Your case'} · {brief.targets || 'Set targets in your case'}
            </p>
          )}
          {notice && (
            <p className="workshop-notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="workshop-error" role="alert">
              {error}
            </p>
          )}
          {busy && (
            <div className="workshop-working" role="status">
              <span className="workshop-working-dot" aria-hidden="true" />
              <div>
                <strong>
                  {activity === 'trial'
                    ? 'Meta is planning the selected trial'
                    : 'Meta is working through this batch'}
                </strong>
                <p>
                  {activity === 'trial'
                    ? 'Setting out what to change, what to keep fixed and how to check the result.'
                    : 'Comparing material routes, engineering choices and the next useful check.'}{' '}
                  {elapsed}s
                </p>
              </div>
              <button type="button" onClick={stopWaiting}>
                Stop waiting
              </button>
            </div>
          )}
          {!plan ? (
            <div className="workshop-start">
              <span className="workshop-start-mark" aria-hidden="true">
                ↗
              </span>
              <p className="workshop-eyebrow">A route from input to output</p>
              <h2>
                {section === 'material'
                  ? 'Find a useful way forward'
                  : section === 'engineering'
                    ? 'Make the product work with the input'
                    : 'Turn an option into the next run'}
              </h2>
              <p>
                {section === 'material'
                  ? 'Describe the batch and the job. Meta will suggest practical changes to the mix or process, with trade-offs and checks for each route.'
                  : section === 'engineering'
                    ? 'Explore containment, geometry, assembly and adjustment. Product choices can help you work with the variation you have.'
                    : 'Keep the next action small and concrete: what to try, what to observe and what to ask next.'}
              </p>
              {section === 'material' && (
                <p>
                  If plastic is part of the input, what must it do: bind the fill, contain it, or
                  carry a load? The route should fit that job.
                </p>
              )}
              <div className="workshop-start-options">
                <div>
                  <span>01</span>
                  <strong>Adapt the material</strong>
                  <p>Sorting, a known binder, additions or a different process.</p>
                </div>
                <div>
                  <span>02</span>
                  <strong>Engineer around variation</strong>
                  <p>Containment, adjustable fill and product geometry.</p>
                </div>
                <div>
                  <span>03</span>
                  <strong>Choose the next run</strong>
                  <p>A practical sequence and the checks that will inform it.</p>
                </div>
              </div>
              <p className="workshop-start-note">
                Start with your brief or try the counterweight example. No laboratory numbers are
                required to explore routes.
              </p>
            </div>
          ) : (
            <div className="workshop-plan">
              <div className="workshop-plan-heading">
                <div>
                  <span className="workshop-proposal-label">
                    {section === 'next' && trial ? 'Proposed trial' : 'Proposed routes'}
                  </span>
                  <h2>
                    {section === 'material'
                      ? 'Ways to work with this material'
                      : section === 'engineering'
                        ? 'Ways to make the product work'
                        : 'A practical next run'}
                  </h2>
                </div>
                <button type="button" className="workshop-download" onClick={download}>
                  Download plan
                </button>
              </div>
              {section !== 'next' ? (
                <>
                  {lastQuestion && (
                    <p className="workshop-last-question">You asked: {lastQuestion}</p>
                  )}
                  <div className="workshop-answer">
                    {plan.answer
                      .split(/\n\s*\n/)
                      .filter(Boolean)
                      .map((paragraph, index) => (
                        <p key={index}>{paragraph}</p>
                      ))}
                  </div>
                  <div className="workshop-routes">
                    {routes.map((route) => (
                      <RouteCard
                        key={route.id}
                        route={route}
                        selected={selectedRoute?.id === route.id}
                        busy={busy}
                        onSelect={() => selectRoute(route)}
                        onDevelop={() => void planTrial(route)}
                      />
                    ))}
                  </div>
                  {chosen && (
                    <p className="workshop-selected-note">
                      Selected route: <strong>{chosen.title}</strong>.{' '}
                      <button type="button" onClick={() => setSection('next')}>
                        {trial ? 'View trial plan' : 'Open Next run'} →
                      </button>
                    </p>
                  )}
                  <div className="workshop-plan-footer">
                    <span>
                      {plan.live ? 'Generated by Meta' : 'Proposal'} · {plan.model}
                    </span>
                    <span>{(plan.elapsed_ms / 1000).toFixed(1)}s</span>
                  </div>
                  {plan.sources.length > 0 && (
                    <details className="workshop-sources">
                      <summary>References used for context</summary>
                      {plan.sources.map((source) => (
                        <div key={source.id}>
                          <a href={source.url} target="_blank" rel="noreferrer">
                            {source.title} ↗
                          </a>
                          <p>{source.scope}</p>
                        </div>
                      ))}
                      <p>These references do not establish the properties of your own mix.</p>
                    </details>
                  )}
                </>
              ) : (
                <>
                  {trial ? (
                    <TrialPlan trial={trial} />
                  ) : (
                    <div className="workshop-trial-start">
                      {chosen ? (
                        <>
                          <p className="workshop-eyebrow">Selected route</p>
                          <h3>{chosen.title}</h3>
                          <p>{chosen.change}</p>
                          <p>
                            Turn this route into a small comparison: what to change, what to keep
                            the same, what to record and how to check it against your targets.
                          </p>
                          <button
                            type="button"
                            className="outline-button"
                            disabled={busy || !status?.configured}
                            onClick={() => void planTrial(chosen)}
                          >
                            {activity === 'trial' ? 'Planning trial…' : 'Plan a trial'}
                          </button>
                          <p className="workshop-trial-action-note">
                            Sends this brief and selected route to Meta.
                          </p>
                        </>
                      ) : (
                        <>
                          <h3>Choose one route to plan</h3>
                          <p>
                            Pick a material or engineering route first. The trial will stay tied to
                            that choice and your current brief.
                          </p>
                          <div className="workshop-trial-choose">
                            <button type="button" onClick={() => setSection('material')}>
                              Material Lab →
                            </button>
                            <button type="button" onClick={() => setSection('engineering')}>
                              Engineering →
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  <details className="workshop-general-next">
                    <summary>Earlier ideas &amp; open questions</summary>
                    <p>These came from the route exploration, before choosing a trial.</p>
                    <ol className="workshop-next-steps">
                      {plan.next_steps.map((step, index) => (
                        <li key={index}>
                          <span>{String(index + 1).padStart(2, '0')}</span>
                          <p>{step}</p>
                        </li>
                      ))}
                    </ol>
                    {plan.questions.length > 0 && (
                      <ul>
                        {plan.questions.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </details>
                </>
              )}
            </div>
          )}
          <div hidden={section !== 'material'}>
            <BalanceMix key={materialKey} caseData={caseData} onEditCase={openCaseDetails} />
          </div>
          <div hidden={section !== 'engineering'}>
            <EngineeringNoteReader
              caseData={caseData}
              active={section === 'engineering'}
              onApply={applyEngineeringNote}
            />
            <WeightAdjustment
              key={JSON.stringify([materialKey, brief.product, brief.use_case])}
              caseData={caseData}
              onEditCase={openCaseDetails}
              assemblyObservation={assemblyObservation}
              onAssemblyObservationChange={setAssemblyObservation}
              balancePreset={balancePreset}
              active={section === 'engineering'}
            />
          </div>
          <form
            className="workshop-followup"
            onSubmit={(event) => {
              event.preventDefault()
              if (question.trim()) void ask(question)
            }}
          >
            <label htmlFor="workshop-question">Ask Meta about this batch</label>
            <div>
              <input
                id="workshop-question"
                ref={followup}
                value={question}
                maxLength={3000}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder={
                  plan
                    ? 'Compare a route, change a constraint, or ask what to try next…'
                    : 'Ask a question using the brief on the left…'
                }
              />
              <button
                type="submit"
                disabled={!question.trim() || !briefReady || !status?.configured || busy}
              >
                Send <span aria-hidden="true">↑</span>
              </button>
            </div>
            <p>
              Uses your current brief and recent conversation.
              {trial ? ' Includes your selected trial plan.' : ''}
              {plan ? ' Proposed routes still need checks on the actual material and product.' : ''}
            </p>
          </form>
        </section>
      </main>
      <details
        className="workshop-calculations"
        onToggle={(event) => {
          if (event.currentTarget.open) setToolsOpen(true)
        }}
      >
        <summary>
          <span>Calculation tools</span>
          <small>Measured mix mass and published study comparisons</small>
        </summary>
        {toolsOpen && (
          <Suspense fallback={<p>Loading calculation tools…</p>}>
            <CalculationTools
              caseData={caseData}
              onEditCase={openCaseDetails}
              assemblyObservation={assemblyObservation}
              onAssemblyObservationChange={setAssemblyObservation}
            />
          </Suspense>
        )}
      </details>
    </div>
  )
}
