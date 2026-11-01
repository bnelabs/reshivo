import assert from 'node:assert/strict'
import { commandGrams } from '../src/quantity.ts'

assert.equal(commandGrams(0.0000004), '0.0004')
assert.equal(commandGrams(0.1041667), '104.1667')
assert.equal(commandGrams(-0.054), '-54')
assert.equal(commandGrams(0), '0')
assert.equal(commandGrams(1e-9), '0.000001')
assert.equal(commandGrams(10000), '10000000')
assert.throws(() => commandGrams(Infinity))
console.log('Command display preserves small and precise adjustment instructions')
