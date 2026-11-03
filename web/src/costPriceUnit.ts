import { exactMassUnitConversion } from './materialUnitChange.ts'
import type { CostDraft } from './projectWorkspace.ts'
import type { UnitSystem } from './unitConversion.ts'

export type PriceUnit = 'kg' | 'lb'

export function enteredMaterialPrice(draft: CostDraft, materialId: string): string {
  return Object.hasOwn(draft.prices, materialId) ? draft.prices[materialId] : ''
}

/** Old saved prices without a unit were entered per kg. */
export function currentPriceUnit(draft: CostDraft, materialId: string, system: UnitSystem): PriceUnit {
  return (draft.price_units && Object.hasOwn(draft.price_units, materialId) ? draft.price_units[materialId] : undefined) ??
    (enteredMaterialPrice(draft, materialId) ? 'kg' : system === 'us' ? 'lb' : 'kg')
}

/** Convert a per-mass price exactly, or leave the choice to re-enter it. */
export function exactPriceUnitConversion(value: string, from: PriceUnit, to: PriceUnit): string | null {
  if (from === to) return value
  // A price denominator converts in the opposite direction from a mass amount.
  const converted = exactMassUnitConversion(value, to, from)
  // The cost API accepts decimal strings of at most 100 characters.
  return converted !== null && converted.length <= 100 ? converted : null
}

export type PendingPriceUnit = {
  caseId: string; setupId: string; revision: number; materialId: string
  value: string; from: PriceUnit; to: PriceUnit; converted: string | null
}

/** Do not apply a unit choice to a different or changed draft. */
export function resolvePriceUnit(
  draft: CostDraft, pending: PendingPriceUnit, caseId: string, setupId: string, revision: number,
  system: UnitSystem, choice: 'convert' | 'keep' | 'clear',
): CostDraft | null {
  if (caseId !== pending.caseId || setupId !== pending.setupId || revision !== pending.revision ||
      enteredMaterialPrice(draft, pending.materialId) !== pending.value ||
      currentPriceUnit(draft, pending.materialId, system) !== pending.from ||
      (choice === 'convert' && pending.converted === null)) return null
  const value = choice === 'convert' ? pending.converted! : choice === 'clear' ? '' : pending.value
  return { ...draft, prices: { ...draft.prices, [pending.materialId]: value },
    price_units: { ...draft.price_units, [pending.materialId]: pending.to } }
}
