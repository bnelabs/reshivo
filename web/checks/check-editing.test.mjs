import assert from 'node:assert/strict'
import {
  validateCheckDraft,
  checkHasReadings,
  checkHasPendingDraft,
  validateReadingDraft,
  validateMaterialAmount,
} from '../src/checkEditing.ts'
const check = {
  id: 'grip',
  name: 'Grip',
  unit: 'N',
  method: 'Method A',
  minimum: null,
  maximum: null,
  required: true,
}
const record = { check_id: 'grip' }
const valid = (patch = {}, original = undefined, records = []) =>
  validateCheckDraft({ ...check, ...patch }, original, records)
assert.equal(valid(), null)
assert.equal(
  valid({ minimum: '10', maximum: '5' }),
  'The minimum cannot be greater than the maximum.',
)
assert.equal(
  valid({ minimum: '0.100000000000000005', maximum: '0.1' }),
  'The minimum cannot be greater than the maximum.',
)
assert.equal(valid({ minimum: '1e-1000', maximum: '1e-1000' }), null)
assert.ok(valid({ minimum: '1e-1001' }))
assert.ok(valid({ minimum: '1.00e-999' }))
assert.equal(valid({ minimum: '0e1000' }), null)
assert.equal(valid({ minimum: '1e0000001', maximum: '10' }), null)
assert.ok(valid({ maximum: 'NaN' }))
assert.ok(valid({ minimum: '1,2' }))
assert.equal(valid({ minimum: '-1e999', maximum: '-2' }, check, [record]), null)
assert.equal(valid({ minimum: '1', maximum: '2', required: false }, check, [record]), null)
for (const patch of [{ name: 'Different' }, { unit: 'kg' }, { method: 'Method B' }])
  assert.ok(valid(patch, check, [record]))
assert.equal(valid({ method: 'Method B' }, check, []), null)
assert.ok(valid({ id: 'other' }, check, []))
assert.equal(checkHasReadings('grip', [record]), true)
assert.equal(checkHasReadings('other', [record]), false)
const draftKey = JSON.stringify(['setup@1', 'grip', 'synthetic', 'Grip', 'N', 'Method A'])
assert.equal(
  checkHasPendingDraft('grip', { [draftKey]: { readings: [{ value: '1' }], confirmed: false } }),
  true,
)
assert.equal(
  checkHasPendingDraft('grip', { [draftKey]: { readings: [{ value: '' }], confirmed: false } }),
  false,
)
assert.equal(
  checkHasPendingDraft('other', { [draftKey]: { readings: [{ value: '1' }], confirmed: false } }),
  false,
)
console.log('Check edits preserve linked readings and compare exact target limits')

assert.equal(validateReadingDraft([{ value: '1e-1000' }, { value: '-0.0001' }]), null)
assert.equal(validateReadingDraft([{ value: '١.٢' }]), null)
assert.equal(
  valid({ minimum: '١.٢', maximum: '1.1' }),
  'The minimum cannot be greater than the maximum.',
)
for (const bad of ['', ' ', '1,2', 'NaN', 'Infinity', '1e-1001', '1.00e-999'])
  assert.ok(validateReadingDraft([{ value: bad }]), bad)
assert.ok(
  validateReadingDraft([
    { value: '1', reading_id: 'R' },
    { value: '2', reading_id: 'R' },
  ]),
)
assert.ok(validateReadingDraft([{ value: '1', repeat_of: 'missing' }]))
assert.ok(
  validateReadingDraft([
    { value: '1', reading_id: 'R1', repeat_of: 'R2' },
    { value: '2', reading_id: 'R2', repeat_of: 'R1' },
  ]),
)
assert.ok(
  validateReadingDraft([
    { value: '1', reading_id: 'R1', specimen_id: 'S1' },
    { value: '2', reading_id: 'R2', repeat_of: 'R1', specimen_id: 'S2' },
  ]),
)
assert.ok(validateReadingDraft([{ value: '1', batch_id: '   ' }]))
assert.equal(
  validateReadingDraft([
    { value: '1', reading_id: 'R1', specimen_id: 'S1', batch_id: 'B1' },
    { value: '2', reading_id: 'R2', repeat_of: 'R1', specimen_id: 'S1', batch_id: 'B1' },
  ]),
  null,
)
assert.equal(
  validateReadingDraft([
    { value: '1', reading_id: 'R1' },
    { value: '2', repeat_of: 'R1' },
  ]),
  null,
)
console.log(
  'Reading drafts reject invalid numbers, identifiers and contradictory repeats before saving',
)

for (const value of ['', 'unknown', 'about 5 kg', ' -4 ', '0', '-0', '0.1', '1e1000', '١.٢'])
  assert.equal(validateMaterialAmount(value), null, value)
for (const value of ['-0.1', '-1e-1000', '1e1001', '1e-1001', '1.00e-999', 'x'.repeat(161)])
  assert.ok(validateMaterialAmount(value), value)
assert.ok(validateMaterialAmount(1))
for (const unit of ['mass_percent', 'volume_percent']) {
  for (const value of ['0', '100', '100.000', '1e2', '١٠٠', 'unknown', 'about 150'])
    assert.equal(validateMaterialAmount(value, unit), null, `${value} ${unit}`)
  for (const value of ['100.000000000000000000001', '101', ' 101 ', '1.01e2', '١٠١'])
    assert.equal(validateMaterialAmount(value, unit), 'A material percentage cannot be more than 100%.', `${value} ${unit}`)
}
assert.equal(validateMaterialAmount('150', 'kg'), null)
assert.equal(validateMaterialAmount('150'), null, 'older saved drafts remain loadable')
console.log(
  'Setup amounts preserve unknown text and reject negative or out-of-range numeric values',
)
