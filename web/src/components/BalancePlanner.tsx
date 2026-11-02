import { UnitInput, outwardBound, toDisplay, unitLabel, useUnitSystem } from '../units'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { AssemblyObservationFields, BalanceConfig, WorkshopCase } from '../types'
import type { FeedbackRequest } from './AdaptationPlanner'
import { EngineeringAssistant } from './EngineeringAssistant'
import { commandGrams } from '../quantity'

export type BalanceFields = {
  cg: string
  cgError: string
  resolutionG: string
  independent: boolean
  positions: { id: string; x: string; error: string; addG: string; removeG: string }[]
  baselineIndex: string
  baselineG: string
}
export type BalancePreset = { serial: number; fields: BalanceFields; source?: 'note' }
const emptyFields = (): BalanceFields => ({
  cg: '',
  cgError: '',
  resolutionG: '',
  independent: false,
  positions: [
    { id: 'A', x: '', error: '', addG: '', removeG: '' },
    { id: 'B', x: '', error: '', addG: '', removeG: '' },
  ],
  baselineIndex: '0',
  baselineG: '',
})
const numberReady = (value: string, signed = false) =>
  value.trim() !== '' &&
  Number.isFinite(Number(value)) &&
  Math.abs(Number(value)) <= 10_000_000 &&
  (signed || Number(value) >= 0)
const q = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 3 })
export type BalanceResult = {
  result_kind: 'simulation'
  model: string
  feasible: boolean
  status: string
  request_fingerprint: string
  baseline: {
    mass_inside_target: boolean
    balance_inside_target: boolean
    adjustment_limits_fit: boolean
    cg_min_mm: number | null
    cg_max_mm: number | null
  }
  commands:
    | { position_id: string; x_mm: number; command_kg: number; action: 'add' | 'remove' | 'none' }[]
    | null
  result: { mass_min_kg: number; mass_max_kg: number; cg_min_mm: number; cg_max_mm: number } | null
  layout_svg: string
  precision_note: string | null
  assumptions: string[]
}

export function BalancePlanner({
  caseData,
  observation,
  feedback,
  onEditCase,
  active,
  preset,
  checkedMassCorrection,
}: {
  caseData: WorkshopCase
  observation: AssemblyObservationFields
  feedback: FeedbackRequest | null
  onEditCase: () => void
  active: boolean
  preset?: BalancePreset
  checkedMassCorrection: number | null
}) {
  const [fields, setFields] = useState<BalanceFields>(() =>
    preset ? structuredClone(preset.fields) : emptyFields(),
  )
  const [open, setOpen] = useState(Boolean(caseData.details.balance))
  const [resultState, setResultState] = useState<{
    value: BalanceResult
    signature: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const system = useUnitSystem()
  const target = caseData.details.balance
  const observationKey = JSON.stringify([
    observation.id,
    observation.kind,
    Number(observation.mass),
  ])
  const previousObservation = useRef(observationKey)
  const previousBasis = useRef(target?.coordinate_basis)
  const previousPreset = useRef(preset?.serial)
  const physicalCaseKey = JSON.stringify([
    caseData.brief.input,
    caseData.brief.product,
    caseData.brief.process,
    caseData.details.components,
    caseData.details.amount_unit,
    caseData.details.amount_basis,
  ])
  const previousPhysicalCase = useRef(physicalCaseKey)
  const signature = JSON.stringify([caseData, observation, fields])
  const currentSignature = useRef(signature)
  currentSignature.current = signature
  const result = resultState?.signature === signature ? resultState.value : null
  useEffect(() => {
    controller.current?.abort()
    setBusy(false)
    setResultState(null)
    setError('')
  }, [signature])
  useEffect(() => {
    if (!active) {
      controller.current?.abort()
      setBusy(false)
    }
  }, [active])
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (target) setOpen(true)
  }, [Boolean(target)])
  useEffect(() => {
    if (preset && preset.serial !== previousPreset.current) {
      setFields(structuredClone(preset.fields))
    } else if (
      previousBasis.current !== target?.coordinate_basis ||
      previousPhysicalCase.current !== physicalCaseKey
    ) {
      setFields(emptyFields())
    } else if (previousObservation.current !== observationKey) {
      setFields((current) => ({ ...current, cg: '', cgError: '', baselineG: '' }))
    }
    previousPreset.current = preset?.serial
    previousObservation.current = observationKey
    previousBasis.current = target?.coordinate_basis
    previousPhysicalCase.current = physicalCaseKey
  }, [preset, observationKey, target?.coordinate_basis, physicalCaseKey])
  function edit(key: keyof BalanceFields, value: BalanceFields[keyof BalanceFields]) {
    setFields((current) => ({ ...current, [key]: value }))
  }
  function position(index: number, key: keyof BalanceFields['positions'][number], value: string) {
    setFields((current) => ({
      ...current,
      positions: current.positions.map((p, i) => (i === index ? { ...p, [key]: value } : p)),
    }))
  }
  const targetReady = Boolean(
    target?.coordinate_basis.trim() &&
    numberReady(target.target_min_mm, true) &&
    numberReady(target.target_max_mm, true) &&
    Number(target.target_min_mm) <= Number(target.target_max_mm),
  )
  const prepared: BalanceConfig | null =
    feedback &&
    targetReady &&
    numberReady(fields.cg, true) &&
    numberReady(fields.cgError) &&
    numberReady(fields.resolutionG) &&
    Number(fields.resolutionG) > 0 &&
    fields.independent &&
    (fields.baselineG.trim() === '' || numberReady(fields.baselineG, true)) &&
    fields.positions.every(
      (p) =>
        p.id.trim() &&
        numberReady(p.x, true) &&
        [p.error, p.addG, p.removeG].every((v) => numberReady(v)),
    ) &&
    fields.positions[0].id.trim() !== fields.positions[1].id.trim()
      ? {
          cg_x_mm: Number(fields.cg),
          cg_uncertainty_mm: Number(fields.cgError),
          command_resolution_kg: Number(fields.resolutionG) / 1000,
          independent_adjustments: true,
          positions: fields.positions.map((p) => ({
            id: p.id.trim(),
            x_mm: Number(p.x),
            position_uncertainty_mm: Number(p.error),
            max_add_kg: Number(p.addG) / 1000,
            max_remove_kg: Number(p.removeG) / 1000,
          })),
          baseline: {
            position_id: fields.positions[Number(fields.baselineIndex)].id.trim(),
            command_kg: Number(fields.baselineG) / 1000,
          },
        }
      : null
  async function calculate() {
    if (!prepared || !feedback || busy || !active) return
    const request = new AbortController()
    controller.current?.abort()
    controller.current = request
    const submitted = signature
    setBusy(true)
    setError('')
    setResultState(null)
    try {
      const response = await api<BalanceResult>(
        '/api/adaptation/balance',
        {
          brief: caseData.brief,
          calculation_context: caseData.details,
          feedback,
          balance: prepared,
        },
        request.signal,
      )
      if (!request.signal.aborted && currentSignature.current === submitted)
        setResultState({ value: response, signature: submitted })
    } catch (failure) {
      if (!request.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : 'The joint target check could not finish.',
        )
    } finally {
      if (!request.signal.aborted) setBusy(false)
    }
  }
  function download(svg = false) {
    if (!result) return
    const data = svg
      ? result.layout_svg
      : JSON.stringify(
          { workshop_case: caseData, assembly_observation: observation, balance: prepared, result },
          null,
          2,
        )
    const url = URL.createObjectURL(
      new Blob([data], { type: svg ? 'image/svg+xml' : 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = svg ? 'rematter-trim-placement.svg' : 'rematter-mass-and-balance.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <details
      className="balance-planner"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        Also control the balance point <small>Choose an amount and a location</small>
      </summary>
      <p>
        A mass correction can still leave a product off balance. Use a centre-of-mass reading for
        this same assembly and two known trim mass-centre locations. This checks one axis; it does
        not establish tipping safety or enclosure strength.
      </p>
      {!targetReady ? (
        <p>
          <button type="button" className="text-button" onClick={onEditCase}>
            Set the shared balance target and axis
          </button>
        </p>
      ) : (
        <p className="balance-target">
          Using your case: mass {toDisplay(caseData.details.mass_target_min_kg, 'kg', system)}–
          {toDisplay(caseData.details.mass_target_max_kg, 'kg', system)} {unitLabel('kg', system)} · balance x={toDisplay(target!.target_min_mm, 'mm', system)}…
          {toDisplay(target!.target_max_mm, 'mm', system)} {unitLabel('mm', system)}.{' '}
          <button type="button" className="text-button" onClick={onEditCase}>
            Edit target
          </button>
          <small>{target!.coordinate_basis}</small>
        </p>
      )}
      {!feedback && (
        <p className="helper">
          Complete the shared assembly weighing and adjustment bounds above. They are reused here.
        </p>
      )}
      <details className="product-detail">
        <summary>Balance reading and adjustment locations</summary>
        <p>
          For observation {observation.id || 'not recorded'}, using{' '}
          {observation.kind === 'simulated' ? 'synthetic' : 'user-reported'} inputs. Record a
          matching balance reading; no value is inferred from the material or its shape.
        </p>
        <div className="product-pair">
          <label>
            Assembly centre x ({unitLabel('mm', system)})
            <UnitInput unit="mm" value={fields.cg} onChange={(value) => edit('cg', value)} />
          </label>
          <label>
            Centre uncertainty (± {unitLabel('mm', system)})
            <UnitInput unit="mm" value={fields.cgError} onChange={(value) => edit('cgError', value)} />
          </label>
        </div>
        {fields.positions.map((p, index) => (
          <div className="balance-location" key={index}>
            <h4>Adjustment location {index + 1}</h4>
            <label>
              Location {index + 1} reference
              <input
                maxLength={80}
                value={p.id}
                onChange={(e) => position(index, 'id', e.target.value)}
              />
            </label>
            <div className="product-pair">
              <label>
                Location {index + 1} mass centre x ({unitLabel('mm', system)})
                <UnitInput unit="mm" value={p.x} onChange={(value) => position(index, 'x', value)} />
              </label>
              <label>
                Location {index + 1} position uncertainty (± {unitLabel('mm', system)})
                <UnitInput unit="mm" value={p.error} onChange={(value) => position(index, 'error', value)} />
              </label>
              <label>
                Location {index + 1} addition limit ({unitLabel('g', system)})
                <UnitInput unit="g" value={p.addG} onChange={(value) => position(index, 'addG', value)} />
              </label>
              <label>
                Location {index + 1} removable trim ({unitLabel('g', system)})
                <UnitInput unit="g" value={p.removeG} onChange={(value) => position(index, 'removeG', value)} />
              </label>
            </div>
          </div>
        ))}
        <label>
          Command increment ({unitLabel('g', system)})
          <UnitInput unit="g" value={fields.resolutionG} onChange={(value) => edit('resolutionG', value)} />
        </label>
        <p className="helper">
          The rounded command itself is rechecked. This increment is not a claim about weighing
          accuracy.
        </p>
        <label>
          <input
            type="checkbox"
            checked={fields.independent}
            onChange={(e) => edit('independent', e.target.checked)}
          />{' '}
          The entered adjustment bound applies independently at each active location.
        </label>
        <p>
          Uses your shared total add/remove limits and ±
          {feedback ? toDisplay(String(feedback.adjustment_uncertainty_kg), 'kg', system) : 'unknown'} {unitLabel('kg', system)} adjustment bound
          per active location. Removal locations describe independently available trim units, not an
          assumed removable part of loose fill.
        </p>
        <h4>Optional comparison</h4>
        <p className="helper">Leave the command blank to compare with no adjustment.</p>
        <label>
          Comparison location
          <select
            value={fields.baselineIndex}
            onChange={(e) => edit('baselineIndex', e.target.value)}
          >
            {fields.positions.map((p, i) => (
              <option key={i} value={String(i)}>
                {p.id || `Location ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Comparison command (signed {unitLabel('g', system)})
          <UnitInput unit="g" value={fields.baselineG} onChange={(value) => edit('baselineG', value)} />
        </label>
        {checkedMassCorrection !== null && (
          <button
            type="button"
            className="text-button"
            onClick={() => edit('baselineG', String(checkedMassCorrection * 1000))}
          >
            Use the checked mass-only midpoint ({toDisplay(String(checkedMassCorrection), 'kg', system)} {unitLabel('kg', system)})
          </button>
        )}
      </details>
      <button
        type="button"
        className="outline-button"
        disabled={!prepared || busy || !active}
        onClick={() => void calculate()}
      >
        {busy ? 'Checking both targets…' : 'Compare mass-only and two-location adjustments'}
      </button>
      {error && (
        <p role="alert" className="workshop-error">
          {error}
        </p>
      )}
      {result && (
        <div className="workshop-trim-result" aria-label="Mass and balance simulation">
          <span className="data-kind">Simulation · entered mass and balance bounds</span>
          <h3>
            {result.feasible
              ? 'A checked adjustment for both targets'
              : result.status === 'precision_limited'
                ? 'No rounded command found at this increment'
                : 'These limits do not fit both targets'}
          </h3>
          <p>
            {prepared?.baseline.command_kg === 0
              ? 'No-adjustment comparison'
              : 'Single-location comparison'}
            : mass {result.baseline.mass_inside_target ? 'fits' : 'misses'}, balance{' '}
            {result.baseline.balance_inside_target ? 'fits' : 'misses'}
            {!result.baseline.adjustment_limits_fit ? '; adjustment limits also fail' : ''}.
          </p>
          {result.commands && (
            <div className="balance-command-list">
              {result.commands.map((p) => (
                <p key={p.position_id}>
                  <strong>
                    {p.action === 'none'
                      ? 'No change'
                      : `${p.action === 'add' ? 'Add' : 'Remove'} ${system === 'metric' ? `${commandGrams(Math.abs(p.command_kg))} g` : `≈ ${toDisplay(String(Math.abs(p.command_kg)), 'kg', system)} lb (exact ${commandGrams(Math.abs(p.command_kg))} g)`}`}
                  </strong>
                  <span>
                    {p.position_id} · mass centre x={toDisplay(String(p.x_mm), 'mm', system)} {unitLabel('mm', system)}
                  </span>
                </p>
              ))}
            </div>
          )}
          {result.result && (
            <p>
              Approximate ranges: mass {outwardBound(result.result.mass_min_kg, 'kg', system, 'min')}–{outwardBound(result.result.mass_max_kg, 'kg', system, 'max')}{' '}
              {unitLabel('kg', system)} · balance x={outwardBound(result.result.cg_min_mm, 'mm', system, 'min')}…{outwardBound(result.result.cg_max_mm, 'mm', system, 'max')} {unitLabel('mm', system)}, including
              the supplied bounds.
            </p>
          )}
          {result.precision_note && <p>{result.precision_note}</p>}
          {!result.feasible && (
            <p>
              Check the declared measurement/adjustment bounds and available trim locations. More
              mass alone may not solve a balance constraint. A changed physical configuration needs
              a new matching observation.
            </p>
          )}
          <img
            className="balance-diagram"
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.layout_svg)}`}
            alt="Simulated trim placement diagram showing entered locations and balance target"
          />
          <p className="helper">
            The diagram uses grams and millimetres. Remeasure after any physical adjustment; space,
            retention, durability and tipping safety remain unchecked.
          </p>
          <button type="button" className="text-button" onClick={() => download(true)}>
            Download placement diagram
          </button>{' '}
          <button type="button" className="text-button" onClick={() => download(false)}>
            Download both-target check
          </button>
        </div>
      )}
      <EngineeringAssistant
        caseData={caseData}
        plan={null}
        feedback={feedback}
        active={active}
        balance={prepared}
        requiresBalance
      />
    </details>
  )
}
