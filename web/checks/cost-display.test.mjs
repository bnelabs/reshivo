import assert from 'node:assert/strict'
import { displayCostAmount, costIssueText, roundedWinnerCollision } from '../src/costDisplay.ts'

assert.equal(displayCostAmount('0'), '0')
assert.equal(displayCostAmount('0.0000000000000000000001'), '1e-22')
assert.equal(displayCostAmount('123456789012345678901234567890'), '1.2345679e+29')
assert.equal(displayCostAmount('0.00004'), '0.00004')
assert.equal(displayCostAmount('0.0000000009999999999'), '1e-9')
assert.equal(displayCostAmount('0.000000000000000000000123456789'), '1.2345679e-22')
assert.equal(displayCostAmount('0.' + '0'.repeat(400) + '1'), '1e-401')
assert.equal(displayCostAmount('9'.repeat(400)), '1e+400')
assert.equal(displayCostAmount(null), 'Unknown')
assert.equal(displayCostAmount('NaN'), 'Unknown')
assert.equal(costIssueText({field:'output.acceptance_basis', question:'What makes an item usable?', category:'output'}), 'Describe what makes an item usable for this estimate.')
assert.equal(costIssueText({field:'materials.0', message:'Enter a price.'}), 'Enter a price.')
assert.equal(costIssueText({field:'functional_basis', question:'technical wording'}), 'Describe the product and use that these costs cover.')
assert.equal(costIssueText({field:'materials.0.basis', question:'technical wording'}), 'Say whether your material amounts and prices use the same condition, such as wet or dry.')
assert.equal(costIssueText({field:'unknown'}), 'Review this cost input.')

const comparison = {
  decisions: { per_usable_unit: {configuration_ids:['a'], tie:false} },
  configurations: [
    {id:'a',state:'all_entered_checks_in_range',cost:{unit_costs:{per_usable_unit:'2.0000000000000000000001'}}},
    {id:'b',state:'all_entered_checks_in_range',cost:{unit_costs:{per_usable_unit:'2.0000000000000000000002'}}},
  ],
}
assert.equal(roundedWinnerCollision(comparison,'per_usable_unit'), true)
comparison.configurations[1].state = 'out_of_range'
assert.equal(roundedWinnerCollision(comparison,'per_usable_unit'), false)
comparison.configurations[1].state = 'all_entered_checks_in_range'
comparison.decisions.per_usable_unit = {configuration_ids:['a','b'], tie:true}
assert.equal(roundedWinnerCollision(comparison,'per_usable_unit'), false)
console.log('Cost displays preserve small positive values, explain close comparisons and present questions plainly')
