type MaterialAmount = { id: string; amount: string; unit: string }

export type PendingMaterialUnitChange = {
  id: string
  amount: string
  from: string
  to: string
  exactAmount: string | null
}

export function materialUnitLabel(unit: string): string {
  return unit === 'mass_percent' ? 'mass %' : unit === 'volume_percent' ? 'volume %' : unit
}

// Mass factors in kg are exact definitions. Other properties need their own measurements.
const MASS: Record<string, readonly [bigint, bigint]> = {
  kg: [1n, 1n], g: [1n, 1000n], lb: [45359237n, 100000000n],
  oz: [45359237n, 1600000000n], t: [1000n, 1n],
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b]
  return a
}

/** Convert only when the exact entered decimal has a finite, bounded decimal result. */
export function exactMassUnitConversion(amount: string, from: string, to: string): string | null {
  const source = MASS[from], destination = MASS[to]
  if (!source || !destination || amount.length > 160) return null
  const match = /^\+?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(amount.trim())
  if (!match) return null
  const fraction = match[2] ?? match[3] ?? ''
  const exponent = Number(match[4] ?? '0') - fraction.length
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return null
  let numerator = BigInt(`${match[1] ?? ''}${fraction}` || '0') * source[0] * destination[1]
  let denominator = source[1] * destination[0]
  if (exponent >= 0) numerator *= 10n ** BigInt(exponent)
  else denominator *= 10n ** BigInt(-exponent)
  if (numerator === 0n) return '0'
  const divisor = gcd(numerator, denominator)
  numerator /= divisor
  denominator /= divisor
  let twos = 0, fives = 0
  while (denominator % 2n === 0n) { denominator /= 2n; twos++ }
  while (denominator % 5n === 0n) { denominator /= 5n; fives++ }
  if (denominator !== 1n) return null
  const places = Math.max(twos, fives)
  if (places > 160) return null
  numerator *= 2n ** BigInt(places - twos) * 5n ** BigInt(places - fives)
  const digits = numerator.toString().padStart(places + 1, '0')
  const value = places ? `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/\.?0+$/, '') : digits
  return value.length <= 160 ? value : null
}

export function planMaterialUnitChange(material: MaterialAmount, to: string): PendingMaterialUnitChange | null {
  if (material.unit === to || material.amount === '') return null
  return { id: material.id, amount: material.amount, from: material.unit, to,
    exactAmount: exactMassUnitConversion(material.amount, material.unit, to) }
}

/** Apply only to the unchanged draft for which the choice was presented. */
export function resolveMaterialUnitChange<T extends MaterialAmount>(material: T, pending: PendingMaterialUnitChange, choice: 'convert' | 'keep' | 'clear'): T | null {
  if (material.id !== pending.id || material.amount !== pending.amount || material.unit !== pending.from) return null
  if (choice === 'convert' && pending.exactAmount === null) return null
  return { ...material, unit: pending.to, amount: choice === 'convert' ? pending.exactAmount! : choice === 'clear' ? '' : material.amount }
}
