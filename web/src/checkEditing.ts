import type { ProductCheck, TrialRecord } from './projectWorkspace'

type Exact = { negative: boolean; digits: string; exponent: number }

// Keep the accepted decimal domain and bounds aligned with the trial assessor.
function decimal(value: string): Exact | null {
  if (value.length > 160) return null
  const digitsOnlyForComparison = value.replace(/\p{Decimal_Number}/gu, (character) => {
    const code = character.codePointAt(0)!
    let start = code
    while (start > 0 && /\p{Decimal_Number}/u.test(String.fromCodePoint(start - 1))) start -= 1
    return String((code - start) % 10)
  })
  const match = /^([+-]?)(?:([0-9]+)(?:\.([0-9]*))?|\.([0-9]+))(?:[eE]([+-]?[0-9]+))?$/.exec(
    digitsOnlyForComparison,
  )
  if (!match) return null
  const fraction = match[3] ?? match[4] ?? ''
  const rawExponent = Number(match[5] ?? '0') - fraction.length
  if (!Number.isSafeInteger(rawExponent) || Math.abs(rawExponent) > 1000) return null
  const digits = `${match[2] ?? ''}${fraction}`.replace(/^0+/, '') || '0'
  if (digits !== '0' && Math.abs(digits.length + rawExponent - 1) > 1000) return null
  return { negative: match[1] === '-' && digits !== '0', digits, exponent: rawExponent }
}

function compare(a: Exact, b: Exact): number {
  if (a.digits === '0' && b.digits === '0') return 0
  if (a.negative !== b.negative) return a.negative ? -1 : 1
  const sign = a.negative ? -1 : 1
  if (a.digits === '0') return -sign
  if (b.digits === '0') return sign
  const magnitudeA = a.digits.length + a.exponent
  const magnitudeB = b.digits.length + b.exponent
  if (magnitudeA !== magnitudeB) return (magnitudeA < magnitudeB ? -1 : 1) * sign
  const length = Math.max(a.digits.length, b.digits.length)
  const left = a.digits.padEnd(length, '0')
  const right = b.digits.padEnd(length, '0')
  return (left === right ? 0 : left < right ? -1 : 1) * sign
}

export function validateMaterialAmount(value: unknown, unit?: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || [...value].length > 160)
    return 'Use a short amount or leave it unknown.'
  const percentage = unit === 'mass_percent' || unit === 'volume_percent'
  const candidate = percentage ? value.trim() : value
  const numeric =
    /^[+-]?(?:\p{Decimal_Number}+(?:\.\p{Decimal_Number}*)?|\.\p{Decimal_Number}+)(?:[eE][+-]?\p{Decimal_Number}+)?$/u.test(
      candidate,
    )
  if (!numeric) return null
  const parsed = decimal(candidate)
  if (!parsed) return 'Use a finite amount within the supported numeric range, or leave it unknown.'
  if (parsed.negative) return 'A material amount cannot be negative.'
  if (percentage && compare(parsed, decimal('100')!) > 0)
    return 'A material percentage cannot be more than 100%.'
  return null
}

export function validateCheckDraft(
  draft: ProductCheck,
  original?: ProductCheck,
  records: TrialRecord[] = [],
): string | null {
  if (!draft.name.trim() || !draft.unit.trim() || !draft.method.trim())
    return 'Name the check, its unit and the method. Leave limits blank if they are not set yet.'
  if (draft.name.length > 160 || draft.unit.length > 160 || draft.method.length > 2000)
    return 'Keep the check name and unit within 160 characters and the method within 2,000 characters.'
  if (typeof draft.required !== 'boolean') return 'Choose whether this check is required.'
  if (original && original.id !== draft.id) return 'A saved check cannot change its identity.'
  if (
    original &&
    records.some((record) => record.check_id === original.id) &&
    (draft.name !== original.name ||
      draft.unit !== original.unit ||
      draft.method !== original.method)
  ) {
    return 'This check has saved readings. Add a new check for a different property, unit or method; the existing readings stay with their original check.'
  }
  const lower = draft.minimum === null || draft.minimum === '' ? null : decimal(draft.minimum)
  const upper = draft.maximum === null || draft.maximum === '' ? null : decimal(draft.maximum)
  if (
    (draft.minimum !== null && draft.minimum !== '' && !lower) ||
    (draft.maximum !== null && draft.maximum !== '' && !upper)
  )
    return 'Enter a finite number for each limit, or leave it blank.'
  if (lower && upper && compare(lower, upper) > 0)
    return 'The minimum cannot be greater than the maximum.'
  return null
}

export function checkHasReadings(checkId: string, records: TrialRecord[]): boolean {
  return records.some((record) => record.check_id === checkId)
}

export function validateReadingDraft(readings: TrialRecord['readings']): string | null {
  if (!Array.isArray(readings) || !readings.length || readings.length > 1000)
    return 'Enter between one and 1,000 readings.'
  const identified = new Map<string, TrialRecord['readings'][number]>()
  for (const [index, reading] of readings.entries()) {
    if (typeof reading.value !== 'string' || !decimal(reading.value))
      return `Reading ${index + 1}: enter a finite number without spaces or commas.`
    for (const field of ['reading_id', 'specimen_id', 'run_id', 'batch_id', 'repeat_of'] as const) {
      const value = reading[field]
      if (
        value != null &&
        value !== '' &&
        (typeof value !== 'string' || !value.trim() || value.length > 160)
      )
        return `Reading ${index + 1}: use a nonempty identifier of at most 160 characters, or leave it blank.`
    }
    if (reading.reading_id) {
      if (identified.has(reading.reading_id))
        return 'Reading IDs must be unique within this record.'
      identified.set(reading.reading_id, reading)
    }
  }
  for (const reading of readings) {
    let cursor = reading
    const visited = new Set<string>()
    while (cursor.repeat_of) {
      const target = identified.get(cursor.repeat_of)
      if (!target) return 'A repeated reading must name a reading ID in this same record.'
      if (cursor.specimen_id && target.specimen_id && cursor.specimen_id !== target.specimen_id)
        return 'A repeated reading cannot name a different known specimen.'
      if (visited.has(cursor.repeat_of)) return 'Repeated reading references cannot form a cycle.'
      visited.add(cursor.repeat_of)
      cursor = target
    }
  }
  return null
}

export function checkHasPendingDraft(
  checkId: string,
  drafts: Record<string, { readings: TrialRecord['readings']; confirmed: boolean }>,
): boolean {
  return Object.entries(drafts).some(([key, draft]) => {
    try {
      const context: unknown = JSON.parse(key)
      return (
        Array.isArray(context) &&
        context[1] === checkId &&
        (draft.confirmed ||
          draft.readings.some((reading) =>
            Object.values(reading).some((value) => typeof value === 'string' && value.trim()),
          ))
      )
    } catch {
      return false
    }
  })
}
