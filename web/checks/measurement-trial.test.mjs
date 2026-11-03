import assert from 'node:assert/strict'
import { prepareMeasuredComposition } from '../src/measurementTrial.ts'

const input = (patch = {}) => ({
  setting: {
    id: 'Binder ten', level: '10', reading_count: 3, in_target_count: 3,
    all_readings_in_target: true,
  },
  inputUnit: 'mass %',
  componentId: 2,
  components: [{ id: 1, name: 'Named metal dust' }, { id: 2, name: 'Named binder' }],
  confirmed: true,
  ...patch,
})
const reject = (patch, description, reason) => {
  const result = prepareMeasuredComposition(input(patch))
  assert.equal(result.ok, false, description)
  assert.equal(typeof result.reason, 'string', description)
  assert.ok(result.reason.trim(), description)
  if (reason) assert.match(result.reason, reason, description)
}
const changedSetting = (patch) => ({ ...input().setting, ...patch })

assert.deepEqual(prepareMeasuredComposition(input()), {
  ok: true,
  value: {
    componentId: 2, componentName: 'Named binder', exactLevel: '10',
    calculatorLevel: '10', settingId: 'Binder ten',
  },
})

for (const unit of ['mass%', 'mass %', 'mass percent', 'wt%', 'wt.%', 'weight %', 'weight percent', ' MASS   PERCENT ', 'Wt. %', 'mass\u00a0%']) {
  assert.equal(prepareMeasuredComposition(input({ inputUnit: unit })).ok, true, unit)
}
for (const unit of ['', '%', 'percent', 'vol%', 'volume %', 'volume percent', '°C', 'g', 'mass fraction', 'wt', 'w/w', 'mass % / volume %', 'weight percent per hour']) {
  reject({ inputUnit: unit }, `ambiguous or non-mass-percent unit: ${unit}`, /mass-percent/)
}
reject({ confirmed: false }, 'mapping requires confirmation', /Confirm/)
reject({ confirmed: 'true' }, 'truthy text does not confirm a mapping', /Confirm/)
for (const componentId of [null, undefined, 0, -1, 1.5, NaN, Infinity, 9007199254740992]) {
  reject({ componentId }, `invalid component identifier: ${componentId}`, /component/)
}
reject({ componentId: 3 }, 'missing selected component', /existing component/)
reject({ components: [] }, 'empty case component list', /named component/)
reject({ components: [{ id: 2, name: ' ' }] }, 'unnamed selected component', /name/)
reject({ components: [{ id: 2, name: 'Binder A' }, { id: 2, name: 'Binder B' }] }, 'duplicate identifiers are ambiguous', /different valid identifier/)
reject({ components: [{ id: 1, name: 'Named metal dust' }, { id: 2, name: 'Binder' }, { id: 3, name: ' binder ' }] }, 'duplicate selected names are ambiguous', /distinct name/)
reject({ components: [{ id: 1, name: 'Named metal dust' }, { id: 2, name: 'Cable binder' }, { id: 3, name: 'Cable   binder' }] }, 'whitespace does not distinguish material names', /distinct name/)
reject({ components: [{ id: 0, name: 'Named metal dust' }, { id: 2, name: 'Named binder' }] }, 'invalid registry identifier', /different valid identifier/)

assert.equal(prepareMeasuredComposition(input({ components: [{ id: 1, name: '' }, { id: 2, name: 'Named binder' }] })).ok, true,
  'a different unnamed draft component does not invent or block the selected component mapping')
reject({ setting: changedSetting({ id: ' ' }) }, 'setting identity is required', /identifier/)
for (const patch of [
  { reading_count: 0, in_target_count: 0 },
  { reading_count: -1, in_target_count: -1 },
  { reading_count: 1.5, in_target_count: 1.5 },
  { reading_count: NaN },
  { reading_count: Infinity },
  { reading_count: 9007199254740992, in_target_count: 9007199254740992 },
  { in_target_count: -1 },
  { in_target_count: 1.5 },
  { in_target_count: 2 },
  { in_target_count: 4 },
  { all_readings_in_target: false },
  { all_readings_in_target: 'true' },
]) {
  reject({ setting: changedSetting(patch) }, `invalid or inconsistent recorded counts: ${JSON.stringify(patch)}`, /every entered reading/)
}

for (const [level, calculatorLevel] of [
  ['0', '0'], ['-0', '0'], ['100', '100'], ['100.000', '100'],
  ['01.000e+1', '10'], ['1e1', '10'], ['0.1000', '0.1'],
  ['1e-7', '1e-7'], ['0.0000001', '1e-7'], ['3.0000000000000004e-1', '0.30000000000000004'],
]) {
  const result = prepareMeasuredComposition(input({ setting: changedSetting({ level: ` ${level} ` }) }))
  assert.equal(result.ok, true, level)
  assert.equal(result.value.exactLevel, level, 'preserve the exact recorded point text')
  assert.equal(result.value.calculatorLevel, calculatorLevel, 'canonical numeric representation must retain the same decimal value')
  assert.equal(result.value.settingId, 'Binder ten')
  assert.deepEqual(Object.keys(result.value).sort(), ['calculatorLevel', 'componentId', 'componentName', 'exactLevel', 'settingId'],
    'handoff contains one point, not an inferred range or property prediction')
}
for (const level of ['', ' ', 'NaN', 'Infinity', '0x10', '1,5', '1_000', '-0.000000000000000001', '100.000000000000000005', '101', '1e9999', '1e10001', '1'.repeat(161)]) {
  reject({ setting: changedSetting({ level }) }, `invalid or out-of-bounds exact level: ${level}`, /valid decimal/)
}
reject({ setting: changedSetting({ level: 10 }) }, 'recorded levels must remain decimal text', /exact decimal text/)
for (const level of ['10.000000000000000005', '0.100000000000000005', '99.999999999999999999', '1e-400', '1e-324']) {
  reject({ setting: changedSetting({ level }) }, `lossy numeric conversion: ${level}`, /round the recorded level/)
}

const immutable = input({
  setting: Object.freeze(changedSetting({ id: '  Observed ten  ', level: '  10.00  ' })),
  components: Object.freeze([Object.freeze({ id: 2, name: ' Named binder ' })]),
})
const before = JSON.stringify(immutable)
assert.deepEqual(prepareMeasuredComposition(immutable), {
  ok: true,
  value: {
    componentId: 2, componentName: 'Named binder', exactLevel: '10.00',
    calculatorLevel: '10', settingId: 'Observed ten',
  },
})
assert.equal(JSON.stringify(immutable), before, 'preparing a candidate must not alter the original case or observations')

console.log('Measured composition handoff requires explicit material/mass-basis mapping, matching observed counts and a lossless exact-point conversion')
