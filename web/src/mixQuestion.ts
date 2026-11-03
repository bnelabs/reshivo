import type { ProjectWorkspace } from './projectWorkspace'

/** Bind a prepared question to the project and inputs that produced it. */
export function mixQuestionFingerprint(workspace: ProjectWorkspace, openEpoch: number): string {
  return JSON.stringify({ case_id: workspace.case_id, project: workspace.project,
    configurations: workspace.configurations, mix_adjustment_drafts: workspace.mix_adjustment_drafts,
    workspaceOpenEpoch: openEpoch })
}

export function mixQuestionIsCurrent(prepared: string | null, current: string): boolean {
  return prepared === null || prepared === current
}
