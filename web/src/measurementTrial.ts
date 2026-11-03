import { compareMeasurementDecimals } from './measurementDecimal.ts'

export type SettingCandidate = {
  id: string
  level: string
  reading_count: number
  in_target_count: number
  all_readings_in_target: boolean
}

type CompositionPreparation = {
  setting: SettingCandidate
  inputUnit: string
  componentId: number | null
  components: { id: number; name: string }[]
  confirmed: boolean
}

type CompositionPreparationResult =
  | {
      ok: true
      value: {
        componentId: number
        componentName: string
        exactLevel: string
        calculatorLevel: string
        settingId: string
      }
    }
  | { ok: false; reason: string }

export function isMassPercentUnit(inputUnit: string): boolean {
  const unit = typeof inputUnit === 'string' ? inputUnit.trim().toLowerCase().replace(/\s+/g, ' ') : ''
  return /^(?:mass(?:\s*%|\s+percent)|weight(?:\s*%|\s+percent)|wt\.?\s*%)$/.test(unit)
}

export function prepareMeasuredComposition({
  setting,
  inputUnit,
  componentId,
  components,
  confirmed,
}: CompositionPreparation): CompositionPreparationResult {
  if (confirmed !== true)
    return { ok: false, reason: 'Confirm which named component these measured mass-percent levels describe.' }

  if (componentId === null || !Number.isSafeInteger(componentId) || componentId <= 0)
    return { ok: false, reason: 'Choose the component from your existing case.' }

  if (!Array.isArray(components) || components.length === 0)
    return { ok: false, reason: 'Add the named component to your case before preparing this trial.' }

  const identifiers = new Set<number>()
  for (const component of components) {
    if (!component || !Number.isSafeInteger(component.id) || component.id <= 0 || identifiers.has(component.id))
      return { ok: false, reason: 'Each case component needs a different valid identifier before it can be linked to a setting.' }
    identifiers.add(component.id)
  }
  const component = components.find((candidate) => candidate.id === componentId)
  if (!component || typeof component.name !== 'string' || !component.name.trim())
    return { ok: false, reason: 'Choose an existing component with a name.' }

  const componentName = component.name.trim()
  const nameKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
  if (components.filter((candidate) => typeof candidate.name === 'string' && nameKey(candidate.name) === nameKey(componentName)).length !== 1)
    return { ok: false, reason: 'Give this component a distinct name so the measured setting has one clear material link.' }

  if (!isMassPercentUnit(inputUnit))
    return { ok: false, reason: 'Use an explicit mass-percent unit for an ingredient calculation. A plain percent, volume percent or process setting needs its own method.' }

  if (!setting || typeof setting.id !== 'string' || !setting.id.trim())
    return { ok: false, reason: 'Choose a recorded setting with an identifier.' }

  if (!Number.isSafeInteger(setting.reading_count) || setting.reading_count <= 0 ||
      !Number.isSafeInteger(setting.in_target_count) || setting.in_target_count !== setting.reading_count ||
      setting.all_readings_in_target !== true)
    return { ok: false, reason: 'Choose a setting with at least one reading and every entered reading inside this target.' }

  if (typeof setting.level !== 'string')
    return { ok: false, reason: 'Keep the recorded level as exact decimal text.' }
  const exactLevel = setting.level.trim()
  const comparedWithZero = compareMeasurementDecimals(exactLevel, '0')
  const comparedWithHundred = compareMeasurementDecimals(exactLevel, '100')
  if (comparedWithZero === null || comparedWithHundred === null || comparedWithZero < 0 || comparedWithHundred > 0)
    return { ok: false, reason: 'The recorded mass-percent level must be a valid decimal from zero to one hundred.' }

  const calculatorNumber = Number(exactLevel)
  const calculatorLevel = String(calculatorNumber)
  if (!Number.isFinite(calculatorNumber) || compareMeasurementDecimals(exactLevel, calculatorLevel) !== 0)
    return { ok: false, reason: 'This calculator would round the recorded level. Keep the exact setting; do not substitute a different composition.' }

  return {
    ok: true,
    value: { componentId, componentName, exactLevel, calculatorLevel, settingId: setting.id.trim() },
  }
}
