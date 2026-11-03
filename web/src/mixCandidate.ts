import type { UnitSystem } from './unitConversion.ts'
import type { BalanceMixResult } from './types'

export type ExactFraction = { numerator: string; denominator: string }
export type ExactAddition = { min: ExactFraction; max: ExactFraction | null; example: ExactFraction }
type Fraction = { n: bigint; d: bigint }
export type MixCandidate =
  | { kind: 'decimal'; amount: string; unit: 'kg' | 'lb' }
  | { kind: 'fraction'; numerator: string; denominator: string; approximate: string; unit: 'kg' | 'lb' }
  | { kind: 'precision'; unit: 'kg' | 'lb' }

const LB_KG: Fraction = { n: 45359237n, d: 100000000n }
const ONE: Fraction = { n: 1n, d: 1n }
function gcd(a: bigint, b: bigint): bigint { while (b) [a, b] = [b, a % b]; return a }
function ratio(n: bigint, d: bigint): Fraction { const f = gcd(n, d); return { n: n / f, d: d / f } }
function parseFraction(value: unknown): Fraction | null {
  if (!value || typeof value !== 'object' || !('numerator' in value) || !('denominator' in value)) return null
  const { numerator, denominator } = value
  if (typeof numerator !== 'string' || typeof denominator !== 'string' || numerator.length > 2500 || denominator.length > 2500 || !/^\d+$/.test(numerator) || !/^[1-9]\d*$/.test(denominator)) return null
  return ratio(BigInt(numerator), BigInt(denominator))
}
function compare(a: Fraction, b: Fraction): number { const n = a.n * b.d - b.n * a.d; return n < 0n ? -1 : n > 0n ? 1 : 0 }
function divide(a: Fraction, b: Fraction): Fraction { return ratio(a.n * b.d, a.d * b.n) }
function power10(exponent: number): Fraction { return exponent >= 0 ? { n: 10n ** BigInt(exponent), d: 1n } : { n: 1n, d: 10n ** BigInt(-exponent) } }
function order(value: Fraction): number {
  let exponent = value.n.toString().length - value.d.toString().length
  if (compare(value, power10(exponent)) < 0) exponent--
  return exponent
}
function decimalText(integer: bigint, exponent: number): string {
  let digits = integer.toString()
  while (digits.length > 1 && digits.endsWith('0')) { digits = digits.slice(0, -1); exponent++ }
  const order = digits.length - 1 + exponent
  if (order >= 9 || order <= -7) return digits.length === 1 ? `${digits}e${order}` : `${digits[0]}.${digits.slice(1)}e${order}`
  if (exponent >= 0) return digits + '0'.repeat(exponent)
  const point = digits.length + exponent
  return point > 0 ? `${digits.slice(0, point)}.${digits.slice(point)}` : `0.${'0'.repeat(-point)}${digits}`
}
function approximate(value: Fraction): string {
  // Six significant decimal digits calculated by integer division; no conversion
  // to floating point is used, so tiny positive quantities never become zero.
  const magnitude = order(value)
  const exponent = magnitude - 5
  const grid = power10(exponent)
  const scaledNumerator = value.n * grid.d
  const scaledDenominator = value.d * grid.n
  const rounded = (2n * scaledNumerator + scaledDenominator) / (2n * scaledDenominator)
  return decimalText(rounded, exponent)
}

/** Find a short decimal which is inside exact kg bounds after exact unit conversion. */
export function chooseMixCandidate(bounds: ExactAddition | null | undefined, system: UnitSystem): MixCandidate | null {
  if (!bounds || (system !== 'metric' && system !== 'us')) return null
  const min = parseFraction(bounds.min), max = bounds.max === null ? null : parseFraction(bounds.max)
  const example = parseFraction(bounds.example)
  if (!min || !example || (bounds.max !== null && !max) || (max && compare(min, max) > 0) || compare(example, min) < 0 || (max && compare(example, max) > 0)) return null
  const factor = system === 'us' ? LB_KG : ONE
  const lower = divide(min, factor), upper = max && divide(max, factor)
  const unit = system === 'us' ? 'lb' : 'kg'
  if (lower.n === 0n) return { kind: 'decimal', amount: '0', unit }
  // Exact decimal grids from one significant figure to twelve. This chooses one
  // valid amount, not rounded endpoints and not an expanded feasible interval.
  const start = order(lower)
  for (let exponent = start; exponent >= start - 11; exponent--) {
    const grid = power10(exponent)
    const n = lower.n * grid.d, d = lower.d * grid.n
    const integer = (n + d - 1n) / d
    const candidate = ratio(integer * grid.n, grid.d)
    // A coarse grid can otherwise choose an unnecessarily large addition.
    // Stay within one percent of the computed minimum as well as the interval.
    const nearMinimum = candidate.n * lower.d * 100n <= lower.n * candidate.d * 101n
    if (nearMinimum && (!upper || compare(candidate, upper) <= 0))
      return { kind: 'decimal', amount: decimalText(integer, exponent), unit }
  }
  // A non-terminating singleton has no exact finite decimal in its interval.
  // Keep the exact amount in kg and label the selected-unit decimal approximate.
  if (max && compare(min, max) === 0) return { kind: 'fraction', numerator: min.n.toString(), denominator: min.d.toString(), approximate: approximate(lower), unit }
  return { kind: 'precision', unit }
}

/** Match the visible candidate without attaching the solver's different midpoint. */
export function describeMixOutcome(result: BalanceMixResult, system: UnitSystem): string {
  if (!result.feasible) return 'No single addition fits the whole entered range.'
  const candidate = chooseMixCandidate(result.exact_addition_kg, system)
  if (candidate?.kind === 'decimal') return `One displayed calculated amount is ${candidate.amount} ${candidate.unit}.`
  if (candidate?.kind === 'fraction') return `${candidate.numerator.length + candidate.denominator.length <= 160
    ? `The exact calculated amount is ${candidate.numerator}/${candidate.denominator} kg (about ${candidate.approximate} ${candidate.unit}).`
    : `The calculated amount is about ${candidate.approximate} ${candidate.unit}; the exact fraction remains in the calculation details.`}`
  if (candidate?.kind === 'precision') return 'The calculated range needs more precision than a short amount can show.'
  if (typeof result.example_addition_kg === 'number' && Number.isFinite(result.example_addition_kg))
    return `The earlier server reported approximately ${result.example_addition_kg} kg; exact bounds were not available.`
  return 'The calculated amount is unavailable.'
}

/** Share the displayed amount and original inputs, not percentages from another example. */
export function mixDiscussionSummary(result: BalanceMixResult, system: UnitSystem) {
  return {
    component: result.component,
    input_mass_kg: result.input_mass_kg,
    input_min_percent: result.input_min_percent,
    input_max_percent: result.input_max_percent,
    addition_name: result.addition_name,
    addition_percent: result.addition_percent,
    target_min_percent: result.target_min_percent,
    target_max_percent: result.target_max_percent,
    feasible: result.feasible,
    displayed_calculation: describeMixOutcome(result, system),
  }
}
