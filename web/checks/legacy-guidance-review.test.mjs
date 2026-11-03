import assert from 'node:assert/strict'
import { freshLegacyAdvice, legacyGuidanceTexts, reviewLegacyGuidance } from '../src/legacyGuidanceReview.ts'

const snapshot = {
  case_data: { brief: { input: 'User input stays local', product: 'mat' } },
  plan: { material_routes: [{ steps: ['Walk across the wet mat to check grip.'] }], answer: 'Original answer' },
  selected_route: { check: 'Stand on it' },
  trial: { steps: [{ action: 'Take a few steps on it' }] },
  followup: { next_steps: ['Observe the surface'] },
  history: [{ role: 'user', content: 'User message stays local' }, { role: 'assistant', content: 'Saved assistant response' }],
}
const original = structuredClone(snapshot)
const texts = legacyGuidanceTexts(snapshot)
assert.ok(texts.some((text) => text.includes('Walk across the wet mat to check grip.')))
assert.ok(texts.some((text) => text.includes('Stand on it')))
assert.ok(texts.some((text) => text.includes('Take a few steps on it')))
assert.ok(texts.some((text) => text.includes('Saved assistant response')))
assert.ok(texts.every((text) => !text.includes('User input stays local') && !text.includes('User message stays local')))
assert.deepEqual(snapshot, original, 'review leaves the saved workspace unchanged')
const fresh = freshLegacyAdvice(snapshot.history)
assert.deepEqual(fresh, {
  plan: null, followup: null, selected_route: null, trial: null,
  history: [{ role: 'user', content: 'User message stays local' }],
})
assert.deepEqual(snapshot, original, 'starting fresh does not change the saved file data')
assert.equal(await reviewLegacyGuidance(texts, async () => ({ needs_review: true })), 'flagged')
assert.equal(await reviewLegacyGuidance(texts, async () => ({ needs_review: false })), 'ready')
assert.equal(await reviewLegacyGuidance(texts, async () => { throw Error('offline') }), 'failed')
assert.equal(await reviewLegacyGuidance(texts, async () => ({})), 'failed')
assert.equal(await reviewLegacyGuidance([], async () => { throw Error('must not call') }), 'ready')
const many = { ...snapshot, plan: { text: 'a'.repeat(60000), more: 'b'.repeat(60000) } }
assert.ok(legacyGuidanceTexts(many).every((text) => text.length <= 100000))
console.log('Legacy saved guidance is extracted without user text; safe, flagged and failed reviews are gated')
