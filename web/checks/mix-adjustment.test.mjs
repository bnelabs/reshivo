import assert from 'node:assert/strict'
import { confirmSavedMixAdjustment, emptyMixAdjustmentDraft, formatMixMass, mixAdditionKind, mixAdjustmentKey, mixAdjustmentPrecisionProblem, mixAdjustmentRequest, mixDecimalRoundTrips, mixDraftNeedsProjectReview, mixMassCanonical, mixMassEntryState, savedMixAdjustment, savedMixAdjustmentRecord, updateSavedMixAdjustment } from '../src/mixAdjustment.ts'
import { newProjectWorkspace, parseProjectWorkspace, serializeProjectWorkspace } from '../src/projectWorkspace.ts'

const input = { inputMass: '1.4', inputMin: '46', inputMax: '46', additionName: 'Stock A', additionPercent: '0', targetMin: '35', targetMax: '35' }
assert.equal(mixAdjustmentRequest('PCRPE', emptyMixAdjustmentDraft()), null, 'unknown values are not zero')
assert.deepEqual(mixAdjustmentRequest('PCRPE', input), { component: 'PCRPE', input_mass_kg: 1.4, input_min_percent: 46, input_max_percent: 46, addition_name: 'Stock A', addition_percent: 0, target_min_percent: 35, target_max_percent: 35 })
for (const [field, value] of [['inputMass','0'], ['inputMass','1e-9999'], ['inputMin',''], ['inputMax','101'], ['additionPercent','-1'], ['targetMin','36'], ['additionName',''], ['inputMin','0x10']]) {
  assert.equal(mixAdjustmentRequest('PCRPE', { ...input, [field]: value }), null, `${field}=${value} must not produce a request`)
}
assert.equal(mixAdjustmentRequest('x'.repeat(160), input)?.component.length, 160)
assert.equal(mixAdjustmentRequest('x'.repeat(161), input), null)
assert.match(formatMixMass(Number.MIN_VALUE, 'metric'), /5e-324/)
assert.match(formatMixMass(Number.MIN_VALUE, 'us'), /5e-324 kg/)
assert.equal(mixAdditionKind(0, -0), 'zero_only', 'negative zero is not a positive optional interval')
assert.equal(mixAdditionKind(0, 0.1), 'zero_optional')
assert.equal(mixAdditionKind(0.5, 0.5), 'one_amount')
for (const s of ['50.000000000000001', '5.0000000000000001e1', '1e-324', '-0', '-0e12']) assert.equal(mixDecimalRoundTrips(s), false, `${s} cannot be sent as a silently changed JSON number`)
for (const s of ['50.0000', '5e1', '1e-7', '0.1', '+0']) assert.equal(mixDecimalRoundTrips(s), true, `${s} has the same decimal value after JSON serialization`)
assert.equal(mixAdjustmentRequest('PCRPE', { ...input, inputMin:'50.000000000000001' }), null)
assert.equal(mixAdjustmentPrecisionProblem({ ...input, inputMin:'50.000000000000001' }, 'metric'), 'lowest input percentage')
assert.equal(mixMassCanonical('1.4', 'us'), '0.635029318', 'ordinary US input converts without silently rounding its decimal meaning')
assert.equal(mixMassCanonical('0.1', 'us'), '0.045359237')
assert.match(mixMassCanonical('1.2345678901234567', 'us'), /^invalid:/, 'a US conversion that would lose decimal precision is refused')
assert.match(mixMassCanonical('-0', 'metric'), /^invalid:/)
assert.equal(mixMassCanonical('unidentified text', 'us'), 'invalid:unidentified text', 'all unfinished text is saved as invalid rather than reinterpreted')
const setup = { id:'a', revision:1, materials:[{ id:'m', name:'PCRPE', amount:'20', unit:'mass_percent' }], process:'P1' }
const key = mixAdjustmentKey('case', setup, 'm', input)
assert.notEqual(key, mixAdjustmentKey('case', { ...setup, revision:2 }, 'm', input))
assert.notEqual(key, mixAdjustmentKey('case', { ...setup, process:'P2' }, 'm', input))
assert.notEqual(key, mixAdjustmentKey('other-case', setup, 'm', input))
assert.notEqual(key, mixAdjustmentKey('case', setup, 'm', { ...input, inputMin:'47' }))
assert.notEqual(key, mixAdjustmentKey('case', setup, 'other-material', input))
const fullSetup = { ...setup, name:'A', geometry:'shape', notes:'' }
const initial = newProjectWorkspace()
initial.case_id = 'case'
initial.configurations = [fullSetup]
const material = fullSetup.materials[0]
let edited = initial
for (const [field, value] of Object.entries(input)) edited = updateSavedMixAdjustment(edited, 'case', fullSetup, material, initial.project, field, value)
assert.deepEqual(savedMixAdjustment(edited, fullSetup, material), input, 'all user-entered values remain intact')
assert.equal(initial.mix_adjustment_drafts.length, 0, 'updates do not mutate previous state')
const saved = JSON.parse(serializeProjectWorkspace(edited))
assert.deepEqual(Object.keys(saved.mix_adjustment_drafts[0]).sort(), ['case_id','component_id','component_name','configuration_id','configuration_revision','project_snapshot','values'])
const reopened = parseProjectWorkspace(JSON.stringify(saved))
assert.deepEqual(savedMixAdjustment(reopened, fullSetup, material), input, 'draft inputs survive Save/Open')
assert.equal(JSON.stringify(saved).includes('example_addition_kg'), false, 'no calculation result is persisted')
const latest = { ...structuredClone(fullSetup), revision:2, process:'changed process' }
reopened.configurations.push(latest)
assert.deepEqual(savedMixAdjustment(reopened, latest, material), emptyMixAdjustmentDraft(), 'old draft never fills a new revision')
assert.deepEqual(savedMixAdjustment(reopened, fullSetup, material), input, 'historical draft remains in the original revision')
const afterRevision = updateSavedMixAdjustment(reopened, 'case', latest, material, reopened.project, 'inputMass', '2')
assert.equal(afterRevision.mix_adjustment_drafts.length, 2)
assert.equal(savedMixAdjustment(afterRevision, fullSetup, material).inputMass, '1.4')
assert.equal(savedMixAdjustment(afterRevision, latest, material).inputMass, '2')
const changedBeforeUpdate = { ...initial, configurations: [{ ...fullSetup, process:'different' }] }
assert.equal(updateSavedMixAdjustment(changedBeforeUpdate, 'case', fullSetup, material, initial.project, 'inputMass', '2'), changedBeforeUpdate, 'a concurrent setup edit is never overwritten')
assert.equal(updateSavedMixAdjustment(initial, 'other-case', fullSetup, material, initial.project, 'inputMass', '2'), initial, 'a different case is never overwritten')
const changedProject = structuredClone(edited)
changedProject.project.input = { value:'Different stream', source:'user_review', quote:'Different stream' }
const oldSnapshot = savedMixAdjustmentRecord(changedProject, fullSetup, material).project_snapshot
assert.notDeepEqual(oldSnapshot, changedProject.project, 'changed project remains visibly unreviewed')
assert.equal(mixDraftNeedsProjectReview(savedMixAdjustmentRecord(changedProject, fullSetup, material), changedProject.project), true)
assert.equal(updateSavedMixAdjustment(changedProject, 'case', fullSetup, material, initial.project, 'inputMass', '3'), changedProject, 'an edit captured before a project change cannot be rebound')
const changedInput = updateSavedMixAdjustment(changedProject, 'case', fullSetup, material, changedProject.project, 'inputMass', '3')
assert.deepEqual(savedMixAdjustmentRecord(changedInput, fullSetup, material).project_snapshot, oldSnapshot, 'editing a number does not silently approve new project context')
const reopenedChanged = parseProjectWorkspace(serializeProjectWorkspace(changedInput))
assert.notDeepEqual(savedMixAdjustmentRecord(reopenedChanged, fullSetup, material).project_snapshot, reopenedChanged.project, 'reopening preserves the need for explicit review')
const confirmed = confirmSavedMixAdjustment(reopenedChanged, 'case', fullSetup, material, reopenedChanged.project)
assert.deepEqual(savedMixAdjustmentRecord(confirmed, fullSetup, material).project_snapshot, confirmed.project, 'explicit review binds the draft to the reviewed project')
assert.equal(mixDraftNeedsProjectReview(savedMixAdjustmentRecord(confirmed, fullSetup, material), confirmed.project), false)
assert.equal(savedMixAdjustment(confirmed, fullSetup, material).inputMass, '3', 'review preserves entered numbers')
assert.equal(confirmSavedMixAdjustment(changedProject, 'case', fullSetup, material, initial.project), changedProject, 'a stale review cannot authorize a changed project')
for (const [description, mutate] of [
  ['foreign case', (d) => { d.case_id = 'elsewhere' }],
  ['missing version', (d) => { d.configuration_revision = 999 }],
  ['boolean version', (d) => { d.configuration_revision = true }],
  ['missing component', (d) => { d.component_id = 'other' }],
  ['renamed component', (d) => { d.component_name = 'different' }],
  ['calculated output', (d) => { d.result = { example_addition_kg: 2 } }],
  ['invented measured input', (d) => { d.values.physical_performance_verified = true }],
  ['invalid project snapshot', (d) => { d.project_snapshot.input = { value:'A', source:'user_review', quote:'B' } }],
  ['numeric value instead of entered text', (d) => { d.values.inputMass = 2 }],
  ['oversized name', (d) => { d.values.additionName = 'x'.repeat(121) }],
  ['oversized mass input', (d) => { d.values.inputMass = 'x'.repeat(169) }],
  ['oversized percent', (d) => { d.values.inputMin = 'x'.repeat(161) }],
]) {
  const bad = structuredClone(saved)
  mutate(bad.mix_adjustment_drafts[0])
  assert.throws(() => parseProjectWorkspace(JSON.stringify(bad)), undefined, description)
}
const duplicate = structuredClone(saved)
duplicate.mix_adjustment_drafts.push(structuredClone(duplicate.mix_adjustment_drafts[0]))
assert.throws(() => parseProjectWorkspace(JSON.stringify(duplicate)), /unique/)
const oldFile = structuredClone(saved)
delete oldFile.mix_adjustment_drafts
assert.equal(Object.hasOwn(parseProjectWorkspace(JSON.stringify(oldFile)), 'mix_adjustment_drafts'), false, 'old v2 files remain readable')
assert.deepEqual(savedMixAdjustment(parseProjectWorkspace(JSON.stringify(oldFile)), fullSetup, material), emptyMixAdjustmentDraft())
const mixedCase = structuredClone(saved)
mixedCase.mix_adjustment_drafts[0].values.inputMass = 'invalid:1x'
assert.equal(parseProjectWorkspace(JSON.stringify(mixedCase)).mix_adjustment_drafts[0].values.inputMass, 'invalid:1x', 'unfinished legacy input is preserved without inventing a unit')
const legacyInvalid = parseProjectWorkspace(JSON.stringify(mixedCase)).mix_adjustment_drafts[0].values
for (const system of ['metric', 'us']) {
  const state = mixMassEntryState(legacyInvalid, system)
  assert.equal(state.locked, true, 'legacy invalid value is locked because its origin is unknown')
  assert.equal(state.enteredUnit, 'unit not recorded')
  assert.equal(state.displayValue, 'invalid:1x')
}
const legacyUnmarked = { ...legacyInvalid, inputMass:'not a number' }
assert.deepEqual(mixMassEntryState(legacyUnmarked, 'us'), { invalid:true, locked:true, origin:undefined, enteredUnit:'unit not recorded', displayValue:'invalid:not a number' })
const raw = '1.2345678901234567'
const invalidUs = mixMassCanonical(raw, 'us')
const draftWithOrigin = updateSavedMixAdjustment(edited, 'case', fullSetup, material, initial.project, 'inputMass', invalidUs, 'us')
const restoredWithOrigin = parseProjectWorkspace(serializeProjectWorkspace(draftWithOrigin))
const restoredDraft = savedMixAdjustment(restoredWithOrigin, fullSetup, material)
assert.equal(restoredDraft.inputMass, `invalid:${raw}`)
assert.equal(restoredDraft.inputMassOrigin, 'us')
assert.deepEqual(mixMassEntryState(restoredDraft, 'us'), { invalid:true, locked:false, origin:'us', enteredUnit:'lb', displayValue:`invalid:${raw}` })
assert.deepEqual(mixMassEntryState(restoredDraft, 'metric'), { invalid:true, locked:true, origin:'us', enteredUnit:'lb', displayValue:`invalid:${raw}` })
assert.equal(mixAdjustmentRequest('PCRPE', restoredDraft), null, 'switching units cannot make unfinished text calculable')
const corrected = updateSavedMixAdjustment(restoredWithOrigin, 'case', fullSetup, material, initial.project, 'inputMass', mixMassCanonical('1.4', 'us'), 'us')
assert.equal(savedMixAdjustment(corrected, fullSetup, material).inputMass, '0.635029318')
assert.equal(Object.hasOwn(savedMixAdjustment(corrected, fullSetup, material), 'inputMassOrigin'), false, 'a corrected canonical mass needs no origin marker')
assert.equal(mixMassEntryState(savedMixAdjustment(corrected, fullSetup, material), 'metric').locked, false)
const unicodeMax = '🙂'.repeat(80)
assert.equal(unicodeMax.length, 160, 'field bounds match browser UTF-16 length')
const invalidUnicode = updateSavedMixAdjustment(edited, 'case', fullSetup, material, initial.project, 'inputMass', mixMassCanonical(unicodeMax, 'us'), 'us')
assert.equal(parseProjectWorkspace(serializeProjectWorkspace(invalidUnicode)).mix_adjustment_drafts[0].values.inputMass.length, 168)
const invalidOrigin = structuredClone(saved)
invalidOrigin.mix_adjustment_drafts[0].values.inputMassOrigin = 'us'
assert.throws(() => parseProjectWorkspace(JSON.stringify(invalidOrigin)), /invalid mass/i, 'valid canonical values must not be relabeled by origin metadata')
console.log('Mix adjustment requires explicit values and binds results to the project, setup and component')
