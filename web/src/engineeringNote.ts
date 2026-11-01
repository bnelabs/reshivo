import { commandGrams } from './quantity.ts'
import type { AssemblyObservationFields, CalculationDetails, WorkshopCase } from './types'
import type { BalanceFields, BalanceResult } from './components/BalancePlanner'
import type { BalanceConfig } from './types'
import type { FeedbackRequest } from './components/AdaptationPlanner'

export type Value = string | number | null
export type Resolution = Record<
  string,
  { current: Value; proposed: Value; selected: Value; current_text?: string }
>
export type EngineeringDraft = {
  result_kind: 'engineering_draft'
  fields: Record<string, { quote: string; source: string; normalized_value?: number } | null>
  source_fields: Record<string, unknown>
  values: Record<string, Value>
  target_resolution: Resolution
  conflicts: { field: string; current: Value; proposed: Value }[]
  missing_fields: string[]
  questions: string[]
  request_fingerprint: string
  draft_fingerprint: string
  model: string
  live: boolean
  elapsed_ms: number
}
export type Applied = {
  ready: boolean
  reviewed_values: Record<string, Value>
  target_resolution: Resolution
  missing_fields: string[]
  questions: string[]
  validation_errors: string[]
  check: BalanceResult | null
  bound_request?: { feedback: FeedbackRequest; balance: BalanceConfig }
}
export type EngineeringNotePatch = {
  details: CalculationDetails
  observation: AssemblyObservationFields
  fields: BalanceFields
}
const numberText = (value: Value | undefined) =>
  value === null || value === undefined ? '' : String(value)

export function engineeringNotePatch(
  caseData: WorkshopCase,
  result: Applied,
): EngineeringNotePatch {
  const v = result.reviewed_values
  if (!v) throw new Error('Confirm both review choices before using this note.')
  const target = (key: string) => {
    const field = result.target_resolution[key]
    return field?.selected === null && field.current_text
      ? field.current_text
      : numberText(field?.selected)
  }
  return {
    details: {
      ...caseData.details,
      mass_target_min_kg: target('mass_target_min_kg'),
      mass_target_max_kg: target('mass_target_max_kg'),
      balance: {
        coordinate_basis: target('coordinate_basis'),
        target_min_mm: target('balance_target_min_mm'),
        target_max_mm: target('balance_target_max_mm'),
      },
    },
    observation: {
      id: numberText(v.observation_id),
      kind:
        v.observation_kind === 'simulated' || v.observation_kind === 'user_reported'
          ? v.observation_kind
          : '',
      mass: numberText(v.mass_kg),
      error: numberText(v.weighing_uncertainty_kg),
      maxAdd: numberText(v.total_max_add_kg),
      maxRemove: numberText(v.total_max_remove_kg),
      adjustmentError: numberText(v.adjustment_uncertainty_kg),
      idealFeedback: false,
    },
    fields: {
      cg: numberText(v.cg_x_mm),
      cgError: numberText(v.cg_uncertainty_mm),
      resolutionG:
        typeof v.command_resolution_kg === 'number' ? commandGrams(v.command_resolution_kg) : '',
      independent: true,
      positions: ['a', 'b'].map((letter) => ({
        id: numberText(v[`position_${letter}_id`]),
        x: numberText(v[`position_${letter}_x_mm`]),
        error: numberText(v[`position_${letter}_uncertainty_mm`]),
        addG:
          typeof v[`position_${letter}_max_add_kg`] === 'number'
            ? commandGrams(v[`position_${letter}_max_add_kg`] as number)
            : '',
        removeG:
          typeof v[`position_${letter}_max_remove_kg`] === 'number'
            ? commandGrams(v[`position_${letter}_max_remove_kg`] as number)
            : '',
      })),
      baselineIndex: '0',
      baselineG: '',
    },
  }
}
