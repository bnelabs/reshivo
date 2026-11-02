import assert from 'node:assert/strict'
import { compareMeasurementDecimals, measurementDecimalKey, parseMeasurementDecimal } from '../src/measurementDecimal.ts'

assert.equal(compareMeasurementDecimals('1e-400', '0'), 1)
assert.equal(compareMeasurementDecimals('0.100000000000000005', '0.1'), 1)
assert.equal(compareMeasurementDecimals('9007199254740993', '9007199254740992'), 1)
assert.equal(compareMeasurementDecimals('-1e-400', '0'), -1)
assert.equal(compareMeasurementDecimals('-2', '-10'), 1)
assert.equal(compareMeasurementDecimals('2', '10'), -1)
assert.equal(compareMeasurementDecimals('1e10000', '9e9999'), 1)
assert.equal(compareMeasurementDecimals('1.000', '1e0'), 0)
assert.equal(measurementDecimalKey('01.00'), measurementDecimalKey('1e0'))
assert.equal(measurementDecimalKey('-0'), measurementDecimalKey('0'))
for (const invalid of ['', ' ', '0x10', 'NaN', 'Infinity', '1e10001', '1e-10001', '1'.repeat(161), '1,2', '1_000', '1e999999']) {
  assert.equal(parseMeasurementDecimal(invalid), null, invalid)
}
console.log('Measurement decimal validation preserves tiny values, exact boundaries and numeric ordering')
