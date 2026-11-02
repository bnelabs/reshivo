export type UnitSystem = 'metric' | 'us'
export type CanonicalUnit = 'kg' | 'g' | 'mm'

const IMPERIAL_FACTOR: Record<CanonicalUnit, number> = { kg: 0.45359237, g: 453.59237, mm: 25.4 }
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
const INVALID = 'invalid:'

export function unitLabel(unit: CanonicalUnit, system: UnitSystem): string {
  return system === 'metric' ? unit : unit === 'mm' ? 'in' : 'lb'
}

export function toDisplay(value: string, unit: CanonicalUnit, system: UnitSystem): string {
  if (value.startsWith(INVALID)) return value.slice(INVALID.length)
  if (system === 'metric' || !value.trim()) return value
  const n = Number(value)
  const converted = n / IMPERIAL_FACTOR[unit]
  return Number.isFinite(n) && Number.isFinite(converted)
    ? String(Number(converted.toPrecision(7)))
    : value
}

export function toCanonical(value: string, unit: CanonicalUnit, system: UnitSystem): string {
  if (!value.trim()) return value
  if (!DECIMAL.test(value.trim())) return Number.isFinite(Number(value)) ? INVALID + value : value
  const n = Number(value)
  if (n === 0 && /[1-9]/.test(value.trim().split(/[eE]/)[0])) return INVALID + value
  if (Number.isFinite(n) && n !== 0 && (!Number.isFinite(n / IMPERIAL_FACTOR[unit]) || n / IMPERIAL_FACTOR[unit] === 0))
    return INVALID + value
  if (system === 'metric') return value
  const converted = n * IMPERIAL_FACTOR[unit]
  if (Number.isFinite(n) && (!Number.isFinite(converted) || (n !== 0 && converted === 0)))
    return INVALID + value
  return Number.isFinite(n) ? String(Number(converted.toPrecision(15))) : value
}

export function outwardBound(value: number, unit: CanonicalUnit, system: UnitSystem, side: 'min' | 'max'): string {
  if (!Number.isFinite(value)) throw new RangeError('A bound must be finite')
  const converted = system === 'metric' ? value : value / IMPERIAL_FACTOR[unit]
  if (!Number.isFinite(converted) || converted === 0) return String(converted)
  const step = 10 ** (Math.floor(Math.log10(Math.abs(converted))) - 3)
  if (!step || !Number.isFinite(step)) return String(converted)
  const outward = (side === 'min' ? Math.floor(converted / step) : Math.ceil(converted / step)) * step
  return String(Number(outward.toPrecision(6)))
}
