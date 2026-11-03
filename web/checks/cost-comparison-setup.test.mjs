import assert from 'node:assert/strict'
import { newCostDraft, newProjectWorkspace, serializeProjectWorkspace, parseProjectWorkspace } from '../src/projectWorkspace.ts'
import { reuseCostComparisonDetails } from '../src/costComparisonSetup.ts'

const w = newProjectWorkspace()
const source = { id:'source', revision:1, name:'A', materials:[{id:'a',name:'Rubber',amount:'1',unit:'kg'}], process:'', geometry:'', notes:'' }
const untouched = { ...structuredClone(source), id:'new', name:'B', materials:[{id:'b',name:'Binder',amount:'2',unit:'kg'}] }
const partial = { ...structuredClone(source), id:'partial', name:'C' }
const oldVersion = { ...structuredClone(source), id:'old', revision:1, name:'Old' }
const currentVersion = { ...structuredClone(oldVersion), revision:2 }
w.configurations = [source, untouched, partial, oldVersion, currentVersion]
w.costs['source@1'] = { ...newCostDraft(), currency:'EUR', mass_basis:'dry', functional_basis:'same mat', acceptance_basis:'same grip', mode:'planned', prices:{a:'5'}, usable_count:'9', accepted_fraction:'0.8', process_statuses:{energy:'excluded', labor:'known', other:'unknown'} }
w.costs['partial@1'] = { ...newCostDraft(), currency:'USD', prices:{a:'3'} }
const original = structuredClone(w)
const updated = reuseCostComparisonDetails(w, source)
assert.deepEqual(w, original, 'original project is not mutated')
assert.deepEqual(updated.costs['partial@1'], w.costs['partial@1'], 'started cost drafts stay unchanged')
assert.equal(updated.costs['old@1'], undefined, 'historical versions do not acquire current settings')
for (const key of ['new@1','old@2']) {
  const d = updated.costs[key]
  assert.deepEqual([d.currency,d.functional_basis,d.acceptance_basis,d.mode], ['EUR','same mat','same grip','planned'])
  assert.deepEqual(d.prices, {}, 'prices remain specific to each setup')
  assert.equal(d.mass_basis, '', 'material condition must be entered for each setup')
  assert.equal(d.accepted_fraction, '', 'yield is not copied')
  assert.equal(d.usable_count, '', 'output is not copied')
  assert.deepEqual(d.process_statuses, {energy:'unknown',labor:'unknown',other:'unknown'}, 'scope decisions are not copied')
}
assert.deepEqual(parseProjectWorkspace(serializeProjectWorkspace(updated)).costs, updated.costs, 'details survive project save and open')
assert.equal(reuseCostComparisonDetails(w, { ...source, revision:2 }), w, 'uncaptured versions cannot supply shared details')
assert.equal(reuseCostComparisonDetails(w, { ...source, process:'unsaved' }), w, 'changed unsaved setups cannot supply details')
const empty = structuredClone(w); empty.costs['source@1'] = newCostDraft()
assert.equal(reuseCostComparisonDetails(empty, source), empty, 'empty comparison details do not create drafts')
console.log('Shared cost definitions copy only to untouched current setups; prices, scope and output stay separate')
