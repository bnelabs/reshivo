import { api } from './api'

export const PROJECT_INTAKE_FIELDS = ['product', 'input', 'variation', 'use', 'priorities', 'process', 'constraints'] as const
export type ProjectIntakeField = typeof PROJECT_INTAKE_FIELDS[number]
export type ProjectIntakeSource = 'message' | `history.${0 | 1 | 2 | 3 | 4 | 5}` | 'user_review'
export type ProjectIntakeRecord = { value: string; source: ProjectIntakeSource; quote: string }
export type ProjectIntakeDraft = Record<ProjectIntakeField, ProjectIntakeRecord | null>
export type ProjectIntakeMessage = { role: 'user' | 'assistant'; content: string }
export type ProjectIntakeRequest = {
  message: string
  history?: ProjectIntakeMessage[]
  reviewed_draft?: ProjectIntakeDraft | null
}
export type ProjectIntakeResult = {
  result_kind: 'project_intake'
  reply: string
  project_draft: ProjectIntakeDraft
  questions: string[]
  first_step: string
  unknown_fields: ProjectIntakeField[]
  readiness: 'can_explore' | 'needs_context'
  review_required: true
  interpretation_verified: false
  ready_for_calculation: false
  physical_product_tested: false
  performance_verified: false
  request_fingerprint: string
  provider: string
  model: string
  live: boolean
  usage: Record<string, number>
  request_id: string | null
  elapsed_ms: number
  requested_reasoning_effort: string
}

export function emptyProjectDraft(): ProjectIntakeDraft {
  return { product: null, input: null, variation: null, use: null, priorities: null, process: null, constraints: null }
}

export function reviewProjectDraft(draft: ProjectIntakeDraft): ProjectIntakeDraft {
  return Object.fromEntries(PROJECT_INTAKE_FIELDS.map((field) => {
    const value = draft[field]?.value
    return [field, value?.trim() ? { value, source: 'user_review', quote: value } : null]
  })) as ProjectIntakeDraft
}

export function hasProjectContext(draft: ProjectIntakeDraft): boolean {
  return Boolean(draft.product?.value.trim() && draft.input?.value.trim() && (draft.use?.value.trim() || draft.priorities?.value.trim()))
}

export function recentIntakeHistory(history: ProjectIntakeMessage[], message: string): ProjectIntakeMessage[] {
  const recent = history.slice(-6)
  if (recent.some((entry) => !entry.content.trim() || entry.content.length > 3000)) {
    throw new Error('Keep each discussion message within 3,000 characters. Your project details are still here.')
  }
  while (recent.length && recent.reduce((total, entry) => total + entry.content.length, message.length) > 18000) recent.shift()
  return recent
}

function validDraft(value: unknown): value is ProjectIntakeDraft {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== PROJECT_INTAKE_FIELDS.length) return false
  const draft = value as Record<string, unknown>
  return PROJECT_INTAKE_FIELDS.every((field) => {
    const record = draft[field]
    if (record === null) return true
    if (!record || typeof record !== 'object' || Object.keys(record).sort().join(',') !== 'quote,source,value') return false
    const item = record as Record<string, unknown>
    return typeof item.value === 'string' && Boolean(item.value.trim()) && item.value.length <= 1000
      && typeof item.quote === 'string' && Boolean(item.quote.trim()) && item.quote.length <= 1500
      && item.quote.includes(item.value) && typeof item.source === 'string' && /^(message|history\.[0-5]|user_review)$/.test(item.source)
  })
}

export async function requestProjectIntake(request: ProjectIntakeRequest, signal?: AbortSignal): Promise<ProjectIntakeResult> {
  if (!request.message.trim() || request.message.length > 4000) throw new Error('Describe your idea in 4,000 characters or fewer.')
  const body = { ...request, history: recentIntakeHistory(request.history ?? [], request.message) }
  const result = await api<ProjectIntakeResult>('/api/project/intake', body, signal)
  if (result?.result_kind !== 'project_intake' || !validDraft(result.project_draft)
    || typeof result.reply !== 'string' || !result.reply.trim() || result.reply.length > 1200
    || typeof result.first_step !== 'string' || !result.first_step.trim() || result.first_step.length > 700
    || !Array.isArray(result.questions) || result.questions.length > 3
    || result.questions.some((question) => typeof question !== 'string' || !question.trim() || question.length > 350)
    || result.review_required !== true || result.interpretation_verified !== false
    || result.ready_for_calculation !== false || result.physical_product_tested !== false || result.performance_verified !== false) {
    throw new Error('The provider returned an unusable project draft. Your idea and current details are still here; try again.')
  }
  return result
}
