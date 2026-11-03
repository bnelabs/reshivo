import assert from 'node:assert/strict'
import { chooseMixCandidate, describeMixOutcome, mixDiscussionSummary } from '../src/mixCandidate.ts'
const f = (numerator, denominator = '1') => ({ numerator, denominator })
const bounds = (min, max, example = min) => ({ min, max, example })
assert.deepEqual(chooseMixCandidate(bounds(f('1999976000048', '10000000000000'), f('2000012000012', '10000000000000'), f('1', '5')), 'metric'), { kind: 'decimal', amount: '0.2', unit: 'kg' })
assert.deepEqual(chooseMixCandidate(bounds(f('2', '3'), f('2', '3')), 'metric'), { kind: 'fraction', numerator: '2', denominator: '3', approximate: '0.666667', unit: 'kg' })
assert.deepEqual(chooseMixCandidate(bounds(f('0'), f('10')), 'us'), { kind: 'decimal', amount: '0', unit: 'lb' })
assert.deepEqual(chooseMixCandidate(bounds(f('1', '100000000000000000000'), null), 'metric'), { kind: 'decimal', amount: '1e-20', unit: 'kg' })
assert.deepEqual(chooseMixCandidate(bounds(f('1234', '1000'), null), 'metric'), { kind: 'decimal', amount: '1.24', unit: 'kg' })
assert.deepEqual(chooseMixCandidate(bounds(f('1234', '1000'), f('100')), 'metric'), { kind: 'decimal', amount: '1.24', unit: 'kg' })
assert.deepEqual(chooseMixCandidate(bounds(f('45359237', '100000000'), f('45359237', '100000000')), 'us'), { kind: 'decimal', amount: '1', unit: 'lb' })
assert.deepEqual(chooseMixCandidate(bounds(f('10000000000001', '10000000000000'), f('10000000000002', '10000000000000')), 'metric'), { kind: 'precision', unit: 'kg' })
assert.equal(chooseMixCandidate(bounds(f('3'), f('2')), 'metric'), null)
assert.equal(chooseMixCandidate(bounds(f('1'), f('2'), f('3')), 'metric'), null)
assert.equal(chooseMixCandidate({ min: f('-1'), max: null, example: f('1') }, 'metric'), null)
assert.equal(chooseMixCandidate(null, 'metric'), null)
const discussion = { feasible: true, component: 'paper', input_mass_kg: 1, input_min_percent: 40, input_max_percent: 40,
  addition_name: 'stock', addition_percent: 0, target_min_percent: 33.3333, target_max_percent: 33.3334,
  exact_addition_kg: bounds(f('1999976', '10000000'), f('2000012', '10000000'), f('2000001', '10000000')),
  example_addition_kg: 0.2000001, resulting_min_percent: 33.33335, resulting_max_percent: 33.33335 }
assert.match(describeMixOutcome(discussion, 'metric'), /0\.2 kg/)
assert.doesNotMatch(describeMixOutcome(discussion, 'metric'), /0\.2000001|33\.33335/)
assert.doesNotMatch(JSON.stringify(mixDiscussionSummary(discussion, 'metric')), /0\.2000001|33\.33335|resulting_min_percent/)
assert.match(describeMixOutcome({ ...discussion, exact_addition_kg: bounds(f('2', '3'), f('2', '3')) }, 'metric'), /exact calculated amount is 2\/3 kg \(about 0\.666667 kg\)/)
const giantFraction = bounds(f('1' + '0'.repeat(100) + '1', '3' + '0'.repeat(100) + '1'), f('1' + '0'.repeat(100) + '1', '3' + '0'.repeat(100) + '1'))
const giantDiscussion = describeMixOutcome({ ...discussion, exact_addition_kg: giantFraction }, 'metric')
assert.ok(giantDiscussion.length < 200); assert.match(giantDiscussion, /about .*exact fraction remains/)

// Exact independent check: every decimal candidate lies within bounds after exact conversion.
function decimal(value) {
  const m = /^(\d+)(?:\.(\d+))?(?:e(-?\d+))?$/.exec(value)
  assert.ok(m, `invalid candidate ${value}`)
  const digits = BigInt(m[1] + (m[2] || '')), exp = Number(m[3] || 0) - (m[2] || '').length
  return exp >= 0 ? [digits * 10n ** BigInt(exp), 1n] : [digits, 10n ** BigInt(-exp)]
}
for (const system of ['metric', 'us']) {
  for (let i = 1; i <= 500; i++) {
    const lo = BigInt(i * 97), hi = lo + BigInt((i % 11) + 1), d = 100000n
    const result = chooseMixCandidate(bounds(f(String(lo), String(d)), f(String(hi), String(d))), system)
    assert.ok(result && result.kind === 'decimal')
    let [n, den] = decimal(result.amount)
    if (system === 'us') { n *= 45359237n; den *= 100000000n }
    assert.ok(n * d >= lo * den && n * d <= hi * den, `candidate outside bounds: ${system} ${result.amount}`)
    assert.ok(n * d * 100n <= lo * den * 101n, `candidate too far above the minimum: ${system} ${result.amount}`)
  }
}
console.log('Mix candidates use exact bounds, preserve tiny positive values and handle rational singletons')

const { default: React } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { createServer } = await import('vite')
const { fileURLToPath } = await import('node:url')
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, server: { middlewareMode: true }, appType: 'custom' })
try {
  const { MixAdditionResult } = await server.ssrLoadModule('/src/components/MixAdditionResult.tsx')
  const render = (exact, extra = {}, system = 'metric') => renderToStaticMarkup(React.createElement(MixAdditionResult, {
    result: { feasible: true, exact_addition_kg: exact, addition_name: 'stock', example_addition_kg: 0.2, ...extra }, system,
  }))
  const zeroOnly = render(bounds(f('0'), f('0')))
  assert.match(zeroOnly, /No addition is needed/); assert.doesNotMatch(zeroOnly, /Other amounts may also fit/)
  assert.match(render(bounds(f('0'), f('1'))), /Other amounts may also fit/)
  assert.match(render(bounds(f('0'), null)), /Other amounts may also fit/)
  const singleton = render(bounds(f('2', '3'), f('2', '3')))
  assert.match(singleton, /2\/3 kg/); assert.match(singleton, /decimal is approximate/)
  assert.match(render(null), /Estimated amount/)
  const precision = render(bounds(f('10000000000001', '10000000000000'), f('10000000000002', '10000000000000')))
  assert.match(precision, /needs more precision/); assert.doesNotMatch(precision, /within your chosen range/)
  const hugeSingleton = render(bounds(f('1', '1' + '0'.repeat(100)), f('1', '1' + '0'.repeat(100))))
  // This one has an exactly representable scientific candidate, never a displayed zero.
  assert.doesNotMatch(hugeSingleton, /No addition is needed/)
  const giantNumerator = '1' + '0'.repeat(45) + '1'
  const giantDenominator = '3' + '0'.repeat(45) + '1'
  const giant = render(bounds(f(giantNumerator, giantDenominator), f(giantNumerator, giantDenominator)))
  assert.match(giant, /exact fraction is in the calculation details/)
} finally { await server.close() }
