import { configurationKey, currentConfigurations, type ProjectWorkspace } from './projectWorkspace.ts'
import type { RectangularSection } from './sectionDrawing.ts'

const fields = ['product', 'input', 'variation', 'use', 'priorities', 'process', 'constraints'] as const
const names = ['Product', 'Materials', 'What varies', 'Use', 'What matters', 'Process', 'Constraints'] as const

/** Covers every project field and every available plan used in the sketch picker or prompt. */
export function sketchFingerprint(workspace: ProjectWorkspace, includeIdeas: boolean): string {
  return JSON.stringify({ case: workspace.case_id, project: fields.map((name) => workspace.project[name]?.value ?? ''),
    notes: workspace.intake_notes ?? '', plans: includeIdeas ? currentConfigurations(workspace).map((plan) => ({
      id: plan.id, revision: plan.revision, name: plan.name, materials: plan.materials, process: plan.process,
      geometry: plan.geometry, notes: plan.notes, idea: workspace.trial_ideas?.[configurationKey(plan)] ?? null,
    })) : [], includeIdeas })
}

export function sketchPrompt(workspace: ProjectWorkspace, planKey: string, includeIdeas: boolean, section: RectangularSection | null, extra: string): string {
  const lines = fields.map((field, i) => workspace.project[field]?.value ? `${names[i]}: ${workspace.project[field]!.value}` : '').filter(Boolean)
  if (workspace.intake_notes) lines.push(`Earlier user discussion (current project details take precedence): ${workspace.intake_notes}`)
  const plan = includeIdeas ? currentConfigurations(workspace).find((item) => configurationKey(item) === planKey) : undefined
  if (plan) {
    lines.push(`Chosen plan: ${plan.name}`)
    if (plan.materials.length) lines.push(`Plan materials: ${plan.materials.map((m) => [m.name, m.amount, m.unit].filter(Boolean).join(' ')).join('; ')}`)
    if (plan.process) lines.push(`Plan process: ${plan.process}`)
    if (plan.geometry) lines.push(`Plan shape: ${plan.geometry}`)
    if (plan.notes) lines.push(`Plan notes: ${plan.notes}`)
    const idea = workspace.trial_ideas?.[configurationKey(plan)]
    if (idea) lines.push(`Proposed approach: ${idea.change}\nSteps: ${idea.steps.join('; ')}`)
  }
  if (section) lines.push(`Explicit rectangular section: span ${section.span} ${section.unit}, thickness ${section.thickness} ${section.unit}.`)
  if (extra.trim()) lines.push(`Picture details: ${extra.trim()}`)
  return lines.join('\n')
}
