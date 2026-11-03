import assert from 'node:assert/strict'
import { newCostDraft, newProjectWorkspace } from '../src/projectWorkspace.ts'
import { costRequest, costWinnerSummaries } from '../src/manufacturingCost.ts'

const field = (value) => ({ value, source: 'user_review', quote: value })
const workspace = newProjectWorkspace()
workspace.case_id = 'cost-case'
workspace.project.product = field('A floor mat')
const old = {
  id: 'setup-a',
  revision: 1,
  name: 'Original mat',
  materials: [
    { id: 'rubber', name: 'Named recycled rubber', amount: '1.000000000000000005', unit: 'lb' },
    { id: 'binder', name: 'Named binder', amount: '', unit: 'kg' },
  ],
  process: 'Recorded process one',
  geometry: 'Recorded thickness and installation',
  notes: 'Entered trial; not qualified',
}
const current = structuredClone(old)
current.revision = 2
current.process = 'Recorded process two'
current.materials[0].amount = '1.000000000000000006'
workspace.configurations = [old, current]
const draft = {
  ...newCostDraft(),
  currency: 'EUR',
  mass_basis: 'As received',
  functional_basis: 'Same-size floor mat, same use',
  acceptance_basis: 'User-stated criteria; physical performance not established by cost',
  prices: { rubber: '2.000000000000000005', binder: '' },
  process_statuses: { energy: 'unknown', labor: 'excluded', other: 'known' },
  energy_kwh: '999',
  energy_rate: '999',
  labor_hours: '999',
  labor_rate: '999',
  other_name: 'Packaging',
  other_charge: '',
  usable_count: '0',
  gross_count: '99',
  gross_mass_kg: '88',
  gross_area_m2: '77',
  accepted_fraction: '.2',
}
const beforeWorkspace = structuredClone(workspace)
const beforeDraft = structuredClone(draft)
const request = costRequest(workspace, current, draft)
assert.equal(request.case_id, 'cost-case')
assert.equal(request.configuration_id, 'setup-a')
assert.equal(request.configuration_revision, '2')
assert.equal(request.current_configuration_revision, '2')
assert.equal(
  request.materials[0].quantity,
  '1.000000000000000006',
  'entered decimal precision is never converted through Number',
)
assert.equal(
  request.materials[0].quantity_unit,
  'lb',
  'entered quantity units are retained independently of display preferences',
)
assert.equal(request.materials[0].unit_price, '2.000000000000000005')
assert.equal(
  request.materials[0].price_unit,
  'kg',
  'the price basis stays explicit when quantity units differ',
)
assert.equal(request.materials[1].quantity, '', 'unknown material amount never becomes zero')
assert.equal(request.materials[1].unit_price, '', 'unknown material price never becomes zero')
assert.deepEqual(
  request.process.energy,
  { status: 'unknown' },
  'stale entries in unknown categories are not charged',
)
assert.deepEqual(
  request.process.labor,
  { status: 'excluded' },
  'an explicitly excluded category is not silently priced',
)
assert.deepEqual(
  request.process.other.charges,
  [{ id: 'other', name: 'Packaging', amount: '' }],
  'a blank known other charge must reach validation as missing, not [] meaning zero',
)
assert.deepEqual(
  request.output,
  { mode: 'actual', acceptance_basis: draft.acceptance_basis, usable_count: '0' },
  'actual output retains explicit zero and ignores stale planned yield inputs',
)
assert.equal(
  Object.hasOwn(request, 'batch_mass'),
  false,
  'a missing batch mass is not inferred from ingredients',
)
assert.deepEqual(
  workspace,
  beforeWorkspace,
  'request construction cannot mutate captured setup versions',
)
assert.deepEqual(draft, beforeDraft, 'request construction cannot mutate the editable cost draft')

const historical = costRequest(workspace, old, draft)
assert.equal(historical.configuration_revision, '1')
assert.equal(
  historical.current_configuration_revision,
  '2',
  'a historical recipe cannot be relabeled as current',
)
assert.equal(
  historical.materials[0].quantity,
  '1.000000000000000005',
  'historical amounts remain tied to their captured version',
)
assert.throws(
  () => costRequest(workspace, { ...current, revision: 3 }, draft),
  /saved setup version/,
  'uncaptured versions cannot be costed under an existing identity',
)
assert.throws(
  () => costRequest(workspace, { ...current, process: 'Unsaved process' }, draft),
  /new setup version/,
  'changed process content cannot reuse a captured revision',
)
const altered = structuredClone(current)
altered.materials[0].amount = '2'
assert.throws(
  () => costRequest(workspace, altered, draft),
  /new setup version/,
  'changed ingredients cannot reuse a captured revision',
)

const free = costRequest(workspace, current, {
  ...draft,
  prices: { rubber: '0', binder: '0' },
  other_charge: '0',
})
assert.equal(free.materials[0].unit_price, '0', 'an explicitly entered zero price is retained')
assert.equal(
  free.process.other.charges[0].amount,
  '0',
  'an explicitly entered zero charge differs from missing',
)
const missing = costRequest(workspace, current, { ...draft, process_statuses: undefined })
for (const category of ['energy', 'labor', 'other'])
  assert.deepEqual(missing.process[category], { status: 'unknown' })

const planned = costRequest(workspace, current, {
  ...draft,
  mode: 'planned',
  usable_count: '1234',
  usable_mass_kg: '5678',
  usable_area_m2: '9999',
  gross_count: '10',
  gross_mass_kg: '20',
  gross_area_m2: '',
  accepted_fraction: '.8',
  batch_mass_kg: '25',
})
assert.deepEqual(
  planned.output,
  {
    mode: 'planned',
    acceptance_basis: draft.acceptance_basis,
    gross_count: '10',
    gross_mass_kg: '20',
    accepted_fraction: '.8',
  },
  'planned output sends gross values and fraction once; no pre-applied or duplicate yield',
)
assert.deepEqual(planned.batch_mass, { quantity: '25', unit: 'kg', basis: 'As received' })
assert.equal(Object.hasOwn(planned.output, 'usable_count'), false)
assert.equal(Object.hasOwn(planned.output, 'usable_mass_kg'), false)
assert.equal(Object.hasOwn(planned.output, 'usable_area_m2'), false)
assert.equal(
  Object.hasOwn(planned.output, 'gross_area_m2'),
  false,
  'unused denominators are absent, not fabricated zero',
)

request.materials[0].quantity = 'Changed request only'
request.process.other.charges[0].amount = 'Changed request only'
assert.deepEqual(workspace, beforeWorkspace, 'the outgoing request owns independent material rows')
assert.deepEqual(draft, beforeDraft, 'the outgoing request owns independent charge rows')

const setups = [
  { id: 'a', name: 'Mat A' },
  { id: 'b', name: 'Mat B' },
]
const valid = {
  comparable: true,
  winners: {
    per_usable_unit: { configuration_ids: ['a'], tie: false, cost: '0.000000000000000005' },
    per_usable_kg: { configuration_ids: ['a', 'b'], tie: true, cost: '2.5' },
    per_usable_m2: null,
  },
}
assert.deepEqual(
  costWinnerSummaries(valid, setups),
  [
    {
      metric: 'per_usable_unit',
      configuration_ids: ['a'],
      names: ['Mat A'],
      tie: false,
      cost: '0.000000000000000005',
    },
    {
      metric: 'per_usable_kg',
      configuration_ids: ['a', 'b'],
      names: ['Mat A', 'Mat B'],
      tie: true,
      cost: '2.5',
    },
  ],
  'object-shaped winners and unavailable denominators are handled without casts or precision loss',
)
assert.deepEqual(
  costWinnerSummaries({ ...valid, comparable: false }, setups),
  [],
  'incomparable records never produce a lowest-cost claim',
)
for (const value of [
  null,
  undefined,
  [],
  {},
  { winners: null },
  { comparable: true, winners: { per_usable_unit: null } },
])
  assert.deepEqual(costWinnerSummaries(value, setups), [], 'missing or null winners are safe')
for (const winner of [
  [],
  ['a'],
  { configuration_ids: ['missing'], tie: false, cost: '1' },
  { configuration_ids: ['a', 'a'], tie: true, cost: '1' },
  { configuration_ids: ['a', 'b'], tie: false, cost: '1' },
  { configuration_ids: [1], tie: false, cost: '1' },
  { configuration_ids: ['a'], tie: false, cost: 'NaN' },
  { configuration_ids: ['a'], tie: false, cost: '-1' },
  { configuration_ids: ['a'], tie: false, cost: 1 },
]) {
  assert.deepEqual(
    costWinnerSummaries({ comparable: true, winners: { per_usable_unit: winner } }, setups),
    [],
    'malformed winner metadata is never presented as a price comparison',
  )
}
assert.deepEqual(
  costWinnerSummaries(
    { comparable: true, winners: { invented_metric: valid.winners.per_usable_unit } },
    setups,
  ),
  [],
  'only known cost denominators are presented',
)
const summary = costWinnerSummaries(valid, setups)
summary[0].configuration_ids.push('changed')
summary[0].names[0] = 'Changed'
assert.deepEqual(
  valid.winners.per_usable_unit.configuration_ids,
  ['a'],
  'presenting a winner never mutates its API record',
)
assert.equal(setups[0].name, 'Mat A')

console.log(
  'manufacturing cost requests preserve exact versioned inputs, unknown versus zero, explicit yield modes and safe scoped winner records',
)
