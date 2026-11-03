import assert from 'node:assert/strict'
import { emptyMixAdjustmentDraft, mixAdjustmentRequest } from '../src/mixAdjustment.ts'
import { mixInputProblems } from '../src/mixInputHelp.ts'

const empty = emptyMixAdjustmentDraft()
const screenshot = { ...empty, inputMass: '100', inputMin: '100%', inputMax: '100%' }
assert.deepEqual(mixInputProblems('mixed plastics of HDPE, ABS, PET and LDPE with minor PP', screenshot), [
  'Name the material you could add.',
  'Enter the tracked share in the material you could add.',
  'Enter the minimum composition to explore.',
  'Enter the maximum composition to explore.',
])
const valid = { ...screenshot, additionName: 'Named stock', additionPercent: '0%', targetMin: '20%', targetMax: '90%' }
assert.deepEqual(mixInputProblems('mixed stream', valid), [])
assert.ok(mixAdjustmentRequest('mixed stream', valid), 'a user-described whole stream remains supported')
for (const [field, value, phrase] of [
  ['inputMass', '0', 'portion mass'], ['inputMass', 'invalid:abc', 'portion mass'],
  ['inputMin', '101%', 'lowest portion percentage'], ['inputMax', '-1', 'highest portion percentage'],
  ['additionPercent', '12%%', 'tracked share'], ['targetMin', '101', 'minimum composition'],
  ['targetMax', '-5', 'maximum composition'],
]) {
  const draft = { ...valid, [field]: value }
  assert.equal(mixAdjustmentRequest('mixed stream', draft), null, `${field} rejected`)
  assert.ok(mixInputProblems('mixed stream', draft).some((line) => line.includes(phrase)), `${field} explained`)
}
assert.ok(mixInputProblems('mixed stream', { ...valid, inputMin: '80', inputMax: '20' }).some((line) => line.includes('lowest portion percentage must')))
assert.ok(mixInputProblems('mixed stream', { ...valid, targetMin: '90', targetMax: '20' }).some((line) => line.includes('minimum composition must')))
assert.ok(mixInputProblems('', valid).some((line) => line.includes('material or stream')))
assert.ok(mixInputProblems('mixed stream', { ...valid, inputMass: '1000001' }, 'us').some((line) => line.includes('2,204,622.62 lb')))
assert.ok(!mixInputProblems('mixed stream', { ...valid, inputMass: 'invalid:abc' }, 'us').some((line) => line.includes('kg')))
assert.ok(!mixInputProblems('mixed stream', { ...valid, inputMass: '0' }, 'us').some((line) => line.includes('kg')))
console.log('Mix input help identifies only missing or invalid entries and preserves valid whole-stream calculations')
