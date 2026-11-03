import assert from 'node:assert/strict'
import { selectedCurrentSetup, setupRevisionNotice } from '../src/setupSelection.ts'
import { savedMixAdjustment } from '../src/mixAdjustment.ts'
import { newCostDraft } from '../src/projectWorkspace.ts'

const a = { id: 'A', revision: 1 }
const oldB = { id: 'B@stock', revision: 1 }
const newB = { id: 'B@stock', revision: 2 }
assert.equal(selectedCurrentSetup([a, newB], oldB.id), newB, 'keep B, not the first setup A')
assert.equal(selectedCurrentSetup([newB, a], a.id), a, 'selection is independent of order')
assert.equal(selectedCurrentSetup([a], 'missing'), undefined, 'a missing explicit selection must be chosen again')
assert.equal(selectedCurrentSetup([a], ''), a, 'a new workspace can start with its first setup')
assert.equal(setupRevisionNotice(oldB, newB), 'Showing version 2 of this setup.')
assert.equal(setupRevisionNotice(a, oldB), '', 'an ordinary setup selection is not a version change')
const material = { id: 'm', name: 'stock' }
const oldDraft = { inputMass:'1', inputMin:'26', inputMax:'26', additionName:'binder', additionPercent:'0', targetMin:'20', targetMax:'20' }
const workspace = { case_id:'case', mix_adjustment_drafts:[{ case_id:'case', configuration_id:oldB.id, configuration_revision:1, component_id:'m', component_name:'stock', values:oldDraft }], costs:{ [`${oldB.id}@1`]:{currency:'EUR'} } }
assert.equal(savedMixAdjustment(workspace, newB, material).inputMass, '', 'old mix inputs do not follow the new version')
assert.equal((workspace.costs[`${newB.id}@2`] ?? newCostDraft()).currency, '', 'old costs do not follow the new version')
console.log('Setup selection follows the same setup across versions without reusing old inputs')
