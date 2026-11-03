import assert from 'node:assert/strict'
import { canReattachMixCalculation, mixQuestionFingerprint, mixQuestionIsCurrent, prepareMixCalculation } from '../src/mixQuestion.ts'
import { newProjectWorkspace, parseProjectWorkspace, serializeProjectWorkspace } from '../src/projectWorkspace.ts'
import { mixAdjustmentRequest, savedMixAdjustment, updateSavedMixAdjustment, useRecordedRecipeTarget } from '../src/mixAdjustment.ts'

const project = { case_id: 'case', project: { input: 'rubber' }, configurations: [{ id: 'setup', revision: 1 }], mix_adjustment_drafts: [{ inputMin: '26' }] }
const prepared = mixQuestionFingerprint(project, 1)
assert.equal(mixQuestionIsCurrent(prepared, mixQuestionFingerprint(structuredClone(project), 1)), true)
assert.equal(mixQuestionIsCurrent(null, mixQuestionFingerprint(project, 1)), true)
assert.equal(mixQuestionIsCurrent(prepared, mixQuestionFingerprint({ ...project, case_id: 'other' }, 1)), false)
assert.equal(mixQuestionIsCurrent(prepared, mixQuestionFingerprint({ ...project, project: { input: 'new stock' } }, 1)), false)
assert.equal(mixQuestionIsCurrent(prepared, mixQuestionFingerprint({ ...project, configurations: [{ id: 'setup', revision: 2 }] }, 1)), false)
assert.equal(mixQuestionIsCurrent(prepared, mixQuestionFingerprint({ ...project, mix_adjustment_drafts: [{ inputMin: '27' }] }, 1)), false)
assert.equal(mixQuestionIsCurrent(prepared, mixQuestionFingerprint(project, 2)), false)

const ingredient = (id, name, amount) => ({ id, name, amount, unit: 'kg' })
const recipe = (id, revision, materials) => ({ id, revision, name: 'Same name', materials, process: 'press', geometry: 'sheet', notes: '' })
const source = recipe('source', 1, [ingredient('paper', 'paper', '1'), ingredient('base', 'base', '4')])
const newer = recipe('source', 2, [ingredient('paper', 'paper', '2'), ingredient('base', 'base', '3')])
const destination = recipe('destination', 1, [ingredient('paper2', 'paper', '3'), ingredient('base2', 'base', '2')])
let workspace = newProjectWorkspace()
workspace.configurations = [source, newer, destination]
const component = destination.materials[0]
workspace = useRecordedRecipeTarget(workspace, workspace.case_id, destination, component, workspace.project, source, source.materials[0], 2)
for (const [field, value] of Object.entries({ inputMass: '1', inputMin: '25', inputMax: '25', additionName: 'clean stock', additionPercent: '0' }))
  workspace = updateSavedMixAdjustment(workspace, workspace.case_id, destination, component, workspace.project, field, value)
const inputs = mixAdjustmentRequest(component.name, savedMixAdjustment(workspace, destination, component))
const binding = prepareMixCalculation(workspace, destination, component, inputs)
const recent = mixQuestionFingerprint(workspace, 1)
assert.equal(canReattachMixCalculation(binding, recent, recent), true, 'a detached current calculation may be explicitly reattached')
assert.equal(canReattachMixCalculation(null, recent, recent), false, 'no calculation means nothing to attach')
assert.equal(canReattachMixCalculation(binding, null, recent), false, 'an unbound calculation cannot be attached')
assert.equal(canReattachMixCalculation(binding, recent, mixQuestionFingerprint({ ...workspace, checks: [{ id: 'new check' }], records: [{ id: 'new reading' }] }, 1)), true, 'independent checks do not invalidate mix arithmetic')
assert.equal(canReattachMixCalculation(binding, recent, mixQuestionFingerprint(workspace, 2)), false, 'opening a project requires a fresh calculation')
assert.equal(canReattachMixCalculation(binding, recent, mixQuestionFingerprint({ ...workspace, case_id: 'new case' }, 1)), false, 'a calculation cannot follow another case')
assert.equal(canReattachMixCalculation(binding, recent, mixQuestionFingerprint({ ...workspace, configurations: [...workspace.configurations, { ...destination, revision: 2 }] }, 1)), false, 'a changed setup invalidates the attachment')
assert.equal(binding.case_id, workspace.case_id)
assert.equal(binding.configuration_id, 'destination')
assert.deepEqual(binding.source, { configuration_id: 'source', configuration_revision: 1, component_id: 'paper', latest_revision_at_review: 2, basis: 'whole_recipe' })
assert.deepEqual(prepareMixCalculation(parseProjectWorkspace(serializeProjectWorkspace(workspace)), destination, component, inputs), binding, 'source binding survives project Save/Open')
const snapshot = { case_id: workspace.case_id,
  destination: { id: destination.id, revision: destination.revision, component_id: component.id, component_name: component.name },
  inputs, source_recipe: { id: source.id, revision: source.revision, name: source.name,
    component_id: 'paper', component_name: 'paper', basis: 'whole_recipe', fraction: { numerator: '1', denominator: '5' },
    materials: source.materials, process: source.process, geometry: source.geometry, readings_included: false } }
const withNote = { ...workspace, advice_notes: [{ id: 'note', created_at: '2026-11-03T00:00:00Z', provider: 'meta', model: 'fixture', project_snapshot: workspace.project,
  configuration_versions: [{ id: 'destination', revision: 1 }], assessment_kind: 'synthetic', text: 'Saved advice', kind: 'model_proposal', mix_context: snapshot }] }
const noteReopened = parseProjectWorkspace(serializeProjectWorkspace(withNote))
assert.deepEqual(noteReopened.advice_notes[0].mix_context, snapshot, 'the advice keeps its original source recipe after Save/Open')
const forged = structuredClone(withNote); forged.advice_notes[0].mix_context.case_id = 'different-case'
assert.throws(() => parseProjectWorkspace(JSON.stringify(forged)), /must belong to its project/i)
const changedNote = structuredClone(withNote); changedNote.advice_notes[0].mix_context.source_recipe.fraction.numerator = '2'
assert.throws(() => parseProjectWorkspace(JSON.stringify(changedNote)), /fraction must match/i, 'a saved note cannot silently attribute a different source composition')
const changed = { ...workspace, configurations: [...workspace.configurations, { ...newer, revision: 3 }] }
assert.equal(prepareMixCalculation(changed, destination, component, inputs), null, 'new source version needs review')
assert.equal(prepareMixCalculation(workspace, destination, component, { ...inputs, input_mass_kg: 9 }), null, 'changed calculation inputs need recalculation')
const manual = updateSavedMixAdjustment(workspace, workspace.case_id, destination, component, workspace.project, 'targetMin', '19')
const manualInputs = mixAdjustmentRequest(component.name, savedMixAdjustment(manual, destination, component))
assert.equal(prepareMixCalculation(manual, destination, component, manualInputs).source, null, 'edited target does not inherit source')
console.log('Calculation questions cannot follow changed project, setup, input or reopened file context')
