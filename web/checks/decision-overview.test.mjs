import assert from 'node:assert/strict'
import { decisionResults } from '../src/decisionOverview.ts'

const results = {
  cost: { text: '\nCost result\nBlend A · version 2\nCost simulation\nPer usable item: 1 EUR\n', context: 'current' },
  checks: { text: '\nCheck results\nSorted B · version 1\nSoftware simulation\n', context: 'old' },
}
const output = decisionResults('Reshivo — mix calculation\nPlan: Sorted B · version 1\nMaterial tracked: Paper\nAdded material: Clean HDPE; 0% paper\nChosen composition: 0–2.9%\nOne displayed calculated amount is 14.5 kg.\nFull assumptions.', results, {cost:'current',checks:'current'})
assert.ok(output.mix.summary.some(line => line.includes('Sorted B · version 1')))
assert.ok(output.mix.summary.some(line => line.includes('14.5 kg')) && output.mix.summary.some(line => line.includes('Clean HDPE')))
assert.ok(output.mix.summary.some(line => line.includes('Paper')) && output.mix.summary.some(line => line.includes('0–2.9%')))
assert.ok(output.mix.detail.includes('Full assumptions.'))
assert.ok(output.cost.summary.some(line => line.includes('Blend A · version 2')) && output.cost.summary.some(line => line.includes('Cost simulation')))
assert.equal(output.checks, null, 'outdated readings cannot be shown as current')
assert.deepEqual(decisionResults('', results, {cost:'other',checks:'other'}), { mix: null, cost: null, checks: null })
assert.deepEqual(decisionResults('unrecognized solver output', {}, {cost:'',checks:''}).mix.summary, ['Composition simulation', 'Open the details to review this result.'])
assert.equal(decisionResults('unrecognized solver output', {}, {cost:'',checks:''}).mix.detail, 'unrecognized solver output')
console.log('Decision overview keeps plan identities and excludes stale results')
