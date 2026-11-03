import { configurationKey, currentConfigurations, newCostDraft } from './projectWorkspace.ts'
import type { ProjectWorkspace, TrialConfiguration } from './projectWorkspace.ts'

/** Copy only explicitly reviewed comparison definitions to setups without cost drafts. */
export function reuseCostComparisonDetails(workspace: ProjectWorkspace, source: TrialConfiguration): ProjectWorkspace {
  const current = currentConfigurations(workspace)
  const sourceKey = configurationKey(source)
  const captured = current.find((setup) => configurationKey(setup) === sourceKey)
  const details = workspace.costs[sourceKey]
  if (!captured || JSON.stringify(captured) !== JSON.stringify(source) || !details) return workspace
  const destinations = current.filter((setup) => configurationKey(setup) !== sourceKey && !Object.hasOwn(workspace.costs, configurationKey(setup)))
  if (!destinations.length || ![details.currency, details.functional_basis, details.acceptance_basis].some((value) => value.trim())) return workspace
  const costs = { ...workspace.costs }
  for (const setup of destinations) {
    costs[configurationKey(setup)] = { ...newCostDraft(), currency: details.currency,
      functional_basis: details.functional_basis, acceptance_basis: details.acceptance_basis, mode: details.mode }
  }
  return { ...workspace, costs }
}
