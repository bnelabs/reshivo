import assert from 'node:assert/strict'
import fs from 'node:fs'
import { engineeringNotePatch } from '../src/engineeringNote.ts'

const fixtures = JSON.parse(
  fs.readFileSync(new URL('../../examples/engineering-intake-task-v1.json', import.meta.url)),
)
const fixture = fixtures.fixtures[2]
const caseData = { brief: fixture.request.brief, details: fixture.request.calculation_context }
const original = structuredClone(caseData)
const values = structuredClone(fixture.expected)
values.mass_target_min_kg = 99
const target_resolution = Object.fromEntries(
  [
    'mass_target_min_kg',
    'mass_target_max_kg',
    'balance_target_min_mm',
    'balance_target_max_mm',
    'coordinate_basis',
  ].map((key) => [key, { selected: fixture.expected[key] }]),
)
const response = {
  reviewed_values: values,
  target_resolution,
  ready: false,
  check: null,
  questions: [],
  missing_fields: ['cg_uncertainty_mm'],
  validation_errors: [],
}
const patch = engineeringNotePatch(caseData, response)
assert.equal(patch.details.mass_target_min_kg, '0.98')
assert.equal(patch.observation.id, 'bench-3')
assert.equal(patch.observation.mass, '1')
assert.equal(patch.fields.cg, '5')
assert.equal(patch.fields.cgError, '')
assert.deepEqual(
  patch.fields.positions.map((row) => [row.id, row.x, row.addG, row.removeG]),
  [
    ['L', '-60', '150', '0'],
    ['R', '60', '150', '80'],
  ],
)
assert.equal(patch.fields.resolutionG, '1')
assert.equal(patch.fields.baselineG, '')
assert.deepEqual(caseData, original)
const invalid = engineeringNotePatch(caseData, {
  ...response,
  target_resolution: {
    ...target_resolution,
    mass_target_min_kg: { selected: null, current_text: '1e100' },
  },
})
assert.equal(invalid.details.mass_target_min_kg, '1e100')
assert.throws(() => engineeringNotePatch(caseData, { ...response, reviewed_values: null }))
console.log(
  'Reviewed note applies atomically, preserves canonical targets and clears missing observations',
)
