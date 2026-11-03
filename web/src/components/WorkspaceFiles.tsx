import { useEffect, useRef, useState } from 'react'
import { parseWorkspaceFile, serializeWorkspaceFile, WORKSPACE_MAX_BYTES } from '../workspaceFile'
import type { SavedWorkspace, WorkspaceSnapshot } from '../workspaceFile'

export function WorkspaceFiles({
  snapshot,
  onOpen,
}: {
  snapshot: () => WorkspaceSnapshot
  onOpen: (workspace: SavedWorkspace) => boolean
}) {
  const input = useRef<HTMLInputElement | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 6000)
    return () => window.clearTimeout(timer)
  }, [message])
  function save() {
    setMessage('')
    setError('')
    try {
      const text = serializeWorkspaceFile(snapshot())
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'reshivo-material-workspace.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage('Workspace file prepared for download. Keep it to reopen this work later.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The workspace could not be saved.')
    }
  }
  async function open(file: File) {
    setMessage('')
    setError('')
    try {
      if (file.size > WORKSPACE_MAX_BYTES)
        throw new Error('Choose a workspace file smaller than one megabyte.')
      const workspace = parseWorkspaceFile(await file.text())
      if (onOpen(workspace))
        setMessage('Workspace opened. Review the saved drafts and rerun their checks.')
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'The file could not be opened. Your current work is unchanged.',
      )
    }
  }
  return (
    <section className="workspace-files" aria-label="Save and open material workspace">
      <div>
        <strong>Keep working on this case</strong>
        <details>
          <summary>What the workspace file includes</summary>
          <p>
            Your case, advice, selected trial and material measurement/mix drafts. Reopened drafts
            need review and recalculation. Readings in other calculation tools are outside this
            file.
          </p>
        </details>
      </div>
      <div className="workspace-file-actions">
        <button type="button" className="outline-button" onClick={save}>
          Save workspace
        </button>
        <button type="button" className="outline-button" onClick={() => input.current?.click()}>
          Open workspace
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          aria-label="Open a saved material workspace file"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void open(file)
          }}
        />
      </div>
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="workshop-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
