/** Format calculated cost text without turning a positive small amount into zero. */
export function displayCostAmount(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return 'Unknown'
  const number = Number(value)
  if (number === 0 && !/[1-9]/.test(value)) return '0'
  if (number > 0 && number >= 1e-9 && number < 1e12) {
    return number.toLocaleString(undefined, { maximumSignificantDigits: 8 })
  }
  // Work from the decimal text for extremes, including values outside JS Number range.
  const [whole, fraction = ''] = value.split('.')
  const significantWhole = whole.replace(/^0+/, '')
  const digits = significantWhole ? significantWhole + fraction : fraction.replace(/^0+/, '')
  let exponent = significantWhole ? significantWhole.length - 1 : -(fraction.length - digits.length + 1)
  if (!digits) return '0'
  let shown = digits.slice(0, 8)
  if (digits.length > 8 && digits[8] >= '5') {
    const rounded = (BigInt(shown) + 1n).toString()
    if (rounded.length > shown.length) {
      exponent += 1
      shown = rounded.slice(0, -1)
    } else shown = rounded
  }
  shown = shown.replace(/0+$/, '')
  const mantissa = shown.length > 1 ? `${shown[0]}.${shown.slice(1)}` : shown
  return `${mantissa}e${exponent >= 0 ? '+' : ''}${exponent}`
}

/** A question from the calculator has a different key from an error. */
export function costIssueText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const issue = value as Record<string, unknown>
    if (typeof issue.message === 'string') return issue.message
    if (typeof issue.field === 'string') {
      const field = issue.field
      if (field === 'currency') return 'Enter a currency, such as EUR.'
      if (field === 'functional_basis') return 'Describe the product and use that these costs cover.'
      if (field === 'mass_basis' || field.endsWith('.basis')) return 'Say whether your material amounts and prices use the same condition, such as wet or dry.'
      if (field === 'output.acceptance_basis') return 'Describe what makes an item usable for this estimate.'
    }
    if (typeof issue.question === 'string') return issue.question
  }
  return 'Review this cost input.'
}

const comparisonReasons: Record<string, string> = {
  'Provide at least two cost-record objects.': 'Add costs for at least two plans to compare them.',
  'All records need complete, conflict-free costs within their entered scope.': 'Complete the included costs for each plan and resolve any conflicting entries.',
  'All configuration revisions must be explicitly current.': 'Use the current version of each plan.',
  'Every compared record needs an explicit configuration identity.': 'Choose a plan for each cost estimate.',
  'Compared configuration identities must be distinct.': 'Choose a different plan for each cost estimate.',
  'Records need the same explicit case_id.': 'Compare plans from the same project.',
  'Records need the same explicit currency.': 'Use the same currency for each plan.',
  'Records need the same explicit product_basis.': 'Use the same product for each plan.',
  'Records need the same explicit functional_basis.': 'Describe the same product and use for each plan.',
  'Records need the same explicit scope_basis.': 'Include the same types of costs for each plan.',
  'Included/excluded manufacturing categories must match.': 'Include or exclude the same processing costs for each plan.',
  'Match what each process charge includes across setups.': 'Make sure each processing charge covers the same things in every plan.',
  'Use the same named other-cost categories in each setup before comparing.': 'Use the same named other costs in each plan.',
  'Usable-output acceptance definitions must match.': 'Use the same definition of usable output for each plan.',
  'Do not name a winner between observed output and planned output estimates.': 'Use either recorded output or planned output for every plan.',
  'No common positive, explicitly entered usable-output denominator is available.': 'Enter a positive usable output in the same units for each plan.',
  'Add at least one current trial setup.': 'Add a current plan.',
  'Add one current cost record for every setup before comparing.': 'Add costs for each current plan before comparing.',
  'Resolve missing targets, readings or record reviews for every required check before selecting a setup.': 'Make sure each plan has required checks with targets and reviewed readings before choosing a plan.',
  'No setup has entered readings inside every required target.': 'None of the plans has entered readings within every required target.',
}

/** Keep internal field names out of comparison guidance. */
export function costComparisonReason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Review the comparison details for each plan.'
  const text = value.trim()
  if (comparisonReasons[text]) return comparisonReasons[text]
  return (/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/i.test(text) || /^Records need the same explicit .+\.$/i.test(text))
    ? 'Review the comparison details for each plan.' : text
}

/** Flag when the displayed rounding hides the difference behind a unique winner. */
export function roundedWinnerCollision(comparison: any, metric: string): boolean {
  const winner = comparison?.decisions?.[metric]
  if (!Array.isArray(winner?.configuration_ids) || winner.configuration_ids.length !== 1 || winner.tie !== false) return false
  const rows = comparison?.configurations
  if (!Array.isArray(rows)) return false
  const selected = rows.find((row: any) => row.id === winner.configuration_ids[0])
  const selectedValue = selected?.cost?.unit_costs?.[metric]
  if (typeof selectedValue !== 'string') return false
  return rows.some((row: any) => row.id !== selected.id && row.state === 'all_entered_checks_in_range' &&
    typeof row.cost?.unit_costs?.[metric] === 'string' &&
    displayCostAmount(row.cost.unit_costs[metric]) === displayCostAmount(selectedValue))
}
