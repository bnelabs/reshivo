/** Move the decimal point of the returned kg command without rounding its instruction. */
export function commandGrams(kg: number): string {
  if (!Number.isFinite(kg)) throw new RangeError('A command must be finite')
  const [mantissa, exponent = '0'] = Math.abs(kg).toString().split('e')
  const [whole, fraction = ''] = mantissa.split('.')
  const digits = whole + fraction
  const point = whole.length + Number(exponent) + 3
  const shifted =
    point <= 0
      ? `0.${'0'.repeat(-point)}${digits}`
      : point >= digits.length
        ? digits + '0'.repeat(point - digits.length)
        : `${digits.slice(0, point)}.${digits.slice(point)}`
  const [integer, decimals = ''] = shifted.split('.')
  const suffix = decimals.replace(/0+$/, '')
  return `${kg < 0 ? '-' : ''}${integer.replace(/^0+(?=\d)/, '')}${suffix ? `.${suffix}` : ''}`
}
