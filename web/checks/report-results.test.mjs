import assert from 'node:assert/strict'
import { formatCostResult, formatComparisonResult, formatCheckResults, reportResultContext } from '../src/reportResults.ts'

const workspace = {
  case_id: 'case', project: { product: { value: 'mat' } },
  configurations: [
    { id: 'one', revision: 1, name: 'First plan', notes: '', materials: [], process: '', geometry: '' },
    { id: 'two', revision: 1, name: 'Second plan', notes: '', materials: [], process: '', geometry: '' },
  ],
  checks: [{ id: 'grip', name: 'Grip', unit: 'N', method: 'test', minimum: '1', maximum: '3', required: true }],
  records: [], costs: {}, record_exclusions: {}, trial_ideas: {},
}
const initial = reportResultContext(workspace, 'user_reported', true)
assert.notEqual(initial, reportResultContext({ ...workspace, records: [{ id: 'new' }] }, 'user_reported', true))
assert.notEqual(initial, reportResultContext({ ...workspace, costs: { one: { currency: 'EUR' } } }, 'user_reported', true))
assert.notEqual(initial, reportResultContext(workspace, 'synthetic', true))
assert.notEqual(initial, reportResultContext(workspace, 'user_reported', false))
assert.equal(initial, reportResultContext({ ...workspace, intake_notes: 'unrelated note' }, 'user_reported', true))

const partial = { status: 'partial', costs: { entered_scope_total: null, known_subtotal: '0' },
  unit_costs: { per_usable_unit: '0.05', per_usable_kg: null }, unit_costs_scope: 'known_subtotal' }
const cost = formatCostResult(partial, 'First plan', 1, 'EUR', 'planned')
assert.match(cost, /Known subtotal; costs are missing/)
assert.match(cost, /Known batch subtotal: 0 EUR/)
assert.match(cost, /Per usable item \(subtotal only\): 0.05 EUR/)
assert.doesNotMatch(cost, /Batch cost \(included costs\)/)
const complete = formatCostResult({ status: 'complete', costs: { entered_scope_total: '25' }, unit_costs: {} }, 'First plan', 1, 'EUR', 'actual')
assert.match(complete, /Batch cost \(included costs\): 25 EUR/)

const assessment = { configurations: [
  { id: 'one', revision: 1, state: 'all_entered_checks_in_range', checks: [{ check_id: 'grip', state: 'entered_readings_in_range', reading_count: 2, minimum_entered: '1.2', maximum_entered: '1.5', unit: 'N' }] },
  { id: 'two', revision: 1, state: 'missing_records', checks: [{ check_id: 'grip', state: 'missing_records' }] },
] }
const checkText = formatCheckResults(assessment, workspace, 'synthetic', true)
assert.match(checkText, /Software simulation · simulated readings/)
assert.match(checkText, /First plan · version 1: Required active readings in range/)
assert.match(checkText, /Second plan · version 1: Checks still missing/)
assert.match(checkText, /Grip: Entered readings in range/)
assert.match(checkText, /Entered readings \(2\): 1.2–1.5 N/)
assert.doesNotMatch(checkText, /batches/)
const comparison = formatComparisonResult({ configurations: [{ id: 'one', revision: 1, state: 'all_entered_checks_in_range', cost: { ...partial, currency: 'EUR' }, checks: [] }] }, workspace, 'user_reported', true)
assert.match(comparison, /Cost simulation · entered readings/)
assert.match(comparison, /Known batch subtotal: 0 EUR/)
assert.doesNotMatch(comparison, /Lowest/)
console.log('Report results preserve scopes, source and staleness context')
