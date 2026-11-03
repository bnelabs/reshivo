import type { ProjectWorkspace, TrialConfiguration } from './projectWorkspace'
import { costComparisonReason, costIssueText, displayCostAmount, roundedWinnerCollision } from './costDisplay.ts'
import { trialAssessmentError, trialAssessmentQuestion } from './trialAssessmentNotices.ts'

type ReadingKind = 'user_reported' | 'synthetic'
export type ReportResultKind = 'cost' | 'comparison' | 'checks'

// The result is valid only for the inputs and visibility rules present when calculated.
export function reportResultContext(w: ProjectWorkspace, kind: ReadingKind, showHistoricalIdeas: boolean): string {
  return JSON.stringify({ case_id: w.case_id, project: w.project, configurations: w.configurations,
    checks: w.checks, records: w.records, record_exclusions: w.record_exclusions, costs: w.costs,
    trial_ideas: w.trial_ideas, kind, showHistoricalIdeas })
}

const states: Record<string, string> = {
  all_entered_checks_in_range: 'Required active readings in range', out_of_range: 'Outside a target',
  missing_records: 'Checks still missing', needs_review: 'Review needed', target_not_set: 'Target not set',
  no_required_checks: 'No required checks', in_range: 'Entered readings in range',
  entered_readings_in_range: 'Entered readings in range', not_required: 'Optional', missing: 'Not checked',
}
function state(value: unknown): string {
  return typeof value === 'string' ? (states[value] ?? value.replaceAll('_', ' ')) : 'Review needed'
}
function names(w: ProjectWorkspace, show: boolean) {
  const setups = w.configurations.filter((s) => !w.configurations.some((x) => x.id === s.id && x.revision > s.revision))
  const name = (s: TrialConfiguration) => !show && (w.trial_ideas?.[`${s.id}@${s.revision}`]?.title === s.name || s.notes.startsWith(`Unverified trial idea: ${s.name}.`))
    ? `Plan ${setups.findIndex((item) => item.id === s.id) + 1}` : s.name
  return { setups, name, byId: (id: string, revision?: number) => {
    const s = setups.find((item) => item.id === id && (revision == null || item.revision === revision))
    return s ? name(s) : 'Plan'
  } }
}
const metrics: Record<string, string> = { per_usable_unit: 'Per usable item', per_usable_kg: 'Per usable kg', per_usable_m2: 'Per usable m²' }
function costLines(result: any, currency: string): string[] {
  const total = result?.costs?.entered_scope_total
  const subtotal = result?.costs?.known_subtotal
  const lines = [`Scope: ${result?.status === 'complete' ? 'Included costs complete' : result?.status === 'partial' ? 'Known subtotal; costs are missing' : 'Review the inputs'}`]
  if (total != null || subtotal != null) lines.push(`${total != null ? 'Batch cost (included costs)' : 'Known batch subtotal'}: ${displayCostAmount(total ?? subtotal)} ${currency}`.trim())
  for (const [key, label] of Object.entries(metrics)) {
    const value = result?.unit_costs?.[key]
    if (value != null) lines.push(`${label}${result.unit_costs_scope === 'known_subtotal' ? ' (subtotal only)' : ''}: ${displayCostAmount(value)} ${currency}`.trim())
  }
  return lines
}

export function formatCostResult(result: any, setup: string, revision: number, currency: string, mode: string): string {
  const lines = ['Cost result', `${setup} · version ${revision}`, `Cost simulation · ${mode === 'planned' ? 'planning inputs' : 'entered costs'}`, ...costLines(result, currency)]
  const issues = new Set<string>()
  for (const key of ['errors', 'questions', 'warnings']) for (const issue of result?.[key] ?? []) {
    if (issue !== 'Usable output and unit costs are planning equivalents, not observed products.') issues.add(costIssueText(issue))
  }
  lines.push(...issues)
  return `\n${lines.join('\n')}\n`
}

export function formatComparisonResult(result: any, w: ProjectWorkspace, kind: ReadingKind, show: boolean): string {
  const { byId } = names(w, show)
  const lines = ['Cost comparison', `Cost simulation · ${kind === 'synthetic' ? 'simulated readings' : 'entered readings'}`]
  for (const reason of result?.reasons ?? []) lines.push(costComparisonReason(reason))
  for (const entry of result?.configurations ?? []) {
    lines.push(`${byId(entry.id, entry.revision)} · version ${entry.revision}`, `Required checks: ${state(entry.state)}`)
    for (const check of entry.checks ?? []) if (check.required) lines.push(`${check.name}: ${state(check.state)}`)
    lines.push(...costLines(entry.cost, entry.cost?.currency ?? ''))
  }
  for (const [metric, winner] of Object.entries(result?.decisions ?? {}) as [string, any][]) {
    if (Array.isArray(winner?.configuration_ids) && winner.configuration_ids.length && metrics[metric]) {
      lines.push(`Lowest ${metrics[metric].toLowerCase()} among plans with entered required checks in range: ${winner.configuration_ids.map((id: string) => byId(id)).join(', ')}${roundedWinnerCollision(result, metric) ? ' (values are too close to distinguish at displayed precision)' : ''}`)
    }
  }
  return `\n${lines.join('\n')}\n`
}

export function formatCheckResults(result: any, w: ProjectWorkspace, kind: ReadingKind, show: boolean): string {
  const { setups, name, byId } = names(w, show)
  const lines = ['Check results', kind === 'synthetic' ? 'Software simulation · simulated readings' : 'Assessment of your entered readings']
  for (const entry of result?.configurations ?? []) {
    lines.push(`${byId(entry.id, entry.revision)} · version ${entry.revision}: ${state(entry.state)}`)
    for (const check of entry.checks ?? []) {
      const checkName = w.checks.find((c) => c.id === check.check_id)?.name ?? check.name ?? 'Check'
      lines.push(`${checkName}: ${state(check.state)}`)
      if (Number.isInteger(check.reading_count) && check.reading_count > 0 && typeof check.minimum_entered === 'string' && typeof check.maximum_entered === 'string') {
        const range = check.minimum_entered === check.maximum_entered ? check.minimum_entered : `${check.minimum_entered}–${check.maximum_entered}`
        lines.push(`Entered readings (${check.reading_count}): ${range}${check.unit ? ` ${check.unit}` : ''}`)
      }
    }
  }
  for (const error of result?.errors ?? []) lines.push(trialAssessmentError(error))
  for (const question of result?.questions ?? []) lines.push(trialAssessmentQuestion(question, result, setups, w.checks, kind, name).text)
  if (result?.ignored_records?.length) lines.push(`${result.ignored_records.length} earlier-version or other-kind record(s) retained separately.`)
  return `\n${lines.join('\n')}\n`
}
