import assert from 'node:assert/strict'
import { recordedRecipeFraction } from '../src/referenceComposition.ts'
import { confirmRecordedRecipeReview, recordedRecipeDiscussion, recordedRecipeNeedsReview, savedMixAdjustmentRecord, updateSavedMixAdjustment, useRecordedRecipeTarget } from '../src/mixAdjustment.ts'
import { newProjectWorkspace, newCostDraft, parseProjectWorkspace, serializeProjectWorkspace } from '../src/projectWorkspace.ts'
import { renamePlanLabel } from '../src/savedGuidanceReview.ts'

const recipe = (id, revision, materials) => ({ id, revision, name: id, materials, process: 'pressed', geometry: 'sheet', notes: '' })
const item = (id, amount, unit) => ({ id, name: id, amount, unit })
const source = recipe('source', 1, [item('paper', '250', 'g'), item('rubber', '0.75', 'kg')])
const destination = recipe('destination', 1, [item('tracked-paper', '5', 'g'), item('feed', '95', 'g')])
assert.deepEqual(recordedRecipeFraction(source, 'paper'), { ok: true, value: '25' }, 'mixed mass units use the same whole-recipe basis')
assert.deepEqual(recordedRecipeFraction(recipe('r', 1, [item('a', '1', 'lb'), item('b', '16', 'oz')]), 'a'), { ok: true, value: '50' })
assert.deepEqual(recordedRecipeFraction(recipe('r', 1, [item('a', '10', 'mass_percent'), item('b', '90', 'mass_percent')]), 'a'), { ok: true, value: '10' })
for (const bad of [
  [item('a', '10', 'mass_percent'), item('b', '20', 'mass_percent')],
  [item('a', '10', 'mass_percent'), item('b', '1', 'kg')],
  [item('a', '10', 'volume_percent'), item('b', '90', 'volume_percent')],
  [item('a', '', 'kg'), item('b', '1', 'kg')],
  [item('a', '-1', 'kg'), item('b', '2', 'kg')],
  [item('a', '0', 'kg'), item('b', '0', 'kg')],
]) assert.equal(recordedRecipeFraction(recipe('bad', 1, bad), 'a').ok, false, 'unknown or mixed-basis points cannot become targets')

const third = recipe('third', 1, [item('paper', '1', 'kg'), item('rubber', '2', 'kg')])
assert.deepEqual(recordedRecipeFraction(third, 'paper'), { ok: true, range: { min: '33.3333', max: '33.3334', numerator: '1', denominator: '3' } })
assert.deepEqual(recordedRecipeFraction(recipe('zero', 1, [item('a', '0', 'kg'), item('b', '1', 'kg')]), 'a'), { ok: true, value: '0' })
assert.deepEqual(recordedRecipeFraction(recipe('full', 1, [item('a', '1', 'kg'), item('b', '0', 'kg')]), 'a'), { ok: true, value: '100' })
const tiny = recordedRecipeFraction(recipe('tiny', 1, [item('a', '0.000000000000001', 'kg'), item('b', '3', 'kg')]), 'a')
assert.equal(tiny.ok, true)
assert.ok('range' in tiny && Number(tiny.range.min) < (100e-15 / (3 + 1e-15)) && Number(tiny.range.max) > (100e-15 / (3 + 1e-15)), 'small positive ranges enclose the source point')

const w = newProjectWorkspace()
w.configurations = [source, destination]
const dest = destination.materials[0], src = source.materials[0]
assert.equal(recordedRecipeDiscussion(w, destination, dest, w.project, (s) => s.name), '', 'manual target has no invented source')
let next = useRecordedRecipeTarget(w, w.case_id, destination, dest, w.project, source, src, 1)
assert.notEqual(next, w)
let draft = savedMixAdjustmentRecord(next, destination, dest)
assert.equal(draft.values.targetMin, '25'); assert.equal(draft.values.targetMax, '25')
assert.equal(draft.reference.setup_id, 'source'); assert.equal(draft.reference.setup_revision, 1)
assert.equal(draft.reference.component_id, 'paper'); assert.equal(draft.reference.basis, 'whole_recipe')
assert.match(recordedRecipeDiscussion(next, destination, dest, w.project, (s) => s.name), /source, version 1.*exact source fraction and chosen target are 25%/i)
const reopened = parseProjectWorkspace(serializeProjectWorkspace(next))
assert.deepEqual(savedMixAdjustmentRecord(reopened, destination, dest).reference, draft.reference, 'source provenance survives Save/Open')
const withinStream = updateSavedMixAdjustment(next, w.case_id, destination, dest, w.project, 'trackedComponent', 'loose paper')
assert.equal(savedMixAdjustmentRecord(withinStream, destination, dest).reference, undefined, 'changing the tracked component clears the recipe link')
assert.equal(useRecordedRecipeTarget(withinStream, w.case_id, destination, dest, w.project, source, src, 1), withinStream, 'a within-stream component cannot silently inherit a recipe point')
const forgedWithinStream = JSON.parse(serializeProjectWorkspace(next))
forgedWithinStream.mix_adjustment_drafts[0].values.trackedComponent = 'loose paper'
assert.throws(() => parseProjectWorkspace(JSON.stringify(forgedWithinStream)), /within a stream cannot use a recorded recipe/i, 'imports cannot attach a recipe to a within-stream component')

const renameBase = { ...next,
  trial_ideas: { 'source@1': { title: 'source', change: 'change', why: 'reason', steps: ['step'], tradeoffs: ['tradeoff'], check: 'check', provider: 'fixture', model: 'fixture' } },
  checks: [{ id:'check', name:'Grip', unit:'N', method:'measured', minimum:'1', maximum:'3', required:true }],
  records: [{ id:'record', case_id:w.case_id, configuration_id:'source', configuration_revision:1, check_id:'check', unit:'N', method:'measured', data_kind:'user_reported', conditions_confirmed:true, readings:[{ value:'2', specimen_id:'specimen' }] }],
  costs: { 'source@1': newCostDraft() },
}
const renamed = renamePlanLabel(renameBase, source, 'My board')
assert.ok(renamed)
assert.equal(renamed.configurations[0].name, 'My board')
assert.equal(renamed.configurations[0].revision, 1, 'name-only edit retains the exact plan revision')
assert.deepEqual(renamed.records, renameBase.records, 'all readings stay linked to that revision')
assert.deepEqual(renamed.costs, renameBase.costs, 'cost entries are unchanged')
assert.deepEqual({ ...renamed.configurations[0], name: source.name }, source, 'the label is the only plan field changed')
assert.equal(savedMixAdjustmentRecord(renamed, destination, dest).reference.setup_snapshot, JSON.stringify(renamed.configurations[0]), 'references follow the label without changing the recipe')
assert.doesNotThrow(() => parseProjectWorkspace(serializeProjectWorkspace(renamed)), 'renamed plan and references survive save and open')
assert.equal(renamePlanLabel(renameBase, source, 'source'), null, 'held AI name cannot be silently reintroduced')
assert.equal(renamePlanLabel(renameBase, source, ' '.repeat(3)), null)
assert.equal(renamePlanLabel(renameBase, { ...source, process:'changed' }, 'My board'), null, 'a stale captured plan cannot overwrite other changes')

const withOtherInputs = updateSavedMixAdjustment(next, w.case_id, destination, dest, w.project, 'inputMass', '1')
assert.deepEqual(savedMixAdjustmentRecord(withOtherInputs, destination, dest).reference, draft.reference, 'unrelated edits retain source provenance')
const manualEdit = updateSavedMixAdjustment(withOtherInputs, w.case_id, destination, dest, w.project, 'targetMin', '24')
assert.equal(savedMixAdjustmentRecord(manualEdit, destination, dest).reference, undefined, 'editing the point makes the target user-entered')
assert.equal(useRecordedRecipeTarget(next, w.case_id, destination, dest, w.project, source, src, 1), next, 'existing target is never overwritten')
const partialTarget = updateSavedMixAdjustment(w, w.case_id, destination, dest, w.project, 'targetMax', '30')
assert.equal(useRecordedRecipeTarget(partialTarget, w.case_id, destination, dest, w.project, source, src, 1), partialTarget, 'one existing limit is enough to prevent overwrite')

const changedSource = { ...structuredClone(source), materials: [item('paper', '260', 'g'), item('rubber', '0.75', 'kg')] }
const changedInput = { ...w, configurations: [changedSource, destination] }
assert.equal(useRecordedRecipeTarget(changedInput, w.case_id, destination, dest, w.project, source, src, 1), changedInput, 'source edited concurrently is not silently used')
const newerSource = { ...structuredClone(source), revision: 2 }
const newerWorkspace = { ...next, configurations: [...next.configurations, newerSource] }
assert.equal(recordedRecipeNeedsReview(newerWorkspace, draft), true, 'new source version requires review')
assert.equal(recordedRecipeDiscussion(newerWorkspace, destination, dest, w.project, (s) => s.name), '', 'stale source is not passed into discussion')
assert.equal(useRecordedRecipeTarget({ ...w, configurations: [...w.configurations, newerSource] }, w.case_id, destination, dest, w.project, source, src, 1).mix_adjustment_drafts.length, 0, 'a newer source cannot be captured without review')
assert.equal(confirmRecordedRecipeReview(newerWorkspace, w.case_id, destination, dest, w.project, 1), newerWorkspace, 'a review cannot silently accept a newer version than the one shown')
const reviewed = confirmRecordedRecipeReview(newerWorkspace, w.case_id, destination, dest, w.project, 2)
assert.equal(recordedRecipeNeedsReview(reviewed, savedMixAdjustmentRecord(reviewed, destination, dest)), false)
assert.equal(savedMixAdjustmentRecord(reviewed, destination, dest).reference.setup_revision, 1, 'review does not switch to the newer recipe')
const newerDestination = { ...structuredClone(destination), revision: 2 }
const staleDest = { ...w, configurations: [...w.configurations, newerDestination] }
assert.equal(useRecordedRecipeTarget(staleDest, w.case_id, destination, dest, w.project, source, src, 1), staleDest)
const corrupted = JSON.parse(serializeProjectWorkspace(next))
corrupted.configurations[0].materials[0].amount = '500'
assert.throws(() => parseProjectWorkspace(JSON.stringify(corrupted)), /recorded recipe reference/i, 'import cannot substitute another source recipe')

const roundedWorkspace = { ...newProjectWorkspace(), configurations: [third, destination] }
const rounded = useRecordedRecipeTarget(roundedWorkspace, roundedWorkspace.case_id, destination, dest, roundedWorkspace.project, third, third.materials[0], 1)
const roundedDraft = savedMixAdjustmentRecord(rounded, destination, dest)
assert.equal(roundedDraft.values.targetMin, '33.3333'); assert.equal(roundedDraft.values.targetMax, '33.3334')
assert.deepEqual(roundedDraft.reference.range, { min: '33.3333', max: '33.3334', numerator: '1', denominator: '3' })
const roundedReopened = parseProjectWorkspace(serializeProjectWorkspace(rounded))
assert.deepEqual(savedMixAdjustmentRecord(roundedReopened, destination, dest).reference, roundedDraft.reference, 'exact source ratio and rounded bounds survive Save/Open')
assert.match(recordedRecipeDiscussion(rounded, destination, dest, roundedWorkspace.project, (s) => s.name), /1\/3.*33\.3333–33\.3334%.*enclosing rounded range/i)
assert.equal(useRecordedRecipeTarget(rounded, rounded.case_id, destination, dest, rounded.project, third, third.materials[0], 1), rounded, 'rounded targets are not overwritten')
const editedRounded = updateSavedMixAdjustment(rounded, rounded.case_id, destination, dest, rounded.project, 'targetMin', '33.3')
assert.equal(savedMixAdjustmentRecord(editedRounded, destination, dest).reference, undefined, 'editing the range changes it to a manual target')
const corruptRounded = JSON.parse(serializeProjectWorkspace(rounded))
corruptRounded.mix_adjustment_drafts[0].reference.range.numerator = '2'
assert.throws(() => parseProjectWorkspace(JSON.stringify(corruptRounded)), /recorded recipe reference/i)
const staleRounded = { ...rounded, configurations: [...rounded.configurations, { ...structuredClone(third), revision: 2 }] }
assert.equal(recordedRecipeNeedsReview(staleRounded, roundedDraft), true)
assert.equal(recordedRecipeDiscussion(staleRounded, destination, dest, rounded.project, (s) => s.name), '', 'rounded reference becomes unavailable when unreviewed')
const reviewedRounded = confirmRecordedRecipeReview(staleRounded, rounded.case_id, destination, dest, rounded.project, 2)
assert.equal(recordedRecipeNeedsReview(reviewedRounded, savedMixAdjustmentRecord(reviewedRounded, destination, dest)), false)
console.log('Recorded recipes hand off exact whole-recipe points with explicit source, review and no draft overwrite')
