import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  emptyProjectDraft, hasProjectContext, PROJECT_INTAKE_FIELDS, recentIntakeHistory,
  requestProjectIntake, reviewProjectDraft,
} from '../projectIntake'
import type { ProjectIntakeDraft, ProjectIntakeField, ProjectIntakeMessage, ProjectIntakeRecord, ProjectIntakeResult } from '../projectIntake'
import './PromptProjectStart.css'

export type PromptProjectStartProps = {
  initialDraft?: ProjectIntakeDraft
  initialDiscussion?: string
  onApply: (draft: ProjectIntakeDraft, guidance?: ProjectIntakeResult, discussion?: string) => void
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

export function PromptProjectStart({ initialDraft, initialDiscussion, onApply, onManualEntry, providerStatus, onConfigureProvider }: PromptProjectStartProps) {
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
  const [suggestions, setSuggestions] = useState<Partial<Record<ProjectIntakeField, ProjectIntakeRecord>>>({})
  const [submittedDiscussion, setSubmittedDiscussion] = useState(initialDiscussion ?? '')
  const [showEssentialInputs, setShowEssentialInputs] = useState(initialDraft ? !hasProjectContext(initialDraft) : false)
  const localGuidance = result?.origin === 'local' || result?.guidance_origin === 'local'
  const activeRequest = useRef<AbortController | null>(null)
  const ideaInput = useRef<HTMLTextAreaElement | null>(null)
  const summaryHeading = useRef<HTMLHeadingElement | null>(null)
  const hasDraft = result !== null || PROJECT_INTAKE_FIELDS.some((field) => draft[field] !== null)
  const pendingAnswers = answers.some((answer) => answer.trim()) || Boolean(followup.trim())
  const hasSuggestions = Object.keys(suggestions).length > 0
  const guidanceCurrent = result && !Object.keys(result.suggested_changes ?? {}).length && PROJECT_INTAKE_FIELDS.every((field) => (draft[field]?.value ?? '') === (result.project_draft[field]?.value ?? ''))
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
    const syntheticReview = message === 'I have reviewed and edited the project summary. Please use these details and suggest the next useful step.'
    const nextDiscussion = syntheticReview ? submittedDiscussion : [submittedDiscussion, `${hasDraft ? 'Additional project details' : 'Initial idea'}:\n${message}`].filter(Boolean).join('\n\n')
    if (nextDiscussion.length > 20000) {
      setError('Your project discussion is full. Your unsent text is still here. Shorten it to fit, or clear it and continue with your saved details.')
      return
    }
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
      setSuggestions(next.suggested_changes ?? {})
      setSubmittedDiscussion(nextDiscussion)
      if (!hasProjectContext(next.project_draft)) setShowEssentialInputs(true)
      setDraft(next.project_draft)
      setHistory([...recent, { role: 'user', content: message }, { role: 'assistant', content: historyReply(next) }])
      setAnswers([])
      setFollowup('')
      setSummaryEdited(false)
      return { result: next, discussion: nextDiscussion }
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

  function answerMessage() {
    const answered = answers.map((answer, index) => answer.trim() ? `Question: ${result?.questions[index] ?? ''}\nAnswer: ${answer.trim()}` : '').filter(Boolean)
    return [answered.join('\n\n'), followup.trim() ? `Additional details: ${followup.trim()}` : ''].filter(Boolean).join('\n\n')
  }

  function submitAnswers(event: FormEvent) {
    event.preventDefault()
    void send(answerMessage() || (summaryEdited ? 'I have reviewed and edited the project summary. Please use these details and suggest the next useful step.' : ''))
  }

  async function applyDraft() {
    if (busy || hasSuggestions || !hasProjectContext(draft)) return
    if (pendingAnswers) {
      const message = answerMessage()
      const sent = await send(message)
      if (!sent || Object.keys(sent.result.suggested_changes ?? {}).length || !hasProjectContext(sent.result.project_draft)) return
      onApply(reviewProjectDraft(sent.result.project_draft), sent.result, sent.discussion)
      return
    }
    onApply(reviewProjectDraft(draft), guidanceCurrent ? result ?? undefined : undefined, submittedDiscussion || undefined)
  }

  function resolveSuggestion(field: ProjectIntakeField, accept: boolean) {
    const proposed = suggestions[field]
    if (accept && proposed) {
      setDraft((current) => ({ ...current, [field]: { ...proposed, source: 'user_review' } }))
      setSummaryEdited(true)
    }
    setSuggestions((current) => { const next = { ...current }; delete next[field]; return next })
  }

  const draftField = (field: ProjectIntakeField, suffix = '') => <label className="prompt-project-field" key={`${field}${suffix}`} htmlFor={`${id}-${field}${suffix}`}>
    <span>{FIELD_LABELS[field]}{suffix ? field === 'product' || field === 'input' ? ' (required)' : ' (one of these two is required)' : ''}</span>
    <textarea id={`${id}-${field}${suffix}`} rows={field === 'input' || field === 'priorities' ? 2 : 1}
      value={draft[field]?.value ?? ''} maxLength={1000} disabled={busy}
      placeholder="Still unknown — add if you know" onChange={(event) => editField(field, event.target.value)} />
  </label>

  return <section className={`prompt-project ${hasDraft ? 'prompt-project--review' : 'prompt-project--start'}`} aria-labelledby={`${id}-heading`}>
    {!hasDraft ? <>
      <div className="prompt-project-intro">
        <h1 id={`${id}-heading`}>Tell me what you want to make</h1>
        <p>Start with what you have and what you want to make. You’ll get ideas to explore, useful next checks, and a report you can save. Add measurements and costs if you have them.</p>
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
          {result && guidanceCurrent && hasProjectContext(draft) ? <p className="prompt-project-reply">{result.reply}</p> : <p>{hasProjectContext(draft) ? 'Review your project details, then continue to get ideas for your materials.' : 'Add the essentials so we can help with your project.'}</p>}
          {showEssentialInputs || !hasProjectContext(draft) ? <div className="prompt-project-first-step"><h2>First, tell us the basics</h2>
            <p>We need a product, the materials you have, and either where it will be used or what it should do. You can keep other details unknown.</p>
            {draftField('product', '-essential')}{draftField('input', '-essential')}{draftField('use', '-essential')}{draftField('priorities', '-essential')}
          </div> : null}
          {hasSuggestions ? <div className="prompt-project-first-step" aria-live="polite"><h2>Review your project updates</h2>
            <p>You mentioned a change. Choose which detail to use before continuing.</p>
            {PROJECT_INTAKE_FIELDS.map((field) => suggestions[field] ? <div key={field}>
              <strong>{FIELD_LABELS[field]}</strong><p>Current: {draft[field]?.value || 'Not recorded'}</p><p>Suggested: {suggestions[field]?.value}</p>
              <div className="prompt-project-action-row"><button type="button" className="prompt-project-secondary" onClick={() => resolveSuggestion(field, true)}>Use this update</button>
                <button type="button" className="prompt-project-text-button" onClick={() => resolveSuggestion(field, false)}>Keep current detail</button></div>
            </div> : null)}</div> : null}
          {hasProjectContext(draft) ? <div className="prompt-project-action-row"><button type="button" className="prompt-project-primary" onClick={() => void applyDraft()} disabled={busy || hasSuggestions}>{pendingAnswers ? 'Send answers and continue' : 'Continue to ideas'}</button></div> : null}
          <p className="prompt-project-hint">{hasSuggestions ? 'Review the project updates above to continue.' : !hasProjectContext(draft) ? 'Add a product and materials, plus a use or goal in Your project.' : pendingAnswers ? 'Your answers will be sent and included before you continue.' : 'Questions are optional. Review your project, then continue when ready.'}</p>
          {hasProjectContext(draft) || pendingAnswers ? <form onSubmit={submitAnswers}>
            {(guidanceCurrent || answers.some((answer) => answer.trim())) && result?.questions.length ? <div className="prompt-project-questions"><h2>{result.questions.length === 1 ? 'One thing to clarify' : `${result.questions.length === 2 ? 'Two' : 'Three'} things to clarify`}</h2>
              {result.questions.map((question, index) => <label key={`${index}-${question}`} htmlFor={`${id}-answer-${index}`}>
                <span>{index + 1}. {question}</span>
                <textarea id={`${id}-answer-${index}`} rows={3} maxLength={600} value={answers[index] ?? ''} disabled={busy}
                  placeholder="Answer in your own words; it’s fine if you don’t know yet."
                  onChange={(event) => setAnswers((current) => Array.from({ length: result.questions.length }, (_, at) => at === index ? event.target.value : current[at] ?? ''))} />
                <button type="button" className="prompt-project-text-button" disabled={busy} onClick={() => setAnswers((current) => Array.from({ length: result.questions.length }, (_, at) => at === index ? "I don't know yet." : current[at] ?? ''))}>I don't know yet</button>
              </label>)}</div> : null}
            <label className="prompt-project-more" htmlFor={`${id}-followup`}><span>{result?.questions.length ? 'Anything else to add? (optional)' : 'Add details or ask a question'}</span>
              <textarea id={`${id}-followup`} rows={2} maxLength={500} value={followup} disabled={busy} onChange={(event) => setFollowup(event.target.value)} /></label>
            <div className="prompt-project-action-row"><button type="submit" className="prompt-project-secondary" disabled={busy || hasSuggestions || (!pendingAnswers && !summaryEdited)}>{busy ? 'Updating project…' : 'Send details'}</button>
              {!busy && <button type="button" className="prompt-project-text-button" onClick={() => { summaryHeading.current?.scrollIntoView({ block: 'start' }); summaryHeading.current?.focus({ preventScroll: true }) }}>Review your project</button>}
              {busy ? <button type="button" className="prompt-project-text-button" onClick={stopRequest}>Stop</button> : null}</div>
            <p className="prompt-project-hint">{pendingAnswers ? 'Send your answers now, or choose Send answers and continue.' : 'These questions are optional.'}</p>
          </form> : null}
          {hasProjectContext(draft) && result && guidanceCurrent ? <div className="prompt-project-first-step"><h2>A useful first step</h2><p>{result.first_step}</p></div> : null}
          {history.length ? <details className="prompt-project-history"><summary>Earlier discussion</summary>{localGuidance && <p>Earlier AI replies are hidden for this planning case.</p>}{history.filter((entry) => !localGuidance || entry.role === 'user').map((entry, index) => <div key={index}><strong>{entry.role === 'user' ? 'You' : 'Planning reply'}</strong><p>{entry.content}</p></div>)}</details> : null}
        </div>
        {hasProjectContext(draft) ? <aside className="prompt-project-summary" aria-labelledby={`${id}-summary`}>
          <h2 ref={summaryHeading} tabIndex={-1} id={`${id}-summary`}>Your project</h2><p>Review and edit these details before continuing.</p>
          {SUMMARY_FIELDS.map((field) => draftField(field))}
          {unknowns.length ? <p className="prompt-project-unknowns">Still unknown: {unknowns.map((field) => FIELD_LABELS[field].toLowerCase()).join(', ')}.</p> : null}
          <details className="prompt-project-other"><summary>Other details</summary>{OTHER_FIELDS.map((field) => draftField(field))}</details>
          {hasProjectContext(draft) ? <button type="button" className="prompt-project-primary" onClick={() => void applyDraft()} disabled={busy || hasSuggestions}>{pendingAnswers ? 'Send answers and continue' : 'Continue to ideas'}</button> : null}
          <p className="prompt-project-hint">{hasSuggestions ? 'Review the project updates before continuing.' : pendingAnswers ? 'Your answers will be sent before you continue.' : !hasProjectContext(draft) ? 'Add a product and materials, plus a use or goal. Other details can stay unknown.' : 'Continue when these details match what you mean.'}</p>
          <details className="prompt-project-sources"><summary>Where these details came from</summary>{PROJECT_INTAKE_FIELDS.map((field) => draft[field] ? <div key={field}><strong>{FIELD_LABELS[field]} · {draft[field]?.source === 'user_review' ? 'Your review or edit' : 'Your message'}</strong><blockquote>{draft[field]?.quote}</blockquote></div> : null)}</details>
        </aside> : null}
      </div>
    </>}
    <div className="prompt-project-feedback" aria-live="polite" aria-atomic="true">
      {error ? <p role="alert" className="prompt-project-error">{error}</p> : null}
      {notice ? <p>{notice}</p> : null}
      {providerStatus?.configured === false ? <p>To get AI suggestions, connect an AI provider. You can also enter your project details yourself. <button type="button" className="prompt-project-text-button" onClick={onConfigureProvider}>Choose a provider</button></p> : null}
      {result ? <p className="prompt-project-generation">{result.origin === 'local' ? 'Local planning guide · no AI call' : result.guidance_origin === 'local' ? `Local next step · project draft by ${result.provider} / ${result.model}` : result.live ? `Generated · ${result.provider} · ${result.model}` : `Saved or offline reply · ${result.provider} · ${result.model}`}</p> : null}
    </div>
  </section>
}
