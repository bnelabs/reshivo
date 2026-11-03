import type { TrialConfiguration } from './projectWorkspace.ts'

type Fraction = { n: bigint; d: bigint }
export type RecordedRecipePoint =
  | { ok: true; value: string }
  | { ok: true; range: { min: string; max: string; numerator: string; denominator: string } }
  | { ok: false; reason: string }

/** Preserve the entered range and the exact whole-recipe ratio for a rounded point. */
export function recordedRecipeTarget(point: Extract<RecordedRecipePoint, { ok: true }>) {
  if ('value' in point) return { fraction: point.value, min: point.value, max: point.value }
  return { fraction: `${point.range.numerator}/${point.range.denominator}`, min: point.range.min,
    max: point.range.max, range: point.range }
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}
function fraction(n: bigint, d: bigint): Fraction {
  const factor = gcd(n, d)
  return { n: n / factor, d: d / factor }
}
function decimal(value: string): Fraction | null {
  const match = /^\+?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value.trim())
  if (!match || value.length > 160) return null
  const exponent = Number(match[4] ?? '0') - (match[2] ?? match[3] ?? '').length
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return null
  const digits = BigInt(`${match[1] ?? ''}${match[2] ?? match[3] ?? ''}` || '0')
  return exponent >= 0 ? fraction(digits * 10n ** BigInt(exponent), 1n) : fraction(digits, 10n ** BigInt(-exponent))
}
function add(a: Fraction, b: Fraction): Fraction {
  return fraction(a.n * b.d + b.n * a.d, a.d * b.d)
}
function exactDecimal(value: Fraction): string | null {
  let denominator = value.d
  let twos = 0, fives = 0
  while (denominator % 2n === 0n) { denominator /= 2n; twos++ }
  while (denominator % 5n === 0n) { denominator /= 5n; fives++ }
  if (denominator !== 1n) return null
  const places = Math.max(twos, fives)
  if (places > 100) return null
  const digits = (value.n * 2n ** BigInt(places - twos) * 5n ** BigInt(places - fives)).toString().padStart(places + 1, '0')
  const result = places ? `${digits.slice(0, -places)}.${digits.slice(-places).replace(/0+$/, '')}`.replace(/\.$/, '') : digits
  const asNumber = Number(result)
  if (!Number.isFinite(asNumber)) return null
  const roundtrip = decimal(JSON.stringify(asNumber))
  return roundtrip && roundtrip.n === value.n && roundtrip.d === value.d ? result : null
}

function scaledDecimal(value: bigint, places: number): string {
  if (places === 0) return value.toString()
  const digits = value.toString().padStart(places + 1, '0')
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/\.?0+$/, '')
}

/** An outward-rounded percentage interval, with no floating-point rounding. */
function enclosingRange(percent: Fraction, proportion: Fraction): Extract<RecordedRecipePoint, { ok: true; range: unknown }> | null {
  let places = 4
  let scale = 10n ** BigInt(places)
  // Keep useful precision even when the recorded fraction is very small.
  while (percent.n * scale < percent.d && places < 94) { places++; scale *= 10n }
  if (percent.n * scale < percent.d) return null
  if (places > 4) { places += 3; scale *= 1000n }
  const numerator = percent.n * scale
  const floor = numerator / percent.d
  const ceil = floor + (numerator % percent.d === 0n ? 0n : 1n)
  const min = scaledDecimal(floor, places), max = scaledDecimal(ceil, places)
  // The existing calculator transports JSON numbers. Refuse bounds it would change.
  for (const value of [min, max]) {
    const numeric = Number(value)
    const original = decimal(value), roundtrip = Number.isFinite(numeric) ? decimal(JSON.stringify(numeric)) : null
    if (!original || !roundtrip || original.n !== roundtrip.n || original.d !== roundtrip.d) return null
  }
  return { ok: true, range: { min, max, numerator: proportion.n.toString(), denominator: proportion.d.toString() } }
}

// Nanogram factors are exact, including the defined pound and ounce conversion.
const MASS_FACTORS: Record<string, bigint> = { t: 1000000000000000n, kg: 1000000000000n, g: 1000000000n, lb: 453592370000n, oz: 28349523125n }

/** Calculate one exact, whole-recipe mass fraction from the entered recipe only. */
export function recordedRecipeFraction(setup: TrialConfiguration, componentId: string): RecordedRecipePoint {
  const items = setup.materials
  if (!items.length || items.filter((item) => item.id === componentId).length !== 1)
    return { ok: false, reason: 'Choose one material from the recorded setup.' }
  const percentages = items.every((item) => item.unit === 'mass_percent')
  const masses = items.every((item) => Object.hasOwn(MASS_FACTORS, item.unit))
  if (!percentages && !masses)
    return { ok: false, reason: 'Use recorded mass amounts for every ingredient, or mass percentages for the whole recipe.' }
  let total: Fraction = { n: 0n, d: 1n }
  let chosen: Fraction | null = null
  for (const item of items) {
    const amount = decimal(item.amount)
    if (!amount) return { ok: false, reason: 'Enter a known, nonnegative amount for every ingredient in the recorded recipe.' }
    const value = masses ? fraction(amount.n * MASS_FACTORS[item.unit], amount.d) : amount
    total = add(total, value)
    if (item.id === componentId) chosen = value
  }
  if (!chosen || total.n === 0n) return { ok: false, reason: 'The recorded recipe needs a positive total amount.' }
  if (percentages && total.n !== 100n * total.d)
    return { ok: false, reason: 'The recorded mass percentages must total 100% for the whole recipe.' }
  const proportion = fraction(chosen.n * total.d, chosen.d * total.n)
  const ratio = fraction(proportion.n * 100n, proportion.d)
  const result = exactDecimal(ratio)
  if (result !== null) return { ok: true, value: result }
  return enclosingRange(ratio, proportion) ?? { ok: false, reason: 'This fraction is too precise to carry into the calculator. Enter your own trial range instead.' }
}

/** Check a saved source ratio and target against its captured recipe without floating-point rounding. */
export function recordedRecipeMatchesFraction(setup: TrialConfiguration, componentId: string,
  numerator: string, denominator: string, targetMin: number, targetMax: number): boolean {
  if (!/^\d{1,2500}$/.test(numerator) || !/^[1-9]\d{0,2499}$/.test(denominator)) return false
  const proportion = fraction(BigInt(numerator), BigInt(denominator))
  const percent = fraction(proportion.n * 100n, proportion.d)
  const point = recordedRecipeFraction(setup, componentId)
  const low = decimal(String(targetMin)), high = decimal(String(targetMax))
  if (!point.ok || !low || !high || low.n * percent.d > percent.n * low.d || high.n * percent.d < percent.n * high.d) return false
  if ('range' in point) return BigInt(point.range.numerator) * proportion.d === proportion.n * BigInt(point.range.denominator)
  const recorded = decimal(point.value)
  return Boolean(recorded && recorded.n * percent.d === percent.n * recorded.d)
}
