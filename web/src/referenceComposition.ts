import type { TrialConfiguration } from './projectWorkspace.ts'

type Fraction = { n: bigint; d: bigint }

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

// Nanogram factors are exact, including the defined pound and ounce conversion.
const MASS_FACTORS: Record<string, bigint> = { t: 1000000000000000n, kg: 1000000000000n, g: 1000000000n, lb: 453592370000n, oz: 28349523125n }

/** Calculate one exact, whole-recipe mass fraction from the entered recipe only. */
export function recordedRecipeFraction(setup: TrialConfiguration, componentId: string): { ok: true; value: string } | { ok: false; reason: string } {
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
  const ratio = fraction(chosen.n * total.d * 100n, chosen.d * total.n)
  const result = exactDecimal(ratio)
  if (result === null) return { ok: false, reason: 'The exact fraction cannot be entered without rounding. Enter your own trial range instead.' }
  return { ok: true, value: result }
}
