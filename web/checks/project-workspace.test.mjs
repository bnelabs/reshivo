import assert from 'node:assert/strict'
import {
  newProjectWorkspace, newCostDraft, currentConfigurations, configurationKey,
  parseProjectWorkspace, serializeProjectWorkspace, buildTrialComparisonRequest,
  PROJECT_WORKSPACE_MAX_BYTES,
} from '../src/projectWorkspace.ts'

const field = (value) => ({ value, source: 'user_review', quote: value })
const fixture = () => {
  const w = newProjectWorkspace()
  w.case_id = 'case-exact'
  w.project = { product: field('Sound sheet'), input: field('Named stocks A, B and C'),
    variation: field('A stays at 20%; B and C change'), use: field('Reduce room echo'),
    priorities: field('Recovery and sound absorption; unknown limits stay unknown'), process: null, constraints: null }
  const setup = (id, revision, third = false) => ({ id, revision, name: `Setup ${id}`,
    materials: [{ id: 'A', name: 'Stock A', amount: '20.000000000000000005', unit: 'mass_percent' },
      { id: 'B', name: 'Stock B', amount: third ? '30' : '80', unit: 'mass_percent' },
      ...(third ? [{ id: 'C', name: 'Stock C', amount: 'unknown', unit: '' }] : [])],
    process: revision === 1 ? 'Process one' : 'Process two; separate from old readings',
    geometry: 'Same named installation, conditions recorded by user', notes: 'Synthetic fixture, no physical validation' })
  w.configurations = [setup('AB', 1), setup('ABC', 1, true), setup('AB', 2)]
  w.checks = [
    { id: 'recovery', name: 'Recovery', unit: '%', method: 'REC-1', minimum: '80', maximum: null, required: true },
    { id: 'sound', name: 'Sound check', unit: 'dB', method: 'INS-1', minimum: null, maximum: '26.000000000000000005', required: true },
  ]
  const record = (id, configuration_id, configuration_revision, check_id, unit, method) => ({
    id, case_id: w.case_id, configuration_id, configuration_revision, check_id, unit, method,
    data_kind: 'synthetic', conditions_confirmed: true,
    readings: [{ value: '26.000000000000000005', reading_id: 'reading-A', specimen_id: 'specimen-1', run_id: null, batch_id: '' },
      { value: '26.000000000000000004', reading_id: 'reading-B', specimen_id: 'specimen-1', repeat_of: 'reading-A' }],
  })
  w.records = [record('old-AB', 'AB', 1, 'sound', 'dB', 'INS-1'), record('current-ABC', 'ABC', 1, 'recovery', '%', 'REC-1')]
  w.costs['ABC@1'] = { ...newCostDraft(), currency: 'EUR', prices: { A: '1.000000000000000005' },
    energy_kwh: 'not entered yet', mode: 'planned', accepted_fraction: '',
    process_statuses: { energy: 'unknown', labor: 'excluded' } }
  return w
}

const original = fixture()
const before = JSON.stringify(original)
const planned = fixture()
planned.trial_ideas = {'AB@2': {title:'Keep a removable outer layer',change:'Try a separate removable outer layer.',why:'It can be changed independently.',steps:['Plan the joint.'],tradeoffs:['Thickness may increase.'],check:'Compare the assembled size.',provider:'meta',model:'muse-spark-1.3'}}
const plannedRestored = parseProjectWorkspace(serializeProjectWorkspace(planned))
assert.deepEqual(plannedRestored.trial_ideas, planned.trial_ideas, 'selected proposal survives with exact version and all actionable steps')
assert.equal(Object.hasOwn(buildTrialComparisonRequest(plannedRestored,'synthetic'),'trial_ideas'),false,'unverified ideas cannot become measurement inputs')
assert.throws(()=>serializeProjectWorkspace({...planned,trial_ideas:{'AB@99':planned.trial_ideas['AB@2']}}),/version/)
assert.throws(()=>serializeProjectWorkspace({...planned,trial_ideas:{'AB@2':{...planned.trial_ideas['AB@2'],note_id:'missing'}}}),/saved planning note/)
assert.throws(()=>serializeProjectWorkspace({...planned,trial_ideas:{'AB@2':{...planned.trial_ideas['AB@2'],performance_verified:true}}}),/unsupported/)
const text = serializeProjectWorkspace(original)
const restored = parseProjectWorkspace(text)
const discussion = 'Question: What sound?\nAnswer: Voices through the wall.'
assert.equal(parseProjectWorkspace(serializeProjectWorkspace({ ...original, intake_notes: discussion })).intake_notes, discussion, 'setup answers survive a project backup')
assert.throws(() => serializeProjectWorkspace({ ...original, intake_notes: 'a'.repeat(20001) }), /20000/, 'setup answers remain bounded')
const legacyPercentage = fixture()
legacyPercentage.configurations[0].materials[0].amount = '150'
assert.equal(parseProjectWorkspace(JSON.stringify(legacyPercentage)).configurations[0].materials[0].amount, '150', 'older project files remain openable for correction')
assert.equal(JSON.parse(serializeProjectWorkspace(legacyPercentage)).configurations[0].materials[0].amount, '150', 'saving does not erase historical values')
assert.equal(restored.schema, 'reshivo-project-v2')
assert.equal(JSON.parse(text).schema, 'reshivo-project-v2', 'new project backups use the current name')
const legacyProject = { ...original, schema: 'rematter-project-v2' }
const legacyOpened = parseProjectWorkspace(JSON.stringify(legacyProject))
assert.equal(legacyOpened.schema, 'reshivo-project-v2', 'legacy project backups open with the current identifier')
assert.deepEqual(legacyOpened.project, original.project, 'legacy project details are preserved')
assert.equal(JSON.parse(serializeProjectWorkspace(legacyOpened)).schema, 'reshivo-project-v2', 'resaving a legacy project uses the current identifier')
assert.equal(restored.case_id, original.case_id)
assert.deepEqual(restored.project, original.project)
assert.deepEqual(restored.configurations, original.configurations, 'all versions and full multi-input setups survive')
assert.deepEqual(restored.checks, original.checks, 'all independent properties and exact limits survive')
assert.deepEqual(restored.costs, original.costs, 'unknown and unfinished cost drafts remain editable')
assert.equal(restored.records[0].readings[0].value, '26.000000000000000005', 'exact precision is never converted through Number')
assert.equal(restored.records[0].readings[0].run_id, null, 'unknown run remains null')
assert.equal(restored.records[0].readings[0].batch_id, '', 'blank grouping remains blank')
assert.equal(Object.hasOwn(restored.records[0].readings[1], 'batch_id'), false, 'missing grouping is not invented')
assert.equal(restored.records[0].readings[1].repeat_of, 'reading-A')
for (const record of restored.records) assert.equal(record.conditions_confirmed, false, 'every imported record needs fresh review')
assert.equal(JSON.stringify(original), before, 'save/load cannot mutate the active workspace')
assert.equal(JSON.parse(text).records[0].conditions_confirmed, true, 'saving preserves entered state; opening separately requires reconfirmation')

const current = currentConfigurations(original)
assert.deepEqual(current.map((c) => [c.id, c.revision]), [['AB', 2], ['ABC', 1]])
current[0].materials[0].amount = 'changed'
assert.equal(original.configurations[2].materials[0].amount, '20.000000000000000005', 'current-view helpers cannot overwrite an immutable stored version')
assert.equal(configurationKey(original.configurations[0]), 'AB@1')
assert.equal(configurationKey('AB', 2), 'AB@2')
const request = buildTrialComparisonRequest(restored, 'synthetic')
assert.deepEqual(Object.keys(request).sort(), ['assessment_kind', 'case_id', 'checks', 'configurations', 'records'])
assert.equal(request.configurations.length, 3, 'the backend sees old versions and decides which records are stale')
assert.equal(request.records[0].conditions_confirmed, false, 'request construction never attests matching conditions')
assert.equal(request.assessment_kind, 'synthetic')
assert.equal(Object.hasOwn(request, 'costs'), false)
assert.throws(() => buildTrialComparisonRequest(restored, 'mixed'), /synthetic|user-reported/)
request.configurations[0].process = 'changed in request'
assert.equal(restored.configurations[0].process, 'Process one')

for (const [description, mutate, reason] of [
  ['unsupported version', (w) => { w.schema = 'rematter-project-v3' }, /supported/],
  ['forged result', (w) => { w.assessment = { performance_verified: true } }, /unsupported/],
  ['credentials', (w) => { w.provider = { api_key: 'not-a-key' } }, /unsupported/],
  ['nested hidden result', (w) => { w.configurations[0].passed = true }, /unsupported/],
  ['duplicate version', (w) => { w.configurations.push(structuredClone(w.configurations[0])) }, /versions/],
  ['duplicate material', (w) => { w.configurations[0].materials.push(structuredClone(w.configurations[0].materials[0])) }, /unique/],
  ['empty material name', (w) => { w.configurations[0].materials[0].name = '' }, /unnamed material/],
  ['negative material amount', (w) => { w.configurations[0].materials[0].amount = '-1' }, /invalid material amount/],
  ['out-of-range amount', (w) => { w.configurations[0].materials[0].amount = '1e1001' }, /invalid material amount/],
  ['invalid revision', (w) => { w.configurations[0].revision = true }, /revision/],
  ['foreign case', (w) => { w.records[0].case_id = 'other-case' }, /case/],
  ['missing version', (w) => { w.records[0].configuration_revision = 99 }, /version/],
  ['changed method', (w) => { w.records[0].method = 'other method' }, /method/],
  ['relabelled unit', (w) => { w.records[0].unit = '%' }, /unit/],
  ['numeric reading coercion', (w) => { w.records[0].readings[0].value = 26 }, /text/],
  ['confirmation coercion', (w) => { w.records[0].conditions_confirmed = 'true' }, /confirmation/],
  ['unknown source kind', (w) => { w.records[0].data_kind = 'measured' }, /source kind/],
  ['duplicate record ID', (w) => { w.records[1].id = w.records[0].id }, /unique/],
  ['duplicate reading ID', (w) => { w.records[0].readings[1].reading_id = 'reading-A' }, /unique/],
  ['foreign repeat', (w) => { w.records[0].readings[1].repeat_of = 'elsewhere' }, /own record/],
  ['repeat cycle', (w) => { w.records[0].readings[0].repeat_of = 'reading-B' }, /cycle/],
  ['contradictory specimen', (w) => { w.records[0].readings[1].specimen_id = 'specimen-2' }, /specimen/],
  ['unbound cost', (w) => { w.costs['AB@99'] = newCostDraft() }, /version/],
  ['foreign material price', (w) => { w.costs['ABC@1'].prices.elsewhere = '1' }, /material/],
  ['invalid status', (w) => { w.costs['ABC@1'].process_statuses.energy = 'free' }, /status/],
  ['unquoted project value', (w) => { w.project.product.quote = 'a different product' }, /literal/],
  ['oversized context', (w) => { w.configurations[0].process = 'x'.repeat(2001) }, /2000/],
]) {
  const bad = fixture()
  mutate(bad)
  assert.throws(() => parseProjectWorkspace(JSON.stringify(bad)), reason, description)
  assert.equal(JSON.stringify(original), before, `${description}: rejected import leaves active state unchanged`)
}
assert.throws(() => parseProjectWorkspace('{broken'), /valid project JSON/)
assert.throws(() => parseProjectWorkspace(' '.repeat(PROJECT_WORKSPACE_MAX_BYTES + 1)), /4 MB/)
assert.throws(() => parseProjectWorkspace(JSON.stringify({ ...fixture(), configurations: Array.from({ length: 101 }, () => fixture().configurations[0]) })), /100/)
const cost = newCostDraft()
assert.equal(cost.currency, '')
assert.equal(cost.accepted_fraction, '', 'no default yield assumption')
assert.deepEqual(cost.process_statuses, { energy: 'unknown', labor: 'unknown', other: 'unknown' })
assert.deepEqual(cost.prices, {})
const excluded = fixture()
excluded.record_exclusions = { 'old-AB': 'Retained for traceability; a transcribed value needs review.' }
const reopenedExclusion = parseProjectWorkspace(serializeProjectWorkspace(excluded))
assert.deepEqual(reopenedExclusion.record_exclusions, excluded.record_exclusions)
assert.equal(reopenedExclusion.records.length, 2, 'exclusion never deletes an observation')
assert.deepEqual(buildTrialComparisonRequest(reopenedExclusion, 'synthetic').records.map((r) => r.id), ['current-ABC'])
delete reopenedExclusion.record_exclusions['old-AB']
assert.equal(buildTrialComparisonRequest(reopenedExclusion, 'synthetic').records.length, 2, 'reinclusion is recoverable')
const oldVersionTwo = fixture()
delete oldVersionTwo.record_exclusions
assert.equal(Object.hasOwn(parseProjectWorkspace(serializeProjectWorkspace(oldVersionTwo)), 'record_exclusions'), false, 'original version-two files remain valid without the new field')
delete oldVersionTwo.advice_notes
assert.equal(Object.hasOwn(parseProjectWorkspace(serializeProjectWorkspace(oldVersionTwo)), 'advice_notes'), false, 'older project files need no planning-note field')
assert.deepEqual(newProjectWorkspace().advice_notes, [], 'new projects start with an empty historical-note collection')
for (const exclusions of [{ missing: 'No retained record' }, { 'old-AB': '' }, { 'old-AB': true }, { 'old-AB': 'x'.repeat(1001) }, []]) {
  assert.throws(() => parseProjectWorkspace(JSON.stringify({ ...fixture(), record_exclusions: exclusions })), /exclu|reason|retained/i)
}
const planningNote = (workspace) => ({
  id: 'planning-note-1', created_at: '2026-11-03T10:30:00.000Z', provider: 'fixture-provider', model: 'fixture-model',
  project_snapshot: structuredClone(workspace.project), configuration_versions: [{ id: 'AB', revision: 1 }, { id: 'ABC', revision: 1 }],
  assessment_kind: 'synthetic', kind: 'model_proposal',
  text: 'Proposed next comparison; facility availability remains unconfirmed.\nKeep preparation and geometry fixed.\nRecord density and check handling integrity separately.\nTradeoff: another binder may change compatibility.\nQuestion: what processing equipment is actually available?',
})
const withNotes = fixture()
withNotes.advice_notes = [planningNote(withNotes)]
withNotes.project.product = field('Edited current product')
const noteBefore = JSON.stringify(withNotes.advice_notes)
const reopenedNotes = parseProjectWorkspace(serializeProjectWorkspace(withNotes))
assert.deepEqual(reopenedNotes.advice_notes, withNotes.advice_notes, 'full historical text, provider/model, snapshot and old configuration references survive opening')
assert.equal(reopenedNotes.advice_notes[0].project_snapshot.product.value, 'Sound sheet', 'opening does not rebase a historical project snapshot onto edited current details')
assert.equal(reopenedNotes.project.product.value, 'Edited current product')
assert.equal(reopenedNotes.advice_notes[0].kind, 'model_proposal', 'import does not reinstate a live response or physical record')
assert.equal(Object.hasOwn(reopenedNotes, 'model_response'), false)
assert.equal(Object.hasOwn(reopenedNotes, 'assessment'), false)
assert.equal(JSON.stringify(withNotes.advice_notes), noteBefore, 'saving/opening never changes historical text or context')
const requestWithoutNotes = buildTrialComparisonRequest(reopenedNotes, 'synthetic')
assert.equal(Object.hasOwn(requestWithoutNotes, 'advice_notes'), false, 'historical planning text is never sent to deterministic assessments')
assert.deepEqual(requestWithoutNotes.records, reopenedNotes.records, 'planning notes never become property records')
reopenedNotes.advice_notes[0].text = 'Changed reopened copy'
assert.notEqual(reopenedNotes.advice_notes[0].text, withNotes.advice_notes[0].text, 'import returns an independent narrative copy')

const fullText = fixture()
fullText.advice_notes = [{ ...planningNote(fullText), text: 'P'.repeat(100000) }]
assert.equal(parseProjectWorkspace(serializeProjectWorkspace(fullText)).advice_notes[0].text.length, 100000, 'valid long proposals are preserved without truncating prerequisites')
const thirtyNotes = fixture()
thirtyNotes.advice_notes = Array.from({ length: 30 }, (_, index) => ({ ...planningNote(thirtyNotes), id: `note-${index}` }))
assert.equal(parseProjectWorkspace(serializeProjectWorkspace(thirtyNotes)).advice_notes.length, 30, 'the bound preserves every retained note rather than silently evicting one')

for (const [description, mutate, reason] of [
  ['wrong narrative kind', (note) => { note.kind = 'physical_measurement' }, /historical|proposal/],
  ['injected secret field', (note) => { note.api_key = 'fixture-not-a-real-key' }, /unsupported/],
  ['injected live response', (note) => { note.live = true }, /unsupported/],
  ['injected verification', (note) => { note.performance_verified = true }, /unsupported/],
  ['injected calculation', (note) => { note.calculation = { mass_kg: '12' } }, /unsupported/],
  ['missing retained version', (note) => { note.configuration_versions[0].revision = 99 }, /version/],
  ['unknown configuration', (note) => { note.configuration_versions[0].id = 'other-config' }, /version/],
  ['duplicate version reference', (note) => { note.configuration_versions.push(structuredClone(note.configuration_versions[0])) }, /unique/],
  ['boolean revision', (note) => { note.configuration_versions[0].revision = true }, /revision/],
  ['hidden reference credential', (note) => { note.configuration_versions[0].api_key = 'fixture-not-a-real-key' }, /unsupported/],
  ['changed literal snapshot', (note) => { note.project_snapshot.product.quote = 'a different product' }, /literal/],
  ['hidden snapshot secret', (note) => { note.project_snapshot.api_key = 'fixture-not-a-real-key' }, /unsupported/],
  ['unknown source kind', (note) => { note.assessment_kind = 'mixed' }, /assessment kind/],
  ['invalid timestamp', (note) => { note.created_at = 'not-a-timestamp' }, /timestamp/],
  ['overlong model identifier', (note) => { note.model = 'm'.repeat(201) }, /200/],
  ['overlong narrative', (note) => { note.text = 't'.repeat(100001) }, /100000/],
]) {
  const bad = fixture()
  bad.advice_notes = [planningNote(bad)]
  mutate(bad.advice_notes[0])
  assert.throws(() => parseProjectWorkspace(JSON.stringify(bad)), reason, description)
}
const duplicateNotes = fixture()
duplicateNotes.advice_notes = [planningNote(duplicateNotes), planningNote(duplicateNotes)]
assert.throws(() => serializeProjectWorkspace(duplicateNotes), /unique/)
const excessiveNotes = fixture()
excessiveNotes.advice_notes = Array.from({ length: 31 }, (_, index) => ({ ...planningNote(excessiveNotes), id: `note-${index}` }))
assert.throws(() => serializeProjectWorkspace(excessiveNotes), /30/)
assert.equal(excessiveNotes.advice_notes.length, 31, 'rejecting the storage limit cannot evict historical notes')
const excessiveNoteBytes = fixture()
excessiveNoteBytes.advice_notes = Array.from({ length: 30 }, (_, index) => ({ ...planningNote(excessiveNoteBytes), id: `note-${index}`, text: '界'.repeat(100000) }))
assert.throws(() => serializeProjectWorkspace(excessiveNoteBytes), /4 MB/, 'historical-note persistence still obeys the overall byte cap')
console.log('project workspace: versioned round-trip, historical planning notes, exact records, review-on-open and strict binding checks passed')
