import type { CostDraft, ProjectWorkspace, TrialConfiguration } from './projectWorkspace.ts'

type KnownProcessCost =
  | { status: 'known'; kwh: string; rate: string }
  | { status: 'known'; person_hours: string; rate: string }
  | { status: 'known'; charges: { id: string; name: string; amount: string }[] }
type ProcessCost = KnownProcessCost | { status: 'unknown' | 'excluded' }
type Output = { mode: 'actual' | 'planned'; acceptance_basis: string } & Partial<
  Record<
    | 'usable_count'
    | 'usable_mass_kg'
    | 'usable_area_m2'
    | 'gross_count'
    | 'gross_mass_kg'
    | 'gross_area_m2'
    | 'accepted_fraction',
    string
  >
>

export function costRequest(w: ProjectWorkspace, c: TrialConfiguration, d: CostDraft) {
  const versions = w.configurations.filter((item) => item.id === c.id)
  const captured = versions.find((item) => item.revision === c.revision)
  if (!captured)
    throw new Error('Choose a saved setup version from this project before estimating its cost.')
  const content = (item: TrialConfiguration) =>
    JSON.stringify([
      item.name,
      item.process,
      item.geometry,
      item.notes,
      item.materials.map((material) => [
        material.id,
        material.name,
        material.amount,
        material.unit,
      ]),
    ])
  if (content(captured) !== content(c))
    throw new Error(
      'Save changed materials, process or shape as a new setup version before costing.',
    )
  const currentRevision = Math.max(...versions.map((item) => item.revision))
  const process = Object.fromEntries(
    (['energy', 'labor', 'other'] as const).map((category): [string, ProcessCost] => {
      const status = d.process_statuses?.[category] ?? 'unknown'
      if (status !== 'known') return [category, { status }]
      if (category === 'energy')
        return [category, { status, kwh: d.energy_kwh, rate: d.energy_rate }]
      if (category === 'labor')
        return [category, { status, person_hours: d.labor_hours, rate: d.labor_rate }]
      return [
        category,
        { status, charges: [{ id: 'other', name: d.other_name, amount: d.other_charge }] },
      ]
    }),
  )
  const output: Output = { mode: d.mode, acceptance_basis: d.acceptance_basis }
  const outputFields =
    d.mode === 'actual'
      ? (['usable_count', 'usable_mass_kg', 'usable_area_m2'] as const)
      : (['gross_count', 'gross_mass_kg', 'gross_area_m2', 'accepted_fraction'] as const)
  for (const field of outputFields) {
    if (d[field].trim()) output[field] = d[field]
  }
  return {
    case_id: w.case_id,
    configuration_id: c.id,
    configuration_revision: String(c.revision),
    current_configuration_revision: String(currentRevision),
    currency: d.currency,
    product_basis: w.project.product?.value ?? '',
    functional_basis: d.functional_basis,
    scope_basis: 'Charged materials and the process categories selected here',
    mass_basis: d.mass_basis,
    materials: c.materials.map((material) => ({
      id: material.id,
      name: material.name,
      quantity: material.amount,
      quantity_unit: material.unit,
      unit_price: d.prices[material.id] ?? '',
      price_unit: 'kg',
    })),
    process,
    output,
    ...(d.batch_mass_kg
      ? { batch_mass: { quantity: d.batch_mass_kg, unit: 'kg', basis: d.mass_basis } }
      : {}),
  }
}

export type CostMetric = 'per_usable_unit' | 'per_usable_kg' | 'per_usable_m2'
export type CostWinnerSummary = {
  metric: CostMetric
  configuration_ids: string[]
  names: string[]
  tie: boolean
  cost: string
}
const COST_METRICS: CostMetric[] = ['per_usable_unit', 'per_usable_kg', 'per_usable_m2']

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function costWinnerSummaries(
  comparison: unknown,
  configurations: readonly Pick<TrialConfiguration, 'id' | 'name'>[],
): CostWinnerSummary[] {
  if (!object(comparison) || comparison.comparable !== true || !object(comparison.winners))
    return []
  const names = new Map(configurations.map((item) => [item.id, item.name.trim() || item.id]))
  const result: CostWinnerSummary[] = []
  for (const metric of COST_METRICS) {
    const winner = comparison.winners[metric]
    if (!object(winner) || !Array.isArray(winner.configuration_ids)) continue
    const ids = winner.configuration_ids
    if (
      !ids.length ||
      ids.length > names.size ||
      !ids.every((id): id is string => typeof id === 'string' && names.has(id)) ||
      new Set(ids).size !== ids.length ||
      winner.tie !== ids.length > 1 ||
      typeof winner.cost !== 'string' ||
      winner.cost.length > 512 ||
      !/^\d+(?:\.\d+)?$/.test(winner.cost)
    )
      continue
    result.push({
      metric,
      configuration_ids: [...ids],
      names: ids.map((id) => names.get(id)!),
      tie: winner.tie,
      cost: winner.cost,
    })
  }
  return result
}
