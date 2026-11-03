import type { ReportResultKind } from './reportResults'

type SavedResult = { text: string; context: string }
export type DecisionResult = { summary: string[]; detail: string }

function resultCard(kind: 'mix' | 'cost' | 'checks', text: string): DecisionResult | null {
  if (!text.trim()) return null
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  let summary: string[]
  if (kind === 'mix') {
    summary = [
      'Composition simulation',
      ...lines.filter((line) => /^Plan: |^Material tracked: |^Added material: |^Chosen composition: |^One displayed calculated amount|^The exact calculated amount|^The calculated amount|^The calculated range|^The earlier server reported|^No single addition|^Your starting mix/.test(line)),
    ]
    if (!summary.some((line) => /^One displayed calculated amount|^The exact calculated amount|^The calculated amount|^The calculated range|^The earlier server reported|^No single addition|^Your starting mix/.test(line))) summary.push('Open the details to review this result.')
  } else if (kind === 'cost') {
    summary = lines.filter((line) => / · version \d+$|^Cost simulation|^Scope:|^Batch cost |^Known batch subtotal:|^Per usable /.test(line))
  } else {
    const planLines = lines.filter((line) => / · version \d+:/.test(line))
    summary = [
      ...lines.filter((line) => /^Software simulation|^Assessment of your entered readings/.test(line)),
      ...planLines.slice(0, 3),
      ...(planLines.length > 3 ? [`${planLines.length - 3} more plan(s) in details`] : []),
    ]
  }
  return { summary: summary.length ? summary.map((line) => line.replace(/^One displayed calculated amount is /, 'Amount to explore: ')) : ['Open the details to review this result.'], detail: text.trim() }
}

/** Display only results still tied to the currently visible project and reading source. */
export function decisionResults(
  mixSummary: string,
  results: Partial<Record<ReportResultKind, SavedResult>>,
  currentContext: Record<'cost' | 'checks', string>,
): { mix: DecisionResult | null; cost: DecisionResult | null; checks: DecisionResult | null } {
  const current = (kind: 'cost' | 'checks') => {
    const result = results[kind]
    return result?.context === currentContext[kind] ? result.text.trim() : ''
  }
  return { mix: resultCard('mix', mixSummary), cost: resultCard('cost', current('cost')), checks: resultCard('checks', current('checks')) }
}
