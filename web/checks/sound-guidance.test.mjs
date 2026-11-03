import assert from 'node:assert/strict'
import { isSoundProject } from '../src/soundGuidance.ts'

const makeProject = (product = '', use = '', priorities = '') => ({
  product: product ? { value: product, source: 'user_review', quote: product } : null,
  use: use ? { value: use, source: 'user_review', quote: use } : null,
  priorities: priorities ? { value: priorities, source: 'user_review', quote: priorities } : null,
})

for (const text of [
  'sound sheet',
  'SOUNDPROOFING panel',
  'acoustic mat',
  'acoustics panel',
  'echoing room',
  'noise control',
  'reverberation control',
  'quieter room',
  'noisy machinery',
]) {
  assert.equal(isSoundProject(makeProject(text)), true, text)
  assert.equal(isSoundProject(makeProject('', text)), true, text)
  assert.equal(isSoundProject(makeProject('', '', text)), true, text)
  assert.equal(isSoundProject(makeProject('planter'), text), true, text)
}
for (const text of [
  'floor mat',
  'counterweight',
  'planter',
  'soundness of the structure',
  'a resounding success',
  'quiet beige colour',
  'a profound change',
]) {
  assert.equal(isSoundProject(makeProject(text)), false, text)
}
assert.equal(isSoundProject(null), false)
assert.equal(isSoundProject(undefined, 'Can it reduce echo?'), true)
assert.equal(isSoundProject(makeProject('floor mat'), 'Will it reduce footstep noise?'), true)
assert.equal(isSoundProject(makeProject('floor mat'), 'How much binder do I need?'), false)
console.log(
  'Sound guidance activates on explicit acoustic context and remains hidden for unrelated product questions.',
)
