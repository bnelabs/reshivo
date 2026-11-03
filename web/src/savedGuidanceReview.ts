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

/** Rename only the displayed label of a captured current plan, retaining its revision and measurements. */
export function renamePlanLabel(w: ProjectWorkspace, captured: TrialConfiguration, value: string): ProjectWorkspace | null {
  const name = value.trim()
  if (!name || name.length > 120) return null
  const current = w.configurations.find((item) => item.id === captured.id && item.revision === captured.revision)
  const latest = Math.max(...w.configurations.filter((item) => item.id === captured.id).map((item) => item.revision))
  if (!current || latest !== captured.revision || JSON.stringify(current) !== JSON.stringify(captured)) return null
  const replacement = { ...current, name }
  if (safeSetupName(w, replacement, '') !== name) return null
  const previousSnapshot = JSON.stringify(current)
  const updatedSnapshot = JSON.stringify(replacement)
  const matchingReferences = (w.mix_adjustment_drafts ?? []).filter((draft) => draft.reference?.setup_id === current.id && draft.reference.setup_revision === current.revision)
  if (matchingReferences.some((draft) => draft.reference?.setup_snapshot !== previousSnapshot)) return null
  return { ...w,
    configurations: w.configurations.map((item) => item === current ? replacement : item),
    ...(w.mix_adjustment_drafts ? { mix_adjustment_drafts: w.mix_adjustment_drafts.map((draft) => {
      const reference = draft.reference
      return reference?.setup_id === current.id && reference.setup_revision === current.revision
        ? { ...draft, reference: { ...reference, setup_snapshot: updatedSnapshot } } : draft
    }) } : {}),
  }
}
