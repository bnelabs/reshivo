import type { AdvisorRoute } from './types'

/** Prepare a reviewable question without silently cutting details or numbers. */
export function buildIdeaComparisonQuestion(routes: AdvisorRoute[]): string {
  if (!routes.length) return ''
  const intro = routes.length > 1
    ? 'Which idea should I explore first for my material, product and available equipment? Give a conditional choice and explain why, its trade-offs and what is unknown. If there is not enough information, say what would change your choice. Explain whether the ideas can work together. Do not guess missing details.'
    : 'Help me understand this suggested idea for my material, product and available equipment. Explain when it might be a good first choice, the trade-offs, what I would need and what is unknown. Do not guess missing details.'
  const prefix = `${intro}\n\nSuggested ideas:`
  const lines = routes.map((route) => ({
    detailed: `\n- ${route.title}: ${route.change}\n  Why: ${route.why}\n  Trade-offs: ${route.tradeoffs.join(' ')}\n  What to check: ${route.check}`,
    core: `\n- ${route.title}: ${route.change} (reasons, trade-offs and check omitted)`,
    short: `\n- ${route.title} (details omitted; ask before comparing this idea)`,
  }))
  let available = 3000 - prefix.length - lines.reduce((total, line) => total + line.short.length, 0)
  const chosen = lines.map((line) => line.short)
  for (const field of ['core', 'detailed'] as const) {
    lines.forEach((line, index) => {
      // Share each idea's change first; add complete details only when they fit.
      const extra = line[field].length - chosen[index].length
      if (extra <= available) { available -= extra; chosen[index] = line[field] }
    })
  }
  return prefix + chosen.join('')
}
