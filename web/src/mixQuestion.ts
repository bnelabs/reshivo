import type { ProjectWorkspace, TrialConfiguration } from './projectWorkspace'
import type { BalanceMixRequest } from './types'
import { mixAdjustmentRequest, mixDraftNeedsProjectReview, recordedRecipeNeedsReview, savedMixAdjustmentRecord } from './mixAdjustment.ts'

export type PreparedMixCalculation = {
  case_id: string
  configuration_id: string
  configuration_revision: number
  component_id: string
  inputs: BalanceMixRequest
  source: null | { configuration_id: string; configuration_revision: number; component_id: string; latest_revision_at_review: number; basis: 'whole_recipe' }
}

/** Capture reviewed identities separately from the editable, user-facing question. */
export function prepareMixCalculation(workspace: ProjectWorkspace, setup: TrialConfiguration,
  component: { id: string; name: string }, inputs: BalanceMixRequest): PreparedMixCalculation | null {
  const captured = workspace.configurations.find((item) => item.id === setup.id && item.revision === setup.revision)
  const latest = Math.max(...workspace.configurations.filter((item) => item.id === setup.id).map((item) => item.revision))
  if (!captured || latest !== setup.revision || JSON.stringify(captured) !== JSON.stringify(setup)
    || !captured.materials.some((item) => item.id === component.id && item.name === component.name)) return null
  const draft = savedMixAdjustmentRecord(workspace, setup, component)
  if (!draft || mixDraftNeedsProjectReview(draft, workspace.project) || recordedRecipeNeedsReview(workspace, draft)
    || JSON.stringify(mixAdjustmentRequest(component.name, draft.values)) !== JSON.stringify(inputs)) return null
  const ref = draft.reference
  return { case_id: workspace.case_id, configuration_id: setup.id, configuration_revision: setup.revision,
    component_id: component.id, inputs: structuredClone(inputs),
    source: ref ? { configuration_id: ref.setup_id, configuration_revision: ref.setup_revision,
      component_id: ref.component_id, latest_revision_at_review: ref.latest_revision_at_review, basis: ref.basis } : null }
}

/** Bind a prepared question to the project and inputs that produced it. */
export function mixQuestionFingerprint(workspace: ProjectWorkspace, openEpoch: number): string {
  return JSON.stringify({ case_id: workspace.case_id, project: workspace.project,
    configurations: workspace.configurations, mix_adjustment_drafts: workspace.mix_adjustment_drafts,
    workspaceOpenEpoch: openEpoch })
}

export function mixQuestionIsCurrent(prepared: string | null, current: string): boolean {
  return prepared === null || prepared === current
}

/** A recent calculation is offered only while its original calculation context remains current. */
export function canReattachMixCalculation(calculation: PreparedMixCalculation | null, prepared: string | null, current: string): boolean {
  return calculation !== null && prepared !== null && prepared === current
}
