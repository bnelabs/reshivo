import type { ProjectWorkspace, TrialConfiguration } from './projectWorkspace.ts'
import { configurationKey } from './projectWorkspace.ts'

/** Check saved guidance locally, including imported notes labeled as local. */
export function savedGuidanceTexts(w: ProjectWorkspace): string[] {
  return [
    ...(w.advice_notes ?? []).map((note) => note.text),
    ...Object.values(w.trial_ideas ?? {}).map((idea) => [idea.title, idea.change, idea.why, ...idea.steps, ...idea.tradeoffs, idea.check].join('\n')),
    ...w.configurations.filter((setup) => setup.notes.startsWith('Unverified trial idea:')).map((setup) => setup.notes),
  ]
}

/** Hide text copied from a saved idea when that guidance is unavailable. */
export function safeSetupName(w: ProjectWorkspace, setup: TrialConfiguration, fallback: string): string {
  const idea = w.trial_ideas?.[configurationKey(setup)]
  return idea?.title === setup.name || setup.notes.startsWith(`Unverified trial idea: ${setup.name}.`) ? fallback : setup.name
}
