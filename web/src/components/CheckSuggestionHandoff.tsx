import { useEffect, useId, useState } from 'react'
import './CheckSuggestionHandoff.css'

type Props = {
  /** A suggestion to review, not a measured property or an agreed method. */
  suggestion: string
  /** Opens an editable check draft; saving the check remains a separate user action. */
  onPrepare: (name: string) => void
}

/** Let a person translate an unstructured suggestion into their own check name. */
export function CheckSuggestionHandoff({ suggestion, onPrepare }: Props) {
  const id = useId()
  const [name, setName] = useState('')
  useEffect(() => setName(''), [suggestion])
  const proposedName = name.trim()
  if (!suggestion.trim()) return null

  return (
    <div className="pw-check-handoff">
      <p><strong>Suggested thing to check</strong></p>
      <p>{suggestion}</p>
      <label htmlFor={id}>
        What would you call this check?
        <input
          id={id}
          value={name}
          maxLength={160}
          onChange={(event) => setName(event.target.value)}
          placeholder="For example: wet grip, thickness or mass"
        />
      </label>
      <small>Choose your own name. The method, unit and targets stay blank until you enter them.</small>
      <button type="button" disabled={!proposedName} onClick={() => onPrepare(proposedName)}>
        Continue in checks
      </button>
    </div>
  )
}
