import type { ProductCheck, TrialConfiguration } from './projectWorkspace'

type ReadingKind = 'synthetic' | 'user_reported'
type Assessment = { configurations?: { id?: unknown; revision?: unknown; checks?: { check_id?: unknown; state?: unknown }[] }[] }

export type TrialNotice = {
  text: string
  reading?: { setup: TrialConfiguration; check: ProductCheck }
}

function readable(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  // Raw transport objects and internal field paths are not useful instructions.
  if (/^\s*[{[]/.test(value) || /\b(?:configurations|checks|records)\.[\w.-]+/.test(value)
    || /\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/i.test(value)) return null
  return value
}

export function trialAssessmentError(error: unknown): string {
  if (typeof error === 'string') return readable(error) ?? 'Review the entries above and try again.'
  if (error && typeof error === 'object' && 'message' in error)
    return readable(error.message) ?? 'Review the entries above and try again.'
  return 'Review the entries above and try again.'
}

export function trialAssessmentQuestion(
  question: unknown,
  assessment: Assessment,
  setups: TrialConfiguration[],
  checks: ProductCheck[],
  kind: ReadingKind,
  setupName: (setup: TrialConfiguration) => string,
): TrialNotice {
  const generic = (): TrialNotice => {
    const raw = typeof question === 'string' ? question
      : question && typeof question === 'object' && 'question' in question ? question.question : null
    return { text: readable(raw) ?? 'Review the entries above and try again.' }
  }
  if (!question || typeof question !== 'object' || !('field' in question) || typeof question.field !== 'string') return generic()
  const field = question.field
  if (field === 'checks.required') return { text: 'Choose at least one required check.' }

  const targets = checks.filter((check) => field === `checks.${check.id}.target`)
  if (targets.length === 1) return { text: `${targets[0].name}: Set a minimum or maximum target.` }
  if (targets.length > 1) return generic()

  // Match complete fields, not dot-separated parts: imported identifiers can contain dots.
  const matches = setups.flatMap((setup) => checks
    .filter((check) => field === `configurations.${setup.id}.checks.${check.id}`)
    .map((check) => ({ setup, check })))
  if (matches.length !== 1) return generic()
  const { setup, check } = matches[0]
  const result = assessment.configurations?.find((entry) => entry.id === setup.id && entry.revision === setup.revision)
    ?.checks?.find((entry) => entry.check_id === check.id)
  const prefix = `${setupName(setup)} · version ${setup.revision} — ${check.name}: `
  if (result?.state === 'missing_records') return {
    text: `${prefix}Add ${kind === 'synthetic' ? 'a simulated' : 'an entered'} reading and confirm its test conditions.`,
    reading: { setup, check },
  }
  if (result?.state === 'needs_review') return {
    text: `${prefix}Review the saved entry and confirm its test conditions.`,
  }
  return generic()
}
