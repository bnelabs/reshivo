import type { ProjectIntakeDraft } from './projectIntake'

/** Explicit sound-related wording is a cue for planning help, not a material classification. */
export function isSoundProject(
  project: Pick<ProjectIntakeDraft, 'product' | 'use' | 'priorities'> | null | undefined,
  question = '',
): boolean {
  const words = [project?.product?.value, project?.use?.value, project?.priorities?.value, question]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
  return /\b(?:sound(?:proof(?:ing|ed)?)?|noise|noisy|acoustic(?:s|al)?|echo(?:es|ing)?|reverberat(?:ion|e|ing)|quieter)\b/i.test(
    words,
  )
}
