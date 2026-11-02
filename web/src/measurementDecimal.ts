type ExactDecimal = { negative: boolean; digits: string; exponent: number }

export function parseMeasurementDecimal(value: string): ExactDecimal | null {
  const text = value.trim()
  if (text.length > 160) return null
  const match = /^([+-]?)(?:([0-9]+)(?:\.([0-9]*))?|\.([0-9]+))(?:[eE]([+-]?[0-9]{1,5}))?$/.exec(text)
  if (!match) return null
  const explicitExponent = Number(match[5] || '0')
  if (Math.abs(explicitExponent) > 10000) return null
  const fraction = match[3] ?? match[4] ?? ''
  let digits = `${match[2] || ''}${fraction}`.replace(/^0+/, '') || '0'
  let exponent = explicitExponent - fraction.length
  if (Math.abs(digits.length + exponent - 1) > 10000) return null
  if (digits === '0') return { negative: false, digits: '0', exponent: 0 }
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1)
    exponent += 1
  }
  return { negative: match[1] === '-', digits, exponent }
}

export function measurementDecimalKey(value: string): string | null {
  const parsed = parseMeasurementDecimal(value)
  return parsed ? `${parsed.negative ? '-' : ''}${parsed.digits}e${parsed.exponent}` : null
}

export function compareMeasurementDecimals(left: string, right: string): number | null {
  const a = parseMeasurementDecimal(left)
  const b = parseMeasurementDecimal(right)
  if (!a || !b) return null
  if (a.digits === '0' && b.digits === '0') return 0
  if (a.negative !== b.negative) return a.negative ? -1 : 1
  const direction = a.negative ? -1 : 1
  if (a.digits === '0') return -direction
  if (b.digits === '0') return direction
  const magnitudeA = a.digits.length + a.exponent
  const magnitudeB = b.digits.length + b.exponent
  if (magnitudeA !== magnitudeB) return (magnitudeA < magnitudeB ? -1 : 1) * direction
  const length = Math.max(a.digits.length, b.digits.length)
  const digitsA = a.digits.padEnd(length, '0')
  const digitsB = b.digits.padEnd(length, '0')
  return (digitsA === digitsB ? 0 : digitsA < digitsB ? -1 : 1) * direction
}
