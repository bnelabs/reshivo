import type { ProjectIntakeDraft } from './projectIntake'
import type { AdvisorBrief } from './types'

/** Keep the user's material and variation details intact for each provider request. */
export function briefFrom(d: ProjectIntakeDraft): AdvisorBrief {
  return {
    product: d.product?.value ?? 'Product not specified',
    input: d.input?.value ?? 'Materials not specified',
    use_case: d.use?.value ?? 'Use not specified',
    targets: d.priorities?.value ?? 'Requirements not yet set; help choose suitable checks',
    variation: d.variation?.value ?? '',
    process: d.process?.value ?? '',
    contamination: 'Use the user’s stated contamination details; leave any others unspecified.',
    available_changes: d.constraints?.value ?? '',
  }
}
