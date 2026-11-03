import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { BalanceMix } from './BalanceMix'
import { TrialPlan } from './TrialPlan'
import { CaseDetails } from './CaseDetails'
import { AssemblyMassPlanner as WeightAdjustment } from './AssemblyMassPlanner'
import { EngineeringNoteReader } from './EngineeringNoteReader'
import { ImageIntake } from './ImageIntake'
import { MeasurementComparison } from './MeasurementComparison'
import type { MeasurementProgress } from './MeasurementComparison'
import { WorkspaceFiles } from './WorkspaceFiles'
import { FollowupAdvice } from './FollowupAdvice'
import { MaterialCaseSummary } from './MaterialCaseSummary'
import { useUnitSettings } from '../units'
import type { CompositionDraft, MeasurementDraft, SavedWorkspace } from '../workspaceFile'
import './WorkshopDecision.css'
import type { EngineeringNotePatch } from '../engineeringNote'
import type {
  AdvisorBrief,
  AdvisorFollowupResult,
  AdvisorMessage,
  AdvisorResult,
  AdvisorRoute,
  AdvisorStatus,
  AdvisorTrialResult,
  AssemblyObservationFields,
  CalculationDetails,
  MeasuredCompositionTrial,
  WorkshopCase,
} from '../types'
import type { BalancePreset } from './BalancePlanner'

const CalculationTools = lazy(() =>
  import('./ProductPlanner').then((module) => ({ default: module.ProductPlanner })),
)
const PublishedBlend = lazy(() =>
  import('./TestedLevels').then((module) => ({ default: module.TestedLevels })),
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
const planterExample: AdvisorBrief = {
  input:
    'Identified post-consumer polyethylene (PCRPE) resin and an identified virgin MDPE resin. Exact grades and current proportions still need to be recorded.',
  variation:
    'The recycled-content proportion can change. Moisture, contamination and differences between supply lots have not been characterized.',
  contamination:
    'No named contaminant amount has been measured. Do not assume the recycled resin is contamination-free.',
  product: 'A non-load-bearing planter sleeve — material development case',
  use_case:
    'An outer decorative sleeve around a separate watertight plant pot. The liner supports the soil and water. Sleeve geometry and outdoor exposure are not yet specified.',
  targets:
    'Material-development screen: tensile yield stress at least 25 MPa, using a stated specimen and method. This is a chosen screening threshold, not a measured planter requirement. Sleeve fit, creep and weathering targets still need to be set.',
  process:
    'Planning from home; no resin processing or tensile-testing equipment here. Any moulding and testing trial requires a suitable facility and a recorded process.',
  available_changes:
    'The recycled-to-virgin PE proportion, preparation and sleeve geometry may be considered. Keep proposed material trials separate from the finished-product checks. Do not transfer published specimen values to my resin.',
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

function sameRoute(left: AdvisorRoute | null, right: AdvisorRoute | null): boolean {
  if (!left || !right) return false
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.change === right.change &&
    left.why === right.why &&
    left.check === right.check &&
    (['steps', 'tradeoffs'] as const).every(
      (key) =>
        left[key].length === right[key].length &&
        left[key].every((value, index) => value === right[key][index]),
    )
  )
}

function RouteCard({
  route,
  selected,
  onSelect,
  onDevelop,
  actionLabel = 'Plan a trial',
  busy,
}: {
  route: AdvisorRoute
  selected: boolean
  onSelect: () => void
  onDevelop: () => void
  actionLabel?: string
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
      <details>
        <summary>Why this may help &amp; how to try it</summary>
        <p>{route.why}</p>
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
        {actionLabel} <span aria-hidden="true">↗</span>
      </button>
    </article>
  )
}

export function Workshop() {
  const { system: unitSystem, setSystem: setUnitSystem } = useUnitSettings()
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0)
  const [restoredDrafts, setRestoredDrafts] = useState<{
    measurement: MeasurementDraft | null
    mix: CompositionDraft | null
  }>({ measurement: null, mix: null })
  const [restoredPlan, setRestoredPlan] = useState(false)
  const [restoredTrial, setRestoredTrial] = useState(false)
  const [restoredFollowup, setRestoredFollowup] = useState(false)
  const measurementSnapshot = useRef<MeasurementDraft | null>(null)
  const mixSnapshot = useRef<CompositionDraft | null>(null)
  const [measurementProgress, setMeasurementProgress] = useState<MeasurementProgress>('empty')
  const recordMeasurementSnapshot = useCallback(
    (draft: MeasurementDraft, progress: MeasurementProgress) => {
      measurementSnapshot.current = draft
      setMeasurementProgress(progress)
    },
    [],
  )
  const recordMixSnapshot = useCallback((draft: CompositionDraft) => {
    mixSnapshot.current = draft
  }, [])
  const [brief, setBrief] = useState<AdvisorBrief>(emptyBrief)
  const [calculationDetails, setCalculationDetails] =
    useState<CalculationDetails>(newCalculationDetails)
  const [assemblyObservation, setAssemblyObservation] =
    useState<AssemblyObservationFields>(newAssemblyObservation)
  const [balancePreset, setBalancePreset] = useState<BalancePreset | undefined>()
  const [compositionTrial, setCompositionTrial] = useState<MeasuredCompositionTrial | null>(null)
  const compositionSerial = useRef(0)
  const compositionArea = useRef<HTMLDivElement | null>(null)
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
  const [mixMode, setMixMode] = useState(false)
  const [editingCase, setEditingCase] = useState(true)
  const [focusWorkspace, setFocusWorkspace] = useState(false)
  const [status, setStatus] = useState<AdvisorStatus | null>(null)
  const [statusAttempt, setStatusAttempt] = useState(0)
  const [statusError, setStatusError] = useState('')
  const [plan, setPlan] = useState<AdvisorResult | null>(null)
  const [followupResult, setFollowupResult] = useState<AdvisorFollowupResult | null>(null)
  const [history, setHistory] = useState<AdvisorMessage[]>([])
  const [question, setQuestion] = useState('')
  const [lastQuestion, setLastQuestion] = useState('')
  const [selectedRoute, setSelectedRoute] = useState<AdvisorRoute | null>(null)
  const [trial, setTrial] = useState<AdvisorTrialResult | null>(null)
  const [hasTrialFollowup, setHasTrialFollowup] = useState(false)
  const [comparisonAdviceStale, setComparisonAdviceStale] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [exampleLoaded, setExampleLoaded] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [activity, setActivity] = useState<'routes' | 'trial' | 'followup' | null>(null)
  const busy = activity !== null
  const [elapsed, setElapsed] = useState(0)
  const [toolsOpen, setToolsOpen] = useState(false)
  const request = useRef<AbortController | null>(null)
  const comparisonRequest = useRef<AbortController | null>(null)
  const comparisonAdviceShown = useRef(false)
  const answer = useRef<HTMLElement | null>(null)
  const caseArea = useRef<HTMLElement | null>(null)
  const followup = useRef<HTMLInputElement | null>(null)
  const comparisonArea = useRef<HTMLDivElement | null>(null)

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
  useEffect(() => { if (!editingCase && caseArea.current) caseArea.current.scrollTop = 0 }, [editingCase])
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
    if (plan || trial || followupResult) {
      answer.current?.focus({ preventScroll: true })
      answer.current?.scrollIntoView({ block: 'start' })
    }
  }, [plan, trial, followupResult])

  function invalidate() {
    setMixMode(false)
    setEditingCase(true)
    setRestoredDrafts({ measurement: null, mix: null })
    setRestoredPlan(false)
    setRestoredTrial(false)
    setRestoredFollowup(false)
    setFollowupResult(null)
    setCompositionTrial(null)
    comparisonRequest.current = null
    comparisonAdviceShown.current = false
    setComparisonAdviceStale(false)
    request.current?.abort()
    setActivity(null)
    setPlan(null)
    setHistory([])
    setSelectedRoute(null)
    setTrial(null)
    setHasTrialFollowup(false)
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
    setEditingCase(true)
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
  function loadPlanterExample() {
    invalidate()
    setBalancePreset(undefined)
    setAssemblyObservation(newAssemblyObservation())
    setBrief({ ...planterExample })
    setCalculationDetails({
      ...newCalculationDetails(),
      label: 'Hypothetical PE material-development case',
      components: [
        { id: 1, name: 'Identified PCRPE resin (grade to record)', role: 'main', amount: '' },
        {
          id: 2,
          name: 'Identified virgin MDPE resin (grade to record)',
          role: 'other',
          amount: '',
        },
      ],
    })
    setNotice('')
    setExampleLoaded(true)
    setSection('material')
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
    if (
      hasCase &&
      !window.confirm(
        'Loading this example replaces your current case and can clear its mix details, measurements, options and trial. Continue?',
      )
    )
      return
    load()
  }

  function comparisonDraftChanged() {
    setCompositionTrial(null)
    invalidateComparisonAdvice()
  }
  function invalidateComparisonAdvice() {
    const pending = comparisonRequest.current
    if (pending && request.current === pending && !pending.signal.aborted) {
      pending.abort()
      comparisonRequest.current = null
      setActivity(null)
      setNotice(
        'Your inputs or readings changed. Stopped the request that used the previous calculation. Check the current values before asking again.',
      )
    }
    if (comparisonAdviceShown.current) {
      setComparisonAdviceStale(true)
      setHasTrialFollowup(false)
    }
  }

  async function ask(
    nextQuestion = '',
    preserveSelectedTrial = Boolean(nextQuestion.trim() && (selectedRoute || trial)),
    displayQuestion = nextQuestion.trim(),
    fromComparison = false,
  ) {
    if (!briefReady || !status?.configured || busy) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    const usesComparisonContext =
      fromComparison ||
      Boolean(nextQuestion.trim() && (comparisonAdviceShown.current || comparisonAdviceStale))
    comparisonRequest.current = usesComparisonContext ? controller : null
    if (fromComparison) {
      setHasTrialFollowup(false)
    }
    const submittedQuestion =
      nextQuestion.trim() ||
      'How can I use this variable input to make the product within my targets? Propose practical material and engineering adjustments.'
    const isFollowup = Boolean(nextQuestion.trim())
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
    const earlierHistory: AdvisorMessage[] = !nextQuestion.trim()
      ? []
      : comparisonAdviceStale
        ? [
            ...history.slice(-4),
            {
              role: 'assistant',
              content:
                'Earlier comparison or mix-trial advice is no longer current because the inputs changed. Do not treat its settings or quantities as current; a newly confirmed comparison or recalculated trial summary is needed.',
            },
          ]
        : history
    const recentHistory = selectedContext
      ? [...earlierHistory.slice(-5), selectedContext]
      : earlierHistory.slice(-6)
    setActivity(isFollowup ? 'followup' : 'routes')
    requestAnimationFrame(() =>
      answer.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    )
    setError('')
    setNotice('')
    try {
      const response = await api<AdvisorResult | AdvisorFollowupResult>(
        isFollowup ? '/api/advisor/follow-up' : '/api/advisor/help',
        {
          brief,
          question: submittedQuestion,
          history: recentHistory,
          calculation_context: calculationDetails,
        },
        controller.signal,
      )
      if (!controller.signal.aborted) {
        setEditingCase(false)
        comparisonAdviceShown.current = usesComparisonContext
        setComparisonAdviceStale(
          fromComparison ? false : usesComparisonContext && comparisonAdviceStale,
        )
        setLastQuestion(displayQuestion.trim())
        if (response.result_kind === 'engineering_followup') {
          setFollowupResult(response)
          setRestoredFollowup(false)
        } else {
          setPlan(response)
          setFollowupResult(null)
          setRestoredPlan(false)
          setRestoredFollowup(false)
        }
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
                ...('material_routes' in response ? response.material_routes : []).map(
                  (route) =>
                    `Material route: ${route.title}. ${route.change} ${route.why} Next check: ${route.check}`,
                ),
                ...('engineering_routes' in response ? response.engineering_routes : []).map(
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
        if (!preserveSelectedTrial) {
          setSelectedRoute(null)
          setTrial(null)
          setRestoredTrial(false)
        }
        setHasTrialFollowup(preserveSelectedTrial && Boolean(trial))
        setSection((current) =>
          preserveSelectedTrial ? current : current === 'next' ? 'material' : current,
        )
      }
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Meta could not finish this request. Your brief is still here.',
        )
    } finally {
      if (comparisonRequest.current === controller) comparisonRequest.current = null
      if (!controller.signal.aborted) setActivity(null)
    }
  }
  function openTrialMeasurements() {
    requestAnimationFrame(() => {
      const details = comparisonArea.current?.querySelector('details')
      if (details) {
        details.open = true
        details.scrollIntoView({ block: 'start', behavior: 'smooth' })
        details.querySelector('input, select')?.scrollIntoView({ block: 'center' })
      }
    })
  }
  function stopWaiting() {
    request.current?.abort()
    setActivity(null)
    setNotice('Stopped waiting. Your brief is still here.')
  }
  function selectRoute(route: AdvisorRoute) {
    if (busy) return
    if (!sameRoute(selectedRoute, route)) {
      setTrial(null)
      setRestoredTrial(false)
      setHasTrialFollowup(false)
      setFollowupResult(null)
      setRestoredFollowup(false)
      setLastQuestion('')
      comparisonRequest.current = null
      comparisonAdviceShown.current = false
      setComparisonAdviceStale(false)
    }
    setSelectedRoute(route)
    setError('')
    setNotice('')
  }
  async function planTrial(route: AdvisorRoute) {
    if (!briefReady || !status?.configured || busy) return
    selectRoute(route)
    setMixMode(false)
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
        setRestoredTrial(false)
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
              followup: followupResult,
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
  function openWorkspace(saved: SavedWorkspace) {
    const hasCurrentWork =
      Object.values(brief).some((value) => value.trim()) || Boolean(plan || trial)
    if (
      hasCurrentWork &&
      !window.confirm(
        'Opening this workspace replaces the current case, advice and material drafts. Save your current workspace first if you need it. Continue?',
      )
    )
      return false
    request.current?.abort()
    comparisonRequest.current = null
    comparisonAdviceShown.current = saved.history.length > 0
    setActivity(null)
    setBrief(saved.case_data.brief)
    setCalculationDetails(saved.case_data.details)
    setPlan(saved.plan)
    setFollowupResult(saved.followup ?? null)
    setSelectedRoute(saved.selected_route)
    setTrial(saved.trial)
    setHistory(saved.history)
    setRestoredPlan(Boolean(saved.plan))
    setRestoredTrial(Boolean(saved.trial))
    setRestoredFollowup(Boolean(saved.followup))
    setHasTrialFollowup(false)
    setComparisonAdviceStale(Boolean(saved.history.length))
    setCompositionTrial(null)
    setAssemblyObservation(newAssemblyObservation())
    setBalancePreset(undefined)
    setExampleLoaded(false)
    setQuestion('')
    setLastQuestion('')
    setError('')
    setNotice(saved.plan || saved.trial || saved.followup ? 'Opened saved Meta records. Reconfirm readings and recalculate for the current trial.' : '')
    setRestoredDrafts({ measurement: saved.measurement_draft, mix: saved.mix_draft })
    measurementSnapshot.current = saved.measurement_draft
    mixSnapshot.current = saved.mix_draft
    setMeasurementProgress('draft')
    setUnitSystem(saved.unit_system)
    setWorkspaceEpoch((current) => current + 1)
    setSection(saved.trial ? 'next' : 'material')
    setMixMode(false)
    setFocusWorkspace(false)
    setEditingCase(!saved.plan && !saved.trial && !saved.followup)
    return true
  }
  const caseStatus = [
    {
      title: 'Your case',
      detail: briefReady ? 'Required details added' : 'Details needed',
      ready: briefReady,
    },
    {
      title: 'Options',
      detail: plan ? 'Suggestions available' : 'Not explored yet',
      ready: Boolean(plan),
    },
    {
      title: 'Trial plan',
      detail: trial ? 'Suggestion available' : 'Not planned yet',
      ready: Boolean(trial),
    },
    {
      title: 'Measurements',
      detail:
        measurementProgress === 'synthetic'
          ? 'Synthetic readings compared'
          : measurementProgress === 'reported'
            ? 'Reported readings compared'
            : measurementProgress === 'draft'
              ? 'Draft needs review'
              : 'Add results when available',
      ready: measurementProgress === 'synthetic' || measurementProgress === 'reported',
    },
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
    <div className={`workshop${briefReady ? ' has-case' : ''}`}>
      <div className="workshop-intro">
        <div>
          <h1>Make the most of this material.</h1>
          <p>Describe your material, compare practical routes, then plan a small trial.</p>
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
      <WorkspaceFiles
        snapshot={() => ({
          case_data: caseData,
          unit_system: unitSystem,
          plan,
          followup: followupResult,
          selected_route: selectedRoute,
          trial,
          history,
          measurement_draft: measurementSnapshot.current,
          mix_draft: mixSnapshot.current,
        })}
        onOpen={openWorkspace}
      />
      <ul className="workshop-progress" aria-label="Your case at a glance">
        {caseStatus.map((item, index) => (
          <li key={item.title} className={item.ready ? 'is-ready' : ''}>
            <span className="workshop-progress-number" aria-hidden="true">
              {index + 1}
            </span>
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
        <aside ref={caseArea} className="workshop-brief" hidden={focusWorkspace}>
          {briefReady && !editingCase && <MaterialCaseSummary caseData={caseData} onEdit={() => setEditingCase(true)} onExplore={() => void ask()} busy={busy} canExplore={Boolean(status?.configured)} />}
          <div className="workshop-case-editor" hidden={briefReady && !editingCase}>
          <div className="workshop-brief-heading">
            <div>
            <h2>{brief.product.trim() || 'Tell us about your case'}</h2>
            <p>{briefReady ? 'Review your input and target, then explore options.' : 'Start with the four marked fields. Add the rest whenever you are ready.'}</p>
            </div>
          </div>
          <details className="workshop-examples">
            <summary>Try an example</summary>
            <button
              className="workshop-example"
              type="button"
              onClick={() => replaceWithExample(loadExample)}
            >
              Explore a counterweight <span aria-hidden="true">↗</span>
            </button>
            <button
              className="workshop-example"
              type="button"
              onClick={() => replaceWithExample(loadPlanterExample)}
            >
              Explore a recycled-PE product <span aria-hidden="true">↗</span>
            </button>
          </details>
          {exampleLoaded && (
            <p className="workshop-example-note" role="status">
              Hypothetical example loaded. Edit it to fit your batch; these are not material
              measurements.
            </p>
          )}
          {mayClearCaseData && (
            <p className="workshop-edit-warning" role="status">
              Editing this case can clear linked work. Save first.
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
          </div>
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
                onClick={() => {
                  setSection(tab.id)
                  if (tab.id === 'next') setMixMode(false)
                }}
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
          {comparisonAdviceStale && (
            <p className="workshop-edit-warning" role="status">
              Meta’s earlier advice uses previous inputs. Recalculate or compare the current values,
              then send the updated summary before using that advice for this trial.
            </p>
          )}
          {(restoredPlan || restoredTrial) && (
            <p className="workshop-notice" role="status">
              Saved Meta content · these proposals were reopened from a workspace file. No new model
              request has run to restore them.
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
                    : activity === 'followup'
                      ? 'Meta is reviewing this trial'
                      : 'Meta is working through this batch'}
                </strong>
                <p>
                  {activity === 'trial'
                    ? 'Setting out what to change, what to keep fixed and how to check the result.'
                    : activity === 'followup'
                      ? 'Reviewing the current case, calculation and next useful check.'
                      : 'Comparing material routes, engineering choices and the next useful check.'}{' '}
                  {elapsed}s{' '}
                  {elapsed >= 10 &&
                    'A detailed response can take over a minute. You can stop waiting.'}
                </p>
              </div>
              <button type="button" onClick={stopWaiting}>
                Stop waiting
              </button>
            </div>
          )}
          {section === 'next' && (
            <nav className="workshop-trial-view-tabs" aria-label="Trial workspace view">
              <button type="button" aria-pressed={!mixMode} onClick={() => setMixMode(false)}>
                Review trial plan
              </button>
              <button
                type="button"
                aria-pressed={mixMode}
                onClick={() => {
                  setMixMode(true)
                  setFocusWorkspace(false)
                  requestAnimationFrame(() => {
                    const details = compositionArea.current?.querySelector('details')
                    if (details) details.open = true
                  })
                }}
              >
                Mix quantities
              </button>
            </nav>
          )}
          {followupResult && (section !== 'next' || mixMode) && (
            <FollowupAdvice
              result={followupResult}
              question={lastQuestion}
              restored={restoredFollowup}
            />
          )}
          <div
            ref={compositionArea}
            className="workshop-mix-workspace"
            hidden={section !== 'next' || !mixMode}
          >
            <BalanceMix
              key={`${workspaceEpoch}:${JSON.stringify(caseData)}`}
              caseData={caseData}
              onEditCase={openCaseDetails}
              preparedTrial={compositionTrial}
              onClearPrepared={() => setCompositionTrial(null)}
              canAsk={Boolean(status?.configured && briefReady && !busy)}
              onAsk={(trialQuestion) => {
                void ask(trialQuestion, true, 'What should I check before trying this mix?', true)
              }}
              onDraftChange={invalidateComparisonAdvice}
              initialDraft={restoredDrafts.mix}
              onSnapshot={recordMixSnapshot}
            />
          </div>
          <div className="workshop-plan-zone" hidden={section === 'next' && mixMode}>
            {!plan ? (
            <div className="workshop-start" hidden={Boolean(followupResult) || busy}>
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
                  Ideas are starting points. Your material and product still need the checks that
                  fit your case.
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
              {chosen && section !== 'next' && !routes.some((route) => sameRoute(route, chosen)) && (
                  <section
                    className="workshop-current-decision"
                    aria-label="Your selected approach"
                  >
                    <p className="workshop-eyebrow">Your selected approach</p>
                    <h3>{chosen.title}</h3>
                    <dl>
                      <div>
                        <dt>Change</dt>
                        <dd>{chosen.change}</dd>
                      </div>
                      <div>
                        <dt>Check next</dt>
                        <dd>{chosen.check}</dd>
                      </div>
                    </dl>
                    <p className="workshop-decision-target">
                      <strong>Your goal</strong> {brief.targets}
                    </p>
                    <button
                      type="button"
                      disabled={busy || !status?.configured}
                      onClick={() => {
                        if (trial) {
                          setMixMode(false)
                          setSection('next')
                        } else {
                          void planTrial(chosen)
                        }
                      }}
                    >
                      {trial ? 'View this trial plan' : 'Plan this trial'}{' '}
                      <span aria-hidden="true">→</span>
                    </button>
                    {!trial && (
                      <small>Meta will turn your chosen change into one proposed comparison.</small>
                    )}
                  </section>
                )}
                {section !== 'next' ? (
                  <>
                    {lastQuestion && !followupResult && (
                      <>
                        <p className="workshop-last-question">You asked: {lastQuestion}</p>
                        <section className="workshop-answer" aria-label="Meta’s response">
                          <strong>Meta’s response</strong>
                          {plan.answer
                            .split(/\n\s*\n/)
                            .filter(Boolean)
                            .map((paragraph, index) => (
                              <p key={index}>{paragraph}</p>
                            ))}
                        </section>
                      </>
                    )}
                    {!!plan.quarantined_answer?.length && (
                      <p role="status" className="workshop-last-question">
                        An unverified claim about meeting your targets was removed. Review the
                        proposed options and checks before relying on them.
                      </p>
                    )}
                    <div className="workshop-routes">
                      {followupResult && (
                        <p className="workshop-proposal-note">
                          Your earlier options remain available below. The follow-up above does not
                          replace the selected trial.
                        </p>
                      )}
                      {routes.map((route) => (
                        <RouteCard
                          key={route.id}
                          route={route}
                          selected={sameRoute(selectedRoute, route)}
                          busy={busy}
                          onSelect={() => selectRoute(route)}
                          actionLabel={
                            trial && sameRoute(selectedRoute, route)
                              ? 'View trial plan'
                              : 'Plan a trial'
                          }
                          onDevelop={() => {
                            if (trial && sameRoute(selectedRoute, route)) {
                              setMixMode(false)
                              setSection('next')
                            } else {
                              void planTrial(route)
                            }
                          }}
                        />
                      ))}
                    </div>
                    {(!lastQuestion || followupResult) && (
                      <details className="workshop-explanation">
                        <summary>Read Meta’s explanation</summary>
                        <div className="workshop-answer">
                          {plan.answer
                            .split(/\n\s*\n/)
                            .filter(Boolean)
                            .map((paragraph, index) => (
                              <p key={index}>{paragraph}</p>
                            ))}
                        </div>
                      </details>
                    )}
                    <div className="workshop-plan-footer">
                      <span>
                        {restoredPlan
                          ? 'Saved Meta proposal'
                          : plan.live
                            ? 'Generated by Meta'
                            : 'Proposal'}{' '}
                        · {plan.model}
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
                      <>
                        {hasTrialFollowup && (
                          <div className="workshop-followup-ready" role="status">
                            <p>
                              Meta has follow-up advice for this case. Your original trial is
                              unchanged.
                            </p>
                            <button type="button" onClick={() => setSection('material')}>
                              Review follow-up advice →
                            </button>
                          </div>
                        )}
                        <TrialPlan trial={trial} restored={restoredTrial} />
                        <section className="workshop-trial-return">
                          <h3>Bring back your trial results</h3>
                          <p>
                            When you have matching measurements, compare the tested input levels
                            with your target. Then ask Meta what to check or change next, using this
                            selected trial and your readings.
                          </p>
                          <button type="button" onClick={openTrialMeasurements}>
                            Compare measurements from this trial <span aria-hidden="true">→</span>
                          </button>
                          <small>
                            No readings yet? Keep this as a proposed trial; the app has not tested
                            your material.
                          </small>
                        </section>
                      </>
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
                              Pick a material or engineering route first. The trial will stay tied
                              to that choice and your current brief.
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
                      <summary>
                        {hasTrialFollowup
                          ? 'Follow-up ideas & open questions'
                          : 'Earlier ideas & open questions'}
                      </summary>
                      <p>
                        {hasTrialFollowup
                          ? 'These suggestions respond to your follow-up. Your chosen trial above is unchanged.'
                          : 'These came from the route exploration, before choosing a trial.'}
                      </p>
                      <ol className="workshop-next-steps">
                        {(followupResult?.next_steps ?? plan.next_steps).map((step, index) => (
                          <li key={index}>
                            <span>{String(index + 1).padStart(2, '0')}</span>
                            <p>{step}</p>
                          </li>
                        ))}
                      </ol>
                      {(followupResult?.questions ?? plan.questions).length > 0 && (
                        <ul>
                          {(followupResult?.questions ?? plan.questions).map((item, index) => (
                            <li key={index}>{item}</li>
                          ))}
                        </ul>
                      )}
                    </details>
                  </>
                )}
              </div>
            )}
          </div>
          <div
            hidden={section === 'engineering' || (section === 'next' && mixMode)}
            ref={comparisonArea}
          >
            <MeasurementComparison
              key={workspaceEpoch}
              caseData={caseData}
              trial={trial ?? undefined}
              canAsk={Boolean(status?.configured && briefReady && !busy)}
              onAsk={(comparisonQuestion) => {
                void ask(
                  comparisonQuestion,
                  true,
                  'What should I try next based on these trial readings?',
                  true,
                )
              }}
              onDraftChange={comparisonDraftChanged}
              initialDraft={restoredDrafts.measurement}
              onSnapshot={recordMeasurementSnapshot}
              onEditCase={openCaseDetails}
              onClearComposition={() => setCompositionTrial(null)}
              onPrepareComposition={(value) => {
                setCompositionTrial({ ...value, serial: ++compositionSerial.current })
                setSection('next')
                setMixMode(true)
                setFocusWorkspace(false)
                requestAnimationFrame(() => {
                  const details = compositionArea.current?.querySelector('details')
                  if (details) {
                    details.open = true
                    details.scrollIntoView({ block: 'start' })
                    details
                      .querySelector<HTMLInputElement>('input[name="addition_name"]')
                      ?.focus({ preventScroll: true })
                  }
                })
              }}
            />
          </div>
          <div hidden={section !== 'material'}>
            <details
              className="workshop-source-example"
              onToggle={(event) => {
                if (event.currentTarget.open) {
                  setSourceOpen(true)
                  setFocusWorkspace(true)
                }
              }}
            >
              <summary>
                <span>Explore a measured blend example</span>
                <small>Published PE specimens · separate from your case</small>
              </summary>
              <p className="workshop-source-scope">
                See how changing recycled content affected a measured property in one published
                study. Its materials, process and specimens belong to that study. No readings are
                copied into your case or used to qualify your product.
              </p>
              {sourceOpen && (
                <Suspense fallback={<p>Loading the published blend example…</p>}>
                  <PublishedBlend
                    active={section === 'material'}
                    onAsk={(sourceQuestion) => {
                      void ask(
                        sourceQuestion,
                        undefined,
                        'How can I develop my mix using this study as context?',
                      )
                    }}
                    disabled={busy || !briefReady || !status?.configured}
                  />
                </Suspense>
              )}
            </details>
          </div>
          <div hidden={section !== 'engineering'}>
            <details className="workshop-observation-tools">
              <summary>
                <span>Optional mass and assembly checks</span>
                <small>For a product with measured mass or balance targets</small>
              </summary>
              <p>
                These checks use measurements of a stated mix or assembly. They do not tell you
                which binder, contamination level or process will produce a material property.
              </p>
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
            </details>
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
