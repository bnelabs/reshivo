import assert from 'node:assert/strict'
import { mixQuestionFingerprint, mixQuestionIsCurrent } from '../src/mixQuestion.ts'

const project = { case_id: 'case', project: { input: 'rubber' }, configurations: [{ id: 'setup', revision: 1 }], mix_adjustment_drafts: [{ inputMin: '26' }] }
const prepared = mixQuestionFingerprint(project, 1)
assert.equal(mixQuestionIsCurrent(prepared, mixQuestionFingerprint(structuredClone(project), 1)), true)
assert.equal(mixQuestionIsCurrent(null, mixQuestionFingerprint(project, 1)), true)
assert.equal(mixQuestionIsCurrent(prepared, mixQuestionFingerprint({ ...project, case_id: 'other' }, 1)), false)
assert.equal(mixQuestionIsCurrent(prepared, mixQuestionFingerprint({ ...project, project: { input: 'new stock' } }, 1)), false)
assert.equal(mixQuestionIsCurrent(prepared, mixQuestionFingerprint({ ...project, configurations: [{ id: 'setup', revision: 2 }] }, 1)), false)
assert.equal(mixQuestionIsCurrent(prepared, mixQuestionFingerprint({ ...project, mix_adjustment_drafts: [{ inputMin: '27' }] }, 1)), false)
assert.equal(mixQuestionIsCurrent(prepared, mixQuestionFingerprint(project, 2)), false)
console.log('Calculation questions cannot follow changed project, setup, input or reopened file context')
