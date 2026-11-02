import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { BalanceMix } from './BalanceMix'
import { TrialPlan } from './TrialPlan'
import { CaseDetails } from './CaseDetails'
import { AssemblyMassPlanner as WeightAdjustment } from './AssemblyMassPlanner'
import { EngineeringNoteReader } from './EngineeringNoteReader'
import { ImageIntake } from './ImageIntake'
import { MeasurementComparison } from './MeasurementComparison'
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
  const [balanceDemoLoaded, setBalanceDemoLoaded] = useState(false)
  const [activity, setActivity] = useState<'routes' | 'trial' | null>(null)
  const busy = activity !== null
  const [elapsed, setElapsed] = useState(0)
  const [toolsOpen, setToolsOpen] = useState(false)
  const request = useRef<AbortController | null>(null)
  const answer = useRef<HTMLElement | null>(null)
  const followup = useRef<HTMLInputElement | null>(null)
  const engineeringChecks = useRef<HTMLDivElement | null>(null)

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
    setBalanceDemoLoaded(false)
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
    setBalanceDemoLoaded(true)
    setNotice(
      'Synthetic software example loaded. Its measurements do not describe your waste or a tested product.',
    )
    setSection('engineering')
  }
  function showSimulatedDecision() {
    setSection('engineering')
    setFocusWorkspace(true)
    requestAnimationFrame(() => {
      const button = Array.from(engineeringChecks.current?.querySelectorAll('button') ?? []).find(
        (candidate) => candidate.textContent?.includes('Compare mass-only and two-location adjustments'),
      )
      if (!button) return
      let details = button.closest('details')
      while (details && engineeringChecks.current?.contains(details)) {
        details.open = true
        details = details.parentElement?.closest('details') ?? null
      }
      button.scrollIntoView({ block: 'center' })
      button.focus({ preventScroll: true })
    })
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
  const missingFields = briefFields.filter((field) => field.required && !brief[field.key].trim())
  const briefReady = missingFields.length === 0
  const mayClearCaseData = Boolean(
    toolsOpen ||
    plan ||
    trial ||
    selectedRoute ||
    balancePreset ||
    calculationDetails.label.trim() ||
    calculationDetails.balance ||
    calculationDetails.amount_basis.trim() ||
    calculationDetails.amount_unit !== 'mass_percent' ||
    calculationDetails.components.length > 1 ||
    calculationDetails.components.some(
      (component) => component.name.trim() || component.amount.trim() || component.role !== 'main',
    ) ||
    Object.values(assemblyObservation).some((value) =>
      typeof value === 'string' ? value.trim() : value === true,
    ),
  )
  function replaceWithExample(load: () => void) {
    const hasCase = Object.values(brief).some((value) => value.trim()) || mayClearCaseData
    if (hasCase && !window.confirm(
      'Loading this example replaces your current case and can clear its mix details, measurements, options and trial. Continue?',
    )) return
    load()
  }

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
    requestAnimationFrame(() =>
      answer.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    )
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
    requestAnimationFrame(() =>
      answer.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    )
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
  const caseStatus = [
    { title: 'Your case', detail: briefReady ? 'Required details added' : 'Details needed', ready: briefReady },
    { title: 'Options', detail: plan ? 'Suggestions available' : 'Not explored yet', ready: Boolean(plan) },
    { title: 'Trial plan', detail: trial ? 'Suggestion available' : 'Not planned yet', ready: Boolean(trial) },
    { title: 'Engineering', detail: 'Tools available', ready: false },
  ]
  const fieldGroups = [
    {
      title: 'Your recycled input',
      detail: 'Tell us what you have and how it changes.',
      fields: briefFields.slice(0, 2),
    },
    {
      title: 'Your desired product',
      detail: 'Tell us what you want to make and what matters.',
      fields: briefFields.slice(2),
    },
  ]

  return (
    <div className="workshop">
      <div className="workshop-intro">
        <div>
          <h1>Turn variable waste into a useful product</h1>
          <p>
            Describe your material and your goal. ReMatter helps you explore what to change, what to
            try, and what to check.
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
      <ul className="workshop-progress" aria-label="Your case at a glance">
        {caseStatus.map((item) => (
            <li key={item.title} className={item.ready ? 'is-ready' : ''}>
              <span className="workshop-progress-dot" aria-hidden="true" />
              <span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
            </li>
        ))}
      </ul>
      <main
        className={`workshop-grid${focusWorkspace ? ' is-focused' : ''}${plan ? ' has-plan' : ''}`}
      >
        <aside className="workshop-brief" hidden={focusWorkspace}>
          <div className="workshop-brief-heading">
            <div>
              <h2>Tell us about your case</h2>
              <p>Start with the four marked fields. Add the rest whenever you are ready.</p>
            </div>
          </div>
          <details className="workshop-examples">
            <summary>Try an example</summary>
            <button className="workshop-example" type="button" onClick={() => replaceWithExample(loadExample)}>
              Explore a counterweight <span aria-hidden="true">↗</span>
            </button>
            <button className="workshop-example" type="button" onClick={() => replaceWithExample(loadBalanceDemo)}>
              Try a synthetic mass-and-balance check <span aria-hidden="true">↗</span>
            </button>
          </details>
          {exampleLoaded && (
            <p className="workshop-example-note" role="status">
              Hypothetical example loaded. Edit it to fit your batch; these are not material
              measurements.
            </p>
          )}
          {balanceDemoLoaded && (
            <div className="workshop-demo-action workshop-demo-mobile">
              <p>Compare a mass-only change with a two-location adjustment in this simulation.</p>
              <button type="button" onClick={showSimulatedDecision}>
                Open the simulated check <span aria-hidden="true">→</span>
              </button>
            </div>
          )}
          {mayClearCaseData && (
            <p className="workshop-edit-warning" role="status">
              Editing the material, its variation, the process or the product can clear recorded
              measurements and plans. Changing “What you have” also clears saved mix details.
              Download anything you need before editing.
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void ask()
            }}
          >
            {fieldGroups.map((group, groupIndex) => (
              <fieldset className="workshop-case-group" key={group.title}>
                <legend>
                  <span>{groupIndex + 1}</span>
                  {group.title}
                </legend>
                <p>{group.detail}</p>
                {groupIndex === 0 && (
                  <ImageIntake
                    brief={brief}
                    mayClearCaseData={mayClearCaseData}
                    onApply={(note) =>
                      editBrief('input', [brief.input.trim(), note].filter(Boolean).join('\n'))
                    }
                  />
                )}
                <div className="workshop-case-fields">
                  {group.fields.map((field) => (
                    <label key={field.key}>
                      <span>
                        {field.label}
                        {field.required && (
                          <span className="workshop-required" aria-hidden="true">
                            {' '}
                            *
                          </span>
                        )}
                      </span>
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
                </div>
              </fieldset>
            ))}
            <details className="workshop-constraints" id="case-process-details">
              <summary>
                Equipment, contamination and other constraints <small>Optional</small>
              </summary>
              {mayClearCaseData && (
                <p className="workshop-edit-warning">
                  Changing contamination or process can clear recorded measurements and plans.
                </p>
              )}
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
              {busy ? 'Working through your case…' : 'Explore options'}
              <span aria-hidden="true">→</span>
            </button>
            {!briefReady && (
              <p className="workshop-required-note" role="status">
                To continue, add:{' '}
                {missingFields
                  .map((field) => field.label.toLowerCase().replace(/\?$/, ''))
                  .join(', ')}
                .
              </p>
            )}
            <p className="workshop-submit-note">
              Your case is sent to Meta when you select Explore options. Describe unknowns in plain
              language.
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
                { id: 'material', label: 'Material options' },
                { id: 'engineering', label: 'Engineering' },
                { id: 'next', label: 'Trial plan' },
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
              {focusWorkspace ? 'Show case' : 'Hide case'}
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
          {balanceDemoLoaded && section === 'engineering' && !focusWorkspace && (
            <div className="workshop-demo-action">
              <p>Compare a mass-only change with a two-location adjustment in this simulation.</p>
              <button type="button" onClick={showSimulatedDecision}>
                Open the simulated check <span aria-hidden="true">→</span>
              </button>
            </div>
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
                  {elapsed}s {elapsed >= 10 && 'This can take up to a minute.'}
                </p>
              </div>
              <button type="button" onClick={stopWaiting}>
                Stop waiting
              </button>
            </div>
          )}
          {!plan ? balanceDemoLoaded && section === 'engineering' ? null : (
            <div className="workshop-start">
              <h2>What happens next?</h2>
              <p>From your case, ReMatter helps you work through three decisions.</p>
              <div className="workshop-start-options">
                <div>
                  <span>2</span>
                  <strong>Compare your options</strong>
                  <p>See ways to adjust the material, process or product, with trade-offs.</p>
                </div>
                <div>
                  <span>3</span>
                  <strong>Plan one trial</strong>
                  <p>Choose an approach and see what to change, observe and check.</p>
                </div>
                <div>
                  <span>4</span>
                  <strong>Check your result</strong>
                  <p>Use your measurements in the available engineering tools.</p>
                </div>
              </div>
              <p className="workshop-start-note">
                Ideas are starting points. Your material and product still need the checks that fit
                your case.
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
              <p className="workshop-proposal-note">
                These are suggested next steps, not measured product performance. Review the
                options and test the one you choose.
              </p>
              {section !== 'next' ? (
                <>
                  {lastQuestion && (
                    <p className="workshop-last-question">You asked: {lastQuestion}</p>
                  )}
                  {!!plan.quarantined_answer?.length && (
                    <p role="status" className="workshop-last-question">
                      An unverified claim about meeting your targets was removed. Review the proposed options and checks before relying on them.
                    </p>
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
                        {trial ? 'View trial plan' : 'Open trial plan'} →
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
                              Material options →
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
            <MeasurementComparison
              caseData={caseData}
              canAsk={Boolean(status?.configured && briefReady && !busy)}
              onAsk={(comparisonQuestion) => { void ask(comparisonQuestion) }}
            />
            <BalanceMix key={materialKey} caseData={caseData} onEditCase={openCaseDetails} />
          </div>
          <div hidden={section !== 'engineering'} ref={engineeringChecks}>
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
                    : 'Ask a question about your case…'
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
