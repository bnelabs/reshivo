import { useId } from 'react'
import type { ProjectIntakeDraft } from '../projectIntake'
import { isSoundProject } from '../soundGuidance'

type Props = {
  project: Pick<ProjectIntakeDraft, 'product' | 'use' | 'priorities'> | null | undefined
  question?: string
}

export function SoundGuidance({ project, question = '' }: Props) {
  const id = useId()
  if (!isSoundProject(project, question)) return null

  return (
    <section className="pw-card pw-spaced" aria-labelledby={id}>
      <h2 id={id}>What kind of quieter?</h2>
      <p>Choose the job first. Different sound problems need different checks.</p>
      <ul>
        <li>
          <strong>Less echo inside a room:</strong> a possible check is the sound absorption
          coefficient at the relevant frequencies.
        </li>
        <li>
          <strong>Less airborne sound through a wall:</strong> a possible check is the sound
          transmission loss of the stated wall-and-sheet assembly at the relevant frequencies.
        </li>
        <li>
          <strong>Less impact noise, such as footsteps:</strong> this needs a different impact-sound
          test for the installed floor or floor-and-ceiling assembly.
        </li>
      </ul>
      <p>
        Note the frequencies or types of noise that matter, and how the product would be mounted or
        installed. You can sketch and plan at home; the appropriate measurements need suitable
        equipment and a stated test setup. These are possible checks, not results or proof that a
        product works.
      </p>
      <p>
        <a
          href="https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nbsir75-938.pdf"
          target="_blank"
          rel="noopener noreferrer"
        >
          Background: NIST overview of acoustic measurements (1977)
        </a>
      </p>
    </section>
  )
}
