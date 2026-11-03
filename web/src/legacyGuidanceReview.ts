import type { WorkspaceSnapshot } from './workspaceFile.ts'

/** Collect saved assistant-authored text without sending the user's case or messages. */
export function legacyGuidanceTexts(saved: WorkspaceSnapshot): string[] {
  const leaves: string[] = []
  function collect(value: unknown): void {
    if (typeof value === 'string') leaves.push(value)
    else if (Array.isArray(value)) value.forEach(collect)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  ;[saved.plan, saved.followup, saved.selected_route, saved.trial].forEach(collect)
  saved.history.filter((entry) => entry.role === 'assistant').forEach((entry) => collect(entry.content))
  const chunks: string[] = []
  for (const leaf of leaves) {
    if (!leaf) continue
    const previous = chunks[chunks.length - 1]
    if (previous !== undefined && previous.length + leaf.length + 3 <= 100000)
      chunks[chunks.length - 1] = `${previous}\n.\n${leaf}`
    else chunks.push(leaf)
  }
  return chunks
}

export type LegacyReviewResult = 'ready' | 'flagged' | 'failed'

/** Fail closed when the local check cannot establish a result. */
export async function reviewLegacyGuidance(
  texts: string[],
  check: (texts: string[]) => Promise<{ needs_review: boolean }>,
): Promise<LegacyReviewResult> {
  if (!texts.length) return 'ready'
  try {
    const result = await check(texts)
    if (typeof result.needs_review !== 'boolean') return 'failed'
    return result.needs_review ? 'flagged' : 'ready'
  } catch {
    return 'failed'
  }
}

/** Discard advice for a new request while keeping the user's conversation. */
export function freshLegacyAdvice(history: WorkspaceSnapshot['history']) {
  return {
    plan: null,
    followup: null,
    selected_route: null,
    trial: null,
    history: history.filter((entry) => entry.role === 'user'),
  }
}
