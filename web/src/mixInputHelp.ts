import { mixDecimalRoundTrips } from './mixAdjustment.ts'
import type { MixAdjustmentDraft } from './mixAdjustment.ts'
import type { UnitSystem } from './unitConversion.ts'

/** Explain the same input limits used by the mix calculator without inventing values. */
export function mixInputProblems(component: string, draft: MixAdjustmentDraft, system: UnitSystem = 'metric'): string[] {
  const problems: string[] = []
  const name = component.trim()
  if (!name || name.length > 160) problems.push('Choose a named material or stream to track.')

  const massText = draft.inputMass.trim()
  const mass = mixDecimalRoundTrips(massText) ? Number(massText) : null
  if (!massText) problems.push('Enter the mass of the portion you have.')
  else if (mass === null) problems.push('Enter a valid portion mass.')
  else if (mass <= 0) problems.push('Enter a portion mass greater than zero.')
  else if (mass > 1_000_000) problems.push(system === 'us'
    ? 'Keep the portion mass at or below 1,000,000 kg (about 2,204,622.62 lb).'
    : 'Keep the portion mass at or below 1,000,000 kg.')

  function percent(value: string, label: string): number | null {
    const input = value.trim()
    const text = input.endsWith('%') ? input.slice(0, -1).trim() : input
    if (!text) { problems.push(`Enter ${label}.`); return null }
    if (!mixDecimalRoundTrips(text)) { problems.push(`Enter a valid number for ${label}.`); return null }
    const number = Number(text)
    if (number < 0 || number > 100) { problems.push(`Enter ${label} between 0% and 100%.`); return null }
    return number
  }
  const inputMin = percent(draft.inputMin, 'the lowest portion percentage')
  const inputMax = percent(draft.inputMax, 'the highest portion percentage')
  if (inputMin !== null && inputMax !== null && inputMin > inputMax)
    problems.push('The lowest portion percentage must be no greater than the highest.')
  const addedName = draft.additionName.trim()
  if (!addedName || addedName.length > 120) problems.push('Name the material you could add.')
  percent(draft.additionPercent, 'the tracked share in the material you could add')
  const targetMin = percent(draft.targetMin, 'the minimum composition to explore')
  const targetMax = percent(draft.targetMax, 'the maximum composition to explore')
  if (targetMin !== null && targetMax !== null && targetMin > targetMax)
    problems.push('The minimum composition must be no greater than the maximum.')
  return problems
}
