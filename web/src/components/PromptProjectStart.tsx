import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  emptyProjectDraft, hasProjectContext, PROJECT_INTAKE_FIELDS, recentIntakeHistory,
  requestProjectIntake, reviewProjectDraft,
} from '../projectIntake'
import type { ProjectIntakeDraft, ProjectIntakeField, ProjectIntakeMessage, ProjectIntakeResult } from '../projectIntake'
import './PromptProjectStart.css'

export type PromptProjectStartProps = {
  initialDraft?: ProjectIntakeDraft
  onApply: (draft: ProjectIntakeDraft) => void
  onManualEntry: () => void
  providerStatus?: { configured: boolean; provider_name: string; model: string }
  onConfigureProvider: () => void
}

const FIELD_LABELS: Record<ProjectIntakeField, string> = {
  product: 'Product', input: 'Materials', use: 'Where / how it’s used', priorities: 'What matters',
  variation: 'What changes between inputs', process: 'Tools and process', constraints: 'Other constraints',
}
const SUMMARY_FIELDS: ProjectIntakeField[] = ['product', 'input', 'use', 'priorities']
const OTHER_FIELDS: ProjectIntakeField[] = ['variation', 'process', 'constraints']
const EXAMPLES = [
  { label: 'A floor mat', text: 'I have recycled rubber pieces and want to make a floor mat. Can you help me plan it?' },
  { label: 'A sound sheet', text: 'I have fabric offcuts and want to make a sound insulation sheet. Can you help me work out what to try?' },
]

function historyReply(result: ProjectIntakeResult): string {
  return [result.reply, `A useful first step: ${result.first_step}`, ...result.questions.map((question, index) => `${index + 1}. ${question}`)].join('\n')
}

export function PromptProjectStart({ initialDraft, onApply, onManualEntry, providerStatus, onConfigureProvider }: PromptProjectStartProps) {
  const id = useId()
  const [draft, setDraft] = useState<ProjectIntakeDraft>(() => initialDraft ? reviewProjectDraft(initialDraft) : emptyProjectDraft())
  const [result, setResult] = useState<ProjectIntakeResult | null>(null)
  const [idea, setIdea] = useState('')
  const [followup, setFollowup] = useState('')
  const [answers, setAnswers] = useState<string[]>([])
  const [history, setHistory] = useState<ProjectIntakeMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [summaryEdited, setSummaryEdited] = useState(false)
  const activeRequest = useRef<AbortController | null>(null)
  const ideaInput = useRef<HTMLTextAreaElement | null>(null)
  const hasDraft = result !== null || PROJECT_INTAKE_FIELDS.some((field) => draft[field] !== null)
  const pendingAnswers = answers.some((answer) => answer.trim()) || Boolean(followup.trim())
  const unknowns = PROJECT_INTAKE_FIELDS.filter((field) => draft[field] === null)

  useEffect(() => () => activeRequest.current?.abort(), [])

  function editField(field: ProjectIntakeField, value: string) {
    setDraft((current) => ({ ...current, [field]: value.trim() ? { value, source: 'user_review', quote: value } : null }))
    setSummaryEdited(true)
  }

  function stopRequest() {
    activeRequest.current?.abort()
    activeRequest.current = null
    setBusy(false)
    setNotice('Stopped. Your idea, answers and project details are still here.')
  }

  async function send(message: string) {
    if (activeRequest.current || !message.trim()) return
    const controller = new AbortController()
    activeRequest.current = controller
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const recent = recentIntakeHistory(history, message)
      const next = await requestProjectIntake({ message, history: recent,
        ...(hasDraft ? { reviewed_draft: reviewProjectDraft(draft) } : {}) }, controller.signal)
      if (controller.signal.aborted || activeRequest.current !== controller) return
      setResult(next)
      setDraft(next.project_draft)
      setHistory([...recent, { role: 'user', content: message }, { role: 'assistant', content: historyReply(next) }])
      setAnswers([])
      setFollowup('')
      setSummaryEdited(false)
    } catch (failure) {
      if (controller.signal.aborted || activeRequest.current !== controller) return
      setError(failure instanceof Error ? failure.message : 'The request failed. Your idea and current details are still here.')
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null
        setBusy(false)
      }
    }
  }

  function submitIdea(event: FormEvent) {
    event.preventDefault()
    void send(idea)
  }

  function submitAnswers(event: FormEvent) {
    event.preventDefault()
    const answered = answers.map((answer, index) => answer.trim() ? `${index + 1}. ${answer}` : '').filter(Boolean)
    const message = [answered.length ? `Answers to your latest questions:\n${answered.join('\n')}` : '', followup].filter((part) => part.trim()).join('\n\n')
    void send(message || (summaryEdited ? 'I have reviewed and edited the project summary. Please use these details and suggest the next useful step.' : ''))
  }

  function applyDraft() {
    if (busy || pendingAnswers || !hasProjectContext(draft)) return
    onApply(reviewProjectDraft(draft))
  }

  const draftField = (field: ProjectIntakeField) => <label className="prompt-project-field" key={field} htmlFor={`${id}-${field}`}>
    <span>{FIELD_LABELS[field]}</span>
    <textarea id={`${id}-${field}`} rows={field === 'input' || field === 'priorities' ? 2 : 1}
      value={draft[field]?.value ?? ''} maxLength={1000} disabled={busy}
      placeholder="Still unknown — add if you know" onChange={(event) => editField(field, event.target.value)} />
  </label>

  return <section className={`prompt-project ${hasDraft ? 'prompt-project--review' : 'prompt-project--start'}`} aria-labelledby={`${id}-heading`}>
    {!hasDraft ? <>
      <div className="prompt-project-intro">
        <h1 id={`${id}-heading`}>Tell me what you want to make</h1>
        <p>Start with the materials you have and a product idea. We’ll help you work out what to try.</p>
      </div>
      <form className="prompt-project-idea" onSubmit={submitIdea}>
        <label htmlFor={`${id}-idea`}>Your idea</label>
        <textarea ref={ideaInput} id={`${id}-idea`} value={idea} maxLength={3000} rows={5} disabled={busy}
          placeholder={EXAMPLES[0].text} onChange={(event) => setIdea(event.target.value)} />
        <div className="prompt-project-action-row">
          <button className="prompt-project-primary" type="submit" disabled={busy || !idea.trim()}>{busy ? 'Working on your idea…' : <>Help me plan <span aria-hidden="true">→</span></>}</button>
          {busy ? <button className="prompt-project-text-button" type="button" onClick={stopRequest}>Stop</button> : null}
        </div>
      </form>
      <div className="prompt-project-examples"><span>Try an idea</span>{EXAMPLES.map((example) => <button key={example.label} type="button" disabled={busy}
        onClick={() => { setIdea(example.text); ideaInput.current?.focus() }}>{example.label}</button>)}</div>
      <div className="prompt-project-manual"><button type="button" className="prompt-project-text-button" onClick={onManualEntry} disabled={busy}>Enter details myself</button>
        <p>You’ll review the project details before using them.</p></div>
    </> : <>
      <h1 id={`${id}-heading`}>{result ? 'Let’s shape your project' : 'Review your project'}</h1>
      <div className="prompt-project-review-layout">
        <div className="prompt-project-conversation">
          {result ? <p className="prompt-project-reply">{result.reply}</p> : <p>These are your retained project details. Edit anything that has changed, or ask for help with your next step.</p>}
          <form onSubmit={submitAnswers}>
            {result?.questions.length ? <div className="prompt-project-questions"><h2>{result.questions.length === 1 ? 'One thing to clarify' : `${result.questions.length === 2 ? 'Two' : 'Three'} things to clarify`}</h2>
              {result.questions.map((question, index) => <label key={`${index}-${question}`} htmlFor={`${id}-answer-${index}`}>
                <span>{index + 1}. {question}</span>
                <textarea id={`${id}-answer-${index}`} rows={3} maxLength={600} value={answers[index] ?? ''} disabled={busy}
                  placeholder="Answer in your own words; it’s fine if you don’t know yet."
                  onChange={(event) => setAnswers((current) => Array.from({ length: result.questions.length }, (_, at) => at === index ? event.target.value : current[at] ?? ''))} />
              </label>)}</div> : null}
            <label className="prompt-project-more" htmlFor={`${id}-followup`}><span>{result?.questions.length ? 'Anything else to add? (optional)' : 'Add details or ask a question'}</span>
              <textarea id={`${id}-followup`} rows={2} maxLength={500} value={followup} disabled={busy} onChange={(event) => setFollowup(event.target.value)} /></label>
            <div className="prompt-project-action-row"><button type="submit" className="prompt-project-secondary" disabled={busy || (!pendingAnswers && !summaryEdited)}>{busy ? 'Updating project…' : 'Update project'}</button>
              {busy ? <button type="button" className="prompt-project-text-button" onClick={stopRequest}>Stop</button> : null}</div>
            <p className="prompt-project-hint">Review the summary before updating or using the project.</p>
          </form>
          {result ? <div className="prompt-project-first-step"><h2>A useful first step</h2><p>{result.first_step}</p></div> : null}
          {history.length ? <details className="prompt-project-history"><summary>Earlier discussion</summary>{result?.origin === 'local' && <p>Earlier AI replies are hidden for this planning case.</p>}{history.filter((entry) => result?.origin !== 'local' || entry.role === 'user').map((entry, index) => <div key={index}><strong>{entry.role === 'user' ? 'You' : 'Planning reply'}</strong><p>{entry.content}</p></div>)}</details> : null}
        </div>
        <aside className="prompt-project-summary" aria-labelledby={`${id}-summary`}>
          <h2 id={`${id}-summary`}>Your project</h2><p>Review and edit before using it.</p>
          {SUMMARY_FIELDS.map(draftField)}
          {unknowns.length ? <p className="prompt-project-unknowns">Still unknown: {unknowns.map((field) => FIELD_LABELS[field].toLowerCase()).join(', ')}.</p> : null}
          <details className="prompt-project-other"><summary>Other details</summary>{OTHER_FIELDS.map(draftField)}</details>
          <button type="button" className="prompt-project-primary" onClick={applyDraft} disabled={busy || pendingAnswers || !hasProjectContext(draft)}>Use this project</button>
          <p className="prompt-project-hint">{pendingAnswers ? 'Update the project to include your answers before continuing.' : !hasProjectContext(draft) ? 'Add a product and materials, plus a use or goal. Other details can stay unknown.' : 'Using this project confirms the details above match what you mean.'}</p>
          <p className="prompt-project-hint">This is a planning draft, not a tested recipe.</p>
          <details className="prompt-project-sources"><summary>Where these details came from</summary>{PROJECT_INTAKE_FIELDS.map((field) => draft[field] ? <div key={field}><strong>{FIELD_LABELS[field]} · {draft[field]?.source === 'user_review' ? 'Your review or edit' : 'Your message'}</strong><blockquote>{draft[field]?.quote}</blockquote></div> : null)}</details>
        </aside>
      </div>
    </>}
    <div className="prompt-project-feedback" aria-live="polite" aria-atomic="true">
      {error ? <p role="alert" className="prompt-project-error">{error}</p> : null}
      {notice ? <p>{notice}</p> : null}
      {providerStatus?.configured === false ? <p>Some planning requests need an AI provider. <button type="button" className="prompt-project-text-button" onClick={onConfigureProvider}>Choose a provider</button></p> : null}
      {result ? <p className="prompt-project-generation">{result.provider==='local'?'Local planning guide · no AI call':result.live?`Generated · ${result.provider} · ${result.model}`:`Saved or offline reply · ${result.provider} · ${result.model}`}</p> : null}
    </div>
  </section>
}
