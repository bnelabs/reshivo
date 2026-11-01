import type { AdvisorBrief, AssemblyObservationFields, CalculationDetails } from './types'
import type { BalanceFields } from './components/BalancePlanner'

export const balanceDemoBrief: AdvisorBrief = {
  input:
    'Synthetic example of a recycled metal-rich core with a small binder, held in a contained module. No material was processed.',
  variation:
    'Changing prepared input can change the measured assembly mass and balance point. Each observation is separate; no future-batch range is inferred.',
  contamination:
    'Unknown. This example does not assign contaminant effects or change the binder recipe.',
  product: 'Contained ballast module',
  use_case:
    'A noncritical desk ballast module with an allowed one-axis balance range. Software demonstration only.',
  targets:
    'Assembled mass 0.98–1.02 kg; centre of mass x between -2 and 2 mm. Retention, durability and tipping safety need separate checks.',
  process:
    'No physical handling or processing. Proposed adjustments use suitable presealed trim units at stated mass-centre locations.',
  available_changes:
    'Keep the target and recycled core. Add or remove sealed trim units at two known mass-centre locations, within the stated local and total limits.',
}
export const balanceDemoDetails: CalculationDetails = {
  label: 'Synthetic mass and balance demo',
  components: [{ id: 1, name: '', role: 'main', amount: '' }],
  amount_unit: 'g',
  amount_basis: '',
  mass_target_min_kg: '0.98',
  mass_target_max_kg: '1.02',
  balance: {
    coordinate_basis:
      'Synthetic fixture: x=0 is the desired assembly balance point. All x values locate measured trim mass centres along the same axis; position uncertainty is explicitly zero in this example.',
    target_min_mm: '-2',
    target_max_mm: '2',
  },
}
export const balanceDemoObservation: AssemblyObservationFields = {
  id: 'balance-demo-1',
  kind: 'simulated',
  mass: '0.95',
  error: '0.005',
  maxAdd: '0.15',
  maxRemove: '0.08',
  adjustmentError: '0.001',
  idealFeedback: false,
}
export const balanceDemoFields: BalanceFields = {
  cg: '10',
  cgError: '0.5',
  resolutionG: '1',
  independent: true,
  positions: [
    { id: 'left', x: '-60', error: '0', addG: '150', removeG: '0' },
    { id: 'right', x: '60', error: '0', addG: '150', removeG: '80' },
  ],
  baselineIndex: '0',
  baselineG: '50',
}
