import { useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api'
import { compareMeasurementDecimals, measurementDecimalKey, parseMeasurementDecimal } from '../measurementDecimal'
import type { AdvisorTrialResult, WorkshopCase } from '../types'
import './MeasurementComparison.css'

type GroupKind = 'unknown' | 'repeat' | 'specimen' | 'run' | 'batch'
type ReadingIds = { reading_id: string; specimen_id: string; run_id: string; batch_id: string; repeat_of: string }
type Reading = { key: number; value: string; group_kind: GroupKind; group_label: string } & ReadingIds
type Setting = { key: number; id: string; level: string; readings: Reading[] }
type ComparedSetting = {
  id: string
  level: string
  readings: ({ value: string; group_kind: GroupKind; group_label: string; inside_target: boolean } & Record<keyof ReadingIds, string | null>)[]
  observed_min: string
  observed_max: string
  reading_count: number
  in_target_count: number
  all_readings_in_target: boolean
}
type ComparisonResult = {
  result_kind: 'entered_readings_comparison'
  settings: ComparedSetting[]
  matching_setting_ids: string[]
  warnings: string[]
}

const newReading = (key: number): Reading => ({ key, value: '', group_kind: 'unknown', group_label: 'Unknown', reading_id: '', specimen_id: '', run_id: '', batch_id: '', repeat_of: '' })
const numberPresent = (value: string) => parseMeasurementDecimal(value) !== null
const identifierFields: { key: keyof ReadingIds; label: string }[] = [
  { key: 'reading_id', label: 'Reading identifier' }, { key: 'specimen_id', label: 'Specimen identifier' },
  { key: 'run_id', label: 'Production run identifier' }, { key: 'batch_id', label: 'Batch identifier' },
  { key: 'repeat_of', label: 'Repeated reading of' },
]
const groups: { value: GroupKind; label: string }[] = [
  { value: 'unknown', label: 'Unknown' }, { value: 'repeat', label: 'Repeated reading' },
  { value: 'specimen', label: 'Specimen' }, { value: 'run', label: 'Production run' },
  { value: 'batch', label: 'Separate batch' },
]

export function MeasurementComparison({ caseData, trial, canAsk, onAsk, onDraftChange }: { caseData: WorkshopCase; trial?: AdvisorTrialResult; canAsk: boolean; onAsk: (question: string) => void; onDraftChange?: () => void }) {
  const [fields, setFields] = useState({ property_name: '', property_unit: '', input_name: '', input_unit: '', target_min: '', target_max: '', method: '' })
  const [dataKind, setDataKind] = useState<'' | 'synthetic' | 'user_reported'>('')
  const [settings, setSettings] = useState<Setting[]>([
    { key: 1, id: 'Setting 1', level: '', readings: [newReading(1)] },
    { key: 2, id: 'Setting 2', level: '', readings: [newReading(2)] },
  ])
  const nextKey = useRef(3)
  const caseSignature = JSON.stringify(caseData)
  const trialSignature = JSON.stringify(trial ?? null)
  const signature = JSON.stringify([caseSignature, trialSignature])
  const previousCaseSignature = useRef(caseSignature)
  const previousTrialSignature = useRef(trialSignature)
  const [confirmedSignature, setConfirmedSignature] = useState('')
  const [caseChanged, setCaseChanged] = useState(false)
  const [trialChanged, setTrialChanged] = useState(false)
  const [trialCheckIndex, setTrialCheckIndex] = useState('')
  const [trialCheckCopied, setTrialCheckCopied] = useState(false)
  const [result, setResult] = useState<{ signature: string; value: ComparisonResult } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef<AbortController | null>(null)
  const hasDraft = useRef(false)
  const confirmed = confirmedSignature === signature

  useLayoutEffect(() => {
    const changedCase = previousCaseSignature.current !== caseSignature
    const changedTrial = previousTrialSignature.current !== trialSignature
    if (changedCase || changedTrial) {
      previousCaseSignature.current = caseSignature
      previousTrialSignature.current = trialSignature
      request.current?.abort()
      setBusy(false)
      setResult(null)
      setConfirmedSignature('')
      if (changedCase) setCaseChanged(hasDraft.current)
      if (changedTrial) {
        setTrialChanged(hasDraft.current)
        setTrialCheckIndex('')
        setTrialCheckCopied(false)
      }
      setError('')
      onDraftChange?.()
    }
  }, [caseSignature, trialSignature])
  useLayoutEffect(() => () => request.current?.abort(), [])

  function invalidate() {
    onDraftChange?.()
    request.current?.abort()
    setBusy(false)
    setResult(null)
    setConfirmedSignature('')
    setError('')
  }
  function updateField(key: keyof typeof fields, value: string) {
    hasDraft.current = true
    invalidate()
    setFields((current) => ({ ...current, [key]: value }))
  }
  function updateSettings(update: (current: Setting[]) => Setting[]) {
    hasDraft.current = true
    invalidate()
    setSettings(update)
  }
  function updateSetting(key: number, patch: Partial<Setting>) {
    updateSettings((current) => current.map((setting) => setting.key === key ? { ...setting, ...patch } : setting))
  }
  function updateReading(settingKey: number, readingKey: number, patch: Partial<Reading>) {
    updateSettings((current) => current.map((setting) => setting.key !== settingKey ? setting : {
      ...setting, readings: setting.readings.map((reading) => reading.key === readingKey ? { ...reading, ...patch } : reading),
    }))
  }

  const trialCheck = trialCheckIndex === '' ? undefined : trial?.checks[Number(trialCheckIndex)]
  const trialCheckFits = Boolean(trialCheck?.property.trim() && trialCheck.method.trim() &&
    trialCheck.property.length <= 120 && trialCheck.method.length <= 1000)
  function useTrialCheck() {
    if (!trialCheck || !trialCheckFits) return
    hasDraft.current = true
    invalidate()
    setFields((current) => ({ ...current,
      property_name: trialCheck.property, method: trialCheck.method,
      property_unit: '', target_min: '', target_max: '',
    }))
    setTrialCheckCopied(true)
  }

  const requiredCase = Boolean(caseData.brief.input.trim() && caseData.brief.product.trim() && caseData.brief.use_case.trim() && caseData.brief.targets.trim() && caseData.brief.process.trim())
  const validSettings = settings.every((setting) => setting.id.trim() && numberPresent(setting.level) && setting.readings.every((reading) => numberPresent(reading.value) && reading.group_label.trim()))
  const uniqueSettings = new Set(settings.map((setting) => setting.id.trim())).size === settings.length &&
    new Set(settings.map((setting) => measurementDecimalKey(setting.level))).size === settings.length
  const hasTargetMax = fields.target_max.trim() !== ''
  const targetOrder = hasTargetMax ? compareMeasurementDecimals(fields.target_min, fields.target_max) : null
  const savedMassTargetOrder = compareMeasurementDecimals(caseData.details.mass_target_min_kg, caseData.details.mass_target_max_kg)
  const invalidNumericText = [fields.target_min, fields.target_max, ...settings.flatMap((setting) => [setting.level, ...setting.readings.map((reading) => reading.value)])]
    .some((value) => value.trim() !== '' && !numberPresent(value))
  const valid = requiredCase && confirmed && Boolean(dataKind) &&
    [fields.property_name, fields.property_unit, fields.input_name, fields.input_unit, fields.method].every((value) => value.trim()) &&
    numberPresent(fields.target_min) && (!hasTargetMax || (targetOrder !== null && targetOrder <= 0)) &&
    validSettings && uniqueSettings

  async function compare() {
    if (!valid || busy) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    setBusy(true)
    setResult(null)
    setError('')
    try {
      const value = await api<ComparisonResult>('/api/products/compare-readings', {
        brief: caseData.brief, calculation_context: caseData.details,
        property_name: fields.property_name.trim(), property_unit: fields.property_unit.trim(),
        input_name: fields.input_name.trim(), input_unit: fields.input_unit.trim(),
        target_min: fields.target_min.trim(), target_max: hasTargetMax ? fields.target_max.trim() : null, method: fields.method.trim(),
        conditions_confirmed: confirmed, data_kind: dataKind,
        settings: settings.map((setting) => ({ id: setting.id.trim(), level: setting.level.trim(),
          readings: setting.readings.map((reading) => ({ value: reading.value.trim(), group_kind: reading.group_kind, group_label: reading.group_label,
            ...Object.fromEntries(identifierFields.map(({ key }) => [key, reading[key].trim() ? reading[key] : null])),
          })) })),
      }, controller.signal)
      if (!controller.signal.aborted) setResult({ signature, value })
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'The readings could not be compared.')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const visibleResult = result?.signature === signature ? result.value : null
  const comparisonSummary = visibleResult ? JSON.stringify({
    reading_type: dataKind === 'synthetic' ? 'synthetic simulation' : 'user-reported measurements, not independently verified',
    input: fields.input_name.trim(), input_unit: fields.input_unit.trim(),
    property: fields.property_name.trim(), property_unit: fields.property_unit.trim(),
    target: [fields.target_min.trim(), hasTargetMax ? fields.target_max.trim() : null], method: fields.method.trim(),
    limitations: 'Numeric values are exact decimal strings; a null target maximum means no upper limit. Uncertainty and independence were not assessed. Individual grouping identifiers are not included in this summary; do not infer batch relationships.',
    settings: visibleResult.settings.map((setting) => ({ id: setting.id, level: setting.level,
      observed_min: setting.observed_min, observed_max: setting.observed_max,
      reading_count: setting.reading_count, in_target_count: setting.in_target_count })),
  }, null, 2) : ''
  const question = `These are my reported or synthetic observations, not a prediction. Suggest practical next checks or changes, without assuming future consistency or unmeasured properties. Comparison summary:\n${comparisonSummary}`
  function download() {
    if (!visibleResult) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ workshop_case: caseData, selected_trial: trial ?? null, result: visibleResult }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'rematter-entered-reading-comparison.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <details className="workshop-weight-tool measurement-comparison">
      <summary><span>Compare my measurements</span><small>Check entered readings against your target</small></summary>
      <p>Enter readings for the same material, process and product in your current case. Compare only settings with readings; if you have no matching measurements, test this exact case first.</p>
      <div className="measurement-case">
        <strong>Using your current case</strong>
        <p>Material: {caseData.brief.input || 'Not entered'} · Product: {caseData.brief.product || 'Not entered'}</p>
        <p>Process: {caseData.brief.process || 'Not entered'}</p>
      </div>
      {trial && (
        <section className="measurement-case" aria-label="Selected trial context">
          <strong>Selected trial: {trial.title}</strong>
          <p><strong>Change:</strong> {trial.change}</p>
          <p><strong>Original targets:</strong> {trial.targets}</p>
          <p>These are proposed checks. Enter only readings obtained using the method and conditions you state below.</p>
          <details><summary>Review all proposed checks</summary><ol>
            {trial.checks.map((check, index) => (
              <li key={index}>
                <p><strong>{check.property}</strong> · Target: {check.target}</p>
                <p>Proposed method: {check.method}</p>
              </li>
            ))}
          </ol></details>
        </section>
      )}
      {!requiredCase && <p className="measurement-prompt">Complete the required case fields and add the process under “Equipment, contamination and other constraints.”</p>}
      {caseChanged && <p className="measurement-prompt" role="status">Your case changed. Your draft is still here, but the previous comparison is cleared. Check that these readings still apply and confirm again.</p>}
      {trialChanged && <p className="measurement-prompt" role="status">Your selected trial changed. Your draft is still here, but the previous comparison is cleared. Check the property, method and readings against this trial, then confirm again.</p>}
      <form onSubmit={(event) => { event.preventDefault(); void compare() }}>
        {trial && (
          <div className="measurement-case">
            <label>Check from this trial
              <select value={trialCheckIndex} onChange={(event) => { setTrialCheckIndex(event.target.value); setTrialCheckCopied(false) }}>
                <option value="">Choose a proposed check to reuse</option>
                {trial.checks.map((check, index) => <option key={index} value={String(index)}>{check.property}</option>)}
              </select>
            </label>
            <button type="button" className="outline-button" disabled={!trialCheckFits} onClick={useTrialCheck}>Use this trial check</button>
            <p className="measurement-help">Copies only the property and proposed method. Enter numerical limits and units for this method; original target above. No readings are supplied by the trial plan.</p>
            {trialCheck && !trialCheckFits && <p className="measurement-prompt">This check cannot be copied in full: the property must be nonempty and at most 120 characters, and the method nonempty and at most 1,000 characters. Nothing has been copied. Write a concise method in the fields below without losing its conditions.</p>}
            {trialCheckCopied && <p className="measurement-help" role="status">Copied the property and proposed method. Set the numerical limits and units for your readings. Existing input levels and readings remain a draft to review.</p>}
          </div>
        )}
        {savedMassTargetOrder !== null && savedMassTargetOrder <= 0 && (
          <button type="button" className="outline-button" onClick={() => {
            hasDraft.current = true
            invalidate()
            setFields((current) => ({ ...current, property_name: 'Assembled mass', property_unit: 'kg',
              target_min: caseData.details.mass_target_min_kg, target_max: caseData.details.mass_target_max_kg }))
          }}>Use saved mass target (kg)</button>
        )}
        <div className="measurement-grid">
          <label>Property to check<input maxLength={120} placeholder="e.g. mass or tensile strength" value={fields.property_name} onChange={(e) => updateField('property_name', e.target.value)} /></label>
          <label>Property unit<input maxLength={40} placeholder="e.g. kg or MPa" value={fields.property_unit} onChange={(e) => updateField('property_unit', e.target.value)} /></label>
          <label>What changed between settings<input maxLength={120} placeholder="e.g. binder content" value={fields.input_name} onChange={(e) => updateField('input_name', e.target.value)} /></label>
          <label>Input unit<input maxLength={40} placeholder="e.g. mass %" value={fields.input_unit} onChange={(e) => updateField('input_unit', e.target.value)} /></label>
          <label>Target minimum<input type="text" inputMode="decimal" value={fields.target_min} onChange={(e) => updateField('target_min', e.target.value)} /></label>
          <label>Target maximum (optional)<input type="text" inputMode="decimal" placeholder="Leave blank for no upper limit" value={fields.target_max} onChange={(e) => updateField('target_max', e.target.value)} /></label>
        </div>
        <p className="measurement-help">Enter a minimum target. Leave the maximum blank when your criterion has no upper limit.</p>
        <p className="measurement-help">For contamination, name the contaminant and enter its amount and basis at each setting, such as mass %. A vague “contamination” label is not enough to identify it.</p>
        <label>How were these readings obtained?<textarea maxLength={1000} rows={2} placeholder="Name the method and the conditions shared by all settings" value={fields.method} onChange={(e) => updateField('method', e.target.value)} /></label>
        <label>Reading type<select value={dataKind} onChange={(e) => { hasDraft.current = true; invalidate(); setDataKind(e.target.value as typeof dataKind) }}>
          <option value="">Choose one</option><option value="user_reported">My reported measurements</option><option value="synthetic">Simulation or synthetic example</option>
        </select></label>
        <p className="measurement-help">Use the same units throughout. Decimal values, including scientific notation, are kept exactly as entered. No unit conversion, estimates between settings or future-batch predictions are made.</p>
        {settings.map((setting, settingIndex) => (
          <fieldset key={setting.key} className="measurement-setting">
            <legend>Setting {settingIndex + 1}</legend>
            <div className="measurement-grid">
              <label>Setting name<input maxLength={80} value={setting.id} onChange={(e) => updateSetting(setting.key, { id: e.target.value })} /></label>
              <label>Input level {fields.input_unit.trim() && `(${fields.input_unit.trim()})`}<input type="text" inputMode="decimal" value={setting.level} onChange={(e) => updateSetting(setting.key, { level: e.target.value })} /></label>
            </div>
            {setting.readings.map((reading, readingIndex) => (
              <div className="measurement-reading" key={reading.key}>
                <strong>Reading {readingIndex + 1}</strong>
                <div className="measurement-grid">
                  <label>Value {fields.property_unit.trim() && `(${fields.property_unit.trim()})`}<input type="text" inputMode="decimal" value={reading.value} onChange={(e) => updateReading(setting.key, reading.key, { value: e.target.value })} /></label>
                  <label>What does this reading belong to?<select value={reading.group_kind} onChange={(e) => { const kind = e.target.value as GroupKind; updateReading(setting.key, reading.key, { group_kind: kind, group_label: kind === 'unknown' ? 'Unknown' : '' }) }}>{groups.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}</select></label>
                  {reading.group_kind !== 'unknown' && <label>Group identifier<input maxLength={160} value={reading.group_label} placeholder="e.g. sample A" onChange={(e) => updateReading(setting.key, reading.key, { group_label: e.target.value })} /></label>}
                </div>
                <details>
                  <summary>Reading, specimen, run and batch identifiers · optional</summary>
                  <p className="measurement-help">Keep separate identifiers when known; leave unknowns blank. A repeat can refer to another reading. These labels are retained without inferring a hierarchy or independence.</p>
                  <div className="measurement-grid">
                    {identifierFields.map(({ key, label }) => <label key={key}>{label}<input maxLength={160} value={reading[key]} onChange={(e) => updateReading(setting.key, reading.key, { [key]: e.target.value })} /></label>)}
                  </div>
                </details>
                {setting.readings.length > 1 && <button type="button" className="text-button" onClick={() => updateSetting(setting.key, { readings: setting.readings.filter((row) => row.key !== reading.key) })}>Remove reading {readingIndex + 1}</button>}
              </div>
            ))}
            <div className="measurement-actions">
              <button type="button" className="outline-button" disabled={setting.readings.length >= 20} onClick={() => updateSetting(setting.key, { readings: [...setting.readings, newReading(nextKey.current++)] })}>Add reading</button>
              {settings.length > 2 && <button type="button" className="text-button" onClick={() => updateSettings((current) => current.filter((row) => row.key !== setting.key))}>Remove setting {settingIndex + 1}</button>}
            </div>
          </fieldset>
        ))}
        <button type="button" className="outline-button" disabled={settings.length >= 20} onClick={() => {
          const settingKey = nextKey.current++
          const readingKey = nextKey.current++
          updateSettings((current) => [...current, { key: settingKey, id: `Setting ${settingKey}`, level: '', readings: [newReading(readingKey)] }])
        }}>Add setting</button>
        <label className="measurement-confirm"><input type="checkbox" checked={confirmed} onChange={(e) => { hasDraft.current = true; invalidate(); setConfirmedSignature(e.target.checked ? signature : ''); if (e.target.checked) { setCaseChanged(false); setTrialChanged(false) } }} /> I confirm the readings use the current case’s material, process and product, the same stated property and method, and that only the named input changes across settings.</label>
        {!uniqueSettings && validSettings && <p className="measurement-prompt">Give each setting a different name and input level.</p>}
        {invalidNumericText && <p className="measurement-prompt">Use finite decimal numbers with at most 160 characters and exponent magnitude at most 10000. Invalid entries are kept for correction and are not compared.</p>}
        {targetOrder !== null && targetOrder > 0 && <p className="measurement-prompt">The minimum target must be no greater than the maximum.</p>}
        {!valid && <p className="measurement-help">Enter both settings and their readings, the target and method. Choose the reading type and confirm that the readings apply to this case.</p>}
        <button type="submit" className="measurement-submit" disabled={!valid || busy}>{busy ? 'Comparing…' : 'Compare entered readings'}</button>
        {error && <p className="workshop-error" role="alert">{error}</p>}
      </form>
      {visibleResult && <section className="measurement-results" aria-label="Reading comparison results" role="status">
        <strong>{dataKind === 'synthetic' ? 'Simulation · synthetic readings' : 'Comparison · your reported measurements'}</strong>
        <p>Target: {hasTargetMax ? <>{fields.target_min}–{fields.target_max} {fields.property_unit}</> : <>at least {fields.target_min} {fields.property_unit} (no upper limit)</>}. These results describe only the readings you entered.</p>
        {visibleResult.settings.map((setting) => <div key={setting.id} className="measurement-result-row">
          <h3>{setting.id}: {setting.level} {fields.input_unit}</h3>
          <p><strong>{setting.in_target_count} of {setting.reading_count} readings in target</strong> · observed {setting.observed_min}–{setting.observed_max} {fields.property_unit}</p>
          <p>{setting.all_readings_in_target ? 'All entered readings for this setting were in range.' : 'At least one entered reading was outside the range.'}</p>
          <ul>{setting.readings.map((reading, index) => <li key={index}>{reading.value} {fields.property_unit}: {reading.inside_target ? 'in target' : 'outside target'} · {reading.group_kind === 'unknown' ? 'group unknown' : `${reading.group_kind}: ${reading.group_label}`}
            {identifierFields.filter(({ key }) => reading[key] != null).length > 0 && <small>{identifierFields.filter(({ key }) => reading[key] != null).map(({ key, label }) => `${label}: ${reading[key]}`).join(' · ')}</small>}
          </li>)}</ul>
        </div>)}
        <p>Measurement uncertainty and independence were not assessed. These observations do not establish future performance, batch consistency, or suitability of an untested product. Test the actual product and conditions.</p>
        <button type="button" className="outline-button" onClick={download}>Download comparison and entered identifiers</button>
        <details className="measurement-share-summary">
          <summary>What would be sent to Meta?</summary>
          <p>Your current case, recent conversation and this comparison summary:</p>
          <pre>{comparisonSummary}</pre>
        </details>
        <button type="button" className="outline-button" disabled={!canAsk || question.length > 3000} onClick={() => onAsk(question)}>Ask Meta about this comparison</button>
        {question.length > 3000 && <p className="measurement-help">This summary is too long to send. Reduce the number of settings or shorten their names and method.</p>}
        {!canAsk && <p className="measurement-help">You can ask when Meta is available and no request is running.</p>}
      </section>}
    </details>
  )
}
