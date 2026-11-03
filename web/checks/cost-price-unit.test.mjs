import assert from 'node:assert/strict'
import { currentPriceUnit, exactPriceUnitConversion, resolvePriceUnit } from '../src/costPriceUnit.ts'
import { costRequest } from '../src/manufacturingCost.ts'
import { newCostDraft, newProjectWorkspace, parseProjectWorkspace, serializeProjectWorkspace } from '../src/projectWorkspace.ts'

const workspace = newProjectWorkspace()
workspace.project.product = { value: 'Panel', source: 'user_review', quote: 'Panel' }
const setup = { id: 'cost-setup', revision: 1, name: 'Panel', process: '', geometry: '', notes: '',
  materials: [{ id: 'first', name: 'Rubber', amount: '1', unit: 'lb' },
    { id: 'second', name: 'Rubber', amount: '2', unit: 'kg' }] }
workspace.configurations = [setup]
const legacy = { ...newCostDraft(), prices: { first: '2.000000000000000005', second: '0' } }
assert.equal(currentPriceUnit(legacy, 'first', 'us'), 'kg', 'old numeric entries remain per kg')
assert.equal(currentPriceUnit(legacy, 'second', 'us'), 'kg', 'zero is still an entered price')
assert.equal(currentPriceUnit(newCostDraft(), 'first', 'us'), 'lb', 'new blank entries follow US preference')
assert.equal(currentPriceUnit(newCostDraft(), 'first', 'metric'), 'kg')
assert.equal(currentPriceUnit(newCostDraft(), 'constructor', 'us'), 'lb', 'object prototype keys are not entered prices')
assert.equal(currentPriceUnit(newCostDraft(), '__proto__', 'us'), 'lb')
assert.equal(exactPriceUnitConversion('1', 'kg', 'lb'), '0.45359237')
assert.equal(exactPriceUnitConversion('1', 'lb', 'kg'), null, 'repeating decimals are not rounded into a new price')
assert.equal(exactPriceUnitConversion('0.45359237', 'lb', 'kg'), '1')
assert.equal(exactPriceUnitConversion('-', 'kg', 'lb'), null)

const pending = { caseId: workspace.case_id, setupId: setup.id, revision: 1, materialId: 'first',
  value: legacy.prices.first, from: 'kg', to: 'lb', converted: exactPriceUnitConversion(legacy.prices.first, 'kg', 'lb') }
const converted = resolvePriceUnit(legacy, pending, workspace.case_id, setup.id, 1, 'us', 'convert')
assert.ok(converted)
assert.equal(converted.prices.first, pending.converted)
assert.equal(converted.prices.second, '0', 'duplicate names do not change a different material ID')
assert.equal(converted.price_units.first, 'lb')
assert.equal(currentPriceUnit(converted, 'first', 'metric'), 'lb', 'global toggles do not reinterpret a saved price')
assert.equal(legacy.prices.first, pending.value, 'a pending choice does not mutate the original')
assert.equal(resolvePriceUnit(legacy, pending, workspace.case_id, setup.id, 2, 'us', 'keep'), null)
assert.equal(resolvePriceUnit({ ...legacy, prices: { ...legacy.prices, first: '3' } }, pending, workspace.case_id, setup.id, 1, 'us', 'keep'), null)
const kept = resolvePriceUnit(legacy, pending, workspace.case_id, setup.id, 1, 'us', 'keep')
assert.equal(kept.prices.first, pending.value); assert.equal(kept.price_units.first, 'lb')
const cleared = resolvePriceUnit(legacy, pending, workspace.case_id, setup.id, 1, 'us', 'clear')
assert.equal(cleared.prices.first, ''); assert.equal(cleared.price_units.first, 'lb')
assert.equal(resolvePriceUnit(legacy, { ...pending, converted: null }, workspace.case_id, setup.id, 1, 'us', 'convert'), null)

workspace.costs['cost-setup@1'] = converted
const reopened = parseProjectWorkspace(serializeProjectWorkspace(workspace))
assert.deepEqual(reopened.costs['cost-setup@1'].price_units, { first: 'lb' })
const sent = costRequest(reopened, setup, reopened.costs['cost-setup@1'])
assert.equal(sent.materials[0].unit_price, pending.converted)
assert.equal(sent.materials[0].price_unit, 'lb')
assert.equal(sent.materials[1].price_unit, 'kg')
const tricky = { ...setup, id: 'other-setup', materials: [{ id: 'constructor', name: 'Stock', amount: '1', unit: 'kg' }] }
const trickyWorkspace = newProjectWorkspace(); trickyWorkspace.configurations = [tricky]
assert.equal(costRequest(trickyWorkspace, tricky, newCostDraft()).materials[0].unit_price, '')
assert.equal(costRequest(trickyWorkspace, tricky, newCostDraft()).materials[0].price_unit, 'kg')
const legacyWorkspace = structuredClone(workspace)
legacyWorkspace.costs['cost-setup@1'] = legacy
assert.equal(costRequest(parseProjectWorkspace(serializeProjectWorkspace(legacyWorkspace)), setup, legacy).materials[0].price_unit, 'kg')
const broken = structuredClone(workspace)
broken.costs['cost-setup@1'].price_units = { 'not-this-material': 'lb' }
assert.throws(() => serializeProjectWorkspace(broken), /price unit/i)
console.log('Cost price units preserve exact values and explicit material-bound choices across save/open')
