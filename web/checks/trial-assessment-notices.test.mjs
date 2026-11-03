import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { trialAssessmentError, trialAssessmentQuestion } from '../src/trialAssessmentNotices.ts'

const setup = { id: 'a.with.dots', revision: 2, name: 'Setup A', materials: [], process: '', geometry: '', notes: '' }
const second = { ...setup, id: 'another', name: 'Setup A' }
const check = { id: 'wet.grip', name: 'Wet grip', unit: 'coefficient', method: 'G', minimum: '0.6', maximum: null, required: true }
const result = { configurations: [{ id: setup.id, revision: 2, checks: [{ check_id: check.id, state: 'missing_records' }] }] }
const question = { field: `configurations.${setup.id}.checks.${check.id}`, question: 'Enter a synthetic record for the current configuration and this check, with matching conditions confirmed.' }
const name = (item) => item.name
const notice = trialAssessmentQuestion(question, result, [setup, second], [check], 'synthetic', name)
assert.equal(notice.text, 'Setup A · version 2 — Wet grip: Add a simulated reading and confirm its test conditions.')
assert.equal(notice.reading.setup, setup)
assert.equal(notice.reading.check, check)
assert.match(trialAssessmentQuestion(question, result, [setup], [check], 'user_reported', name).text, /Add an entered reading/)
const review = { configurations: [{ ...result.configurations[0], checks: [{ check_id: check.id, state: 'needs_review' }] }] }
assert.deepEqual(trialAssessmentQuestion(question, review, [setup], [check], 'synthetic', name), { text: 'Setup A · version 2 — Wet grip: Review the saved entry and confirm its test conditions.' })
assert.equal(trialAssessmentQuestion({ field: `checks.${check.id}.target`, question: 'ignored' }, result, [setup], [check], 'synthetic', name).text, 'Wet grip: Set a minimum or maximum target.')
assert.equal(trialAssessmentQuestion({ field: 'checks.required', question: 'ignored' }, result, [setup], [check], 'synthetic', name).text, 'Choose at least one required check.')
assert.equal(trialAssessmentQuestion(question, result, [setup], [check], 'synthetic', () => 'Trial setup 1').text, 'Trial setup 1 · version 2 — Wet grip: Add a simulated reading and confirm its test conditions.')

// Neither dot-containing identifiers nor an ambiguous full field may select a wrong setup/check.
const one = { ...setup, id: 'a', name: 'First' }
const two = { ...setup, id: 'a.checks.b', name: 'Second' }
const left = { ...check, id: 'b.checks.c' }
const right = { ...check, id: 'c' }
const collision = { field: 'configurations.a.checks.b.checks.c', question: 'Review the missing reading.' }
assert.deepEqual(trialAssessmentQuestion(collision, result, [one, two], [left, right], 'synthetic', name), { text: 'Review the missing reading.' })
const wrongRevision = { configurations: [{ ...result.configurations[0], revision: 1 }] }
assert.equal(trialAssessmentQuestion(question, wrongRevision, [setup], [check], 'synthetic', name).reading, undefined)
assert.equal(trialAssessmentQuestion({ field: 'unknown', question: 'configurations.secret.checks.hidden' }, result, [setup], [check], 'synthetic', name).text, 'Review the entries above and try again.')
assert.equal(trialAssessmentQuestion({ field: 'unknown' }, result, [setup], [check], 'synthetic', name).text, 'Review the entries above and try again.')
assert.equal(trialAssessmentError({ field: 'records.1', message: 'Enter a reading.' }), 'Enter a reading.')
assert.equal(trialAssessmentError({ field: 'records.1' }), 'Review the entries above and try again.')

const root = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root, configFile: false, server: { middlewareMode: true }, appType: 'custom' })
try {
  const { TrialAssessmentNotices } = await server.ssrLoadModule('/src/components/TrialAssessmentNotices.tsx')
  const markup = renderToStaticMarkup(React.createElement(TrialAssessmentNotices, {
    assessment: { ...result, questions: [question, { field: 'unknown' }], errors: [{ field: 'records.1' }] },
    setups: [setup, second], checks: [check], kind: 'synthetic', setupName: name, onAddReading() {},
  }))
  assert.match(markup, /Setup A · version 2 — Wet grip: Add a simulated reading/)
  assert.match(markup, />Add reading<\/button>/)
  assert.match(markup, /Review the entries above and try again/)
  assert.doesNotMatch(markup, /configurations\.|wet\.grip|a\.with\.dots|\{"field"/)
  console.log('Assessment questions render named next actions without internal fields and keep exact setup/check binding')
} finally {
  await server.close()
}
