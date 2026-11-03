import type { AdvisorFollowupResult } from '../types'

export function FollowupAdvice({
  result,
  question,
  restored,
}: {
  result: AdvisorFollowupResult
  question: string
  restored: boolean
}) {
  return (
    <section className="workshop-followup-answer" aria-label="Meta’s next step">
      <h2>Your next step</h2>
      {question && <p className="workshop-last-question">You asked: {question}</p>}
      {restored && (
        <p className="workshop-notice">
          Saved Meta advice · reopened from your workspace, not a new request.
        </p>
      )}
      {result.answer
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      {!!result.quarantined_answer?.length && (
        <p role="status">
          An unsupported claim about meeting your targets was removed. Check the proposed actions
          against your actual case.
        </p>
      )}
      <h3>What to do next</h3>
      <ol>
        {result.next_steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
      {result.questions.length > 0 && (
        <>
          <h3>Details still needed</h3>
          <ul>
            {result.questions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
        </>
      )}
      <footer>
        {restored ? 'Saved Meta response' : 'Meta response'} · {result.model}{result.guidance_adjusted ? ' · locally adapted for planning' : ''} ·{' '}
        {(result.elapsed_ms / 1000).toFixed(1)} s
      </footer>
      {result.sources.length > 0 && (
        <details>
          <summary>References used for context</summary>
          {result.sources.map((source) => (
            <p key={source.id}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.title}
              </a>{' '}
              — {source.scope}
            </p>
          ))}
        </details>
      )}
    </section>
  )
}
