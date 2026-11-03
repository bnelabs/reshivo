import { useEffect, useId, useRef, useState } from 'react'
import {
  clearProviderSettings,
  draftForProvider,
  getProviderSettings,
  providerSettingsError,
  saveProviderSettings,
  selectProviderSettings,
} from '../providerSettings'
import type {
  ProviderCapabilities,
  ProviderDraft,
  ProviderId,
  ProviderProtocol,
  ProviderSettings as Settings,
  ProviderSettingsResponse,
  StructuredOutputMode,
} from '../providerSettings'
import './ProviderSettings.css'

export type ProviderSettingsProps = {
  open: boolean
  onClose: () => void
  onSaved?: () => void
}

type PendingAction = 'save' | 'select' | 'clear' | null

const protocolLabels: Record<ProviderProtocol, string> = {
  chat_completions: 'Chat completions',
  google_generate_content: 'Google generateContent',
  anthropic_messages: 'Native Messages',
}

export function ProviderSettings({ open, onClose, onSaved }: ProviderSettingsProps) {
  const titleId = useId()
  const descriptionId = useId()
  const modelId = useId()
  const keyHelpId = useId()
  const dialog = useRef<HTMLDialogElement | null>(null)
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const request = useRef<AbortController | null>(null)
  const openRef = useRef(open)
  const closeRef = useRef(onClose)
  const savedRef = useRef(onSaved)
  openRef.current = open
  closeRef.current = onClose
  savedRef.current = onSaved

  const [data, setData] = useState<ProviderSettingsResponse | null>(null)
  const [draft, setDraft] = useState<ProviderDraft | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<PendingAction>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmRemoval, setConfirmRemoval] = useState<'current' | 'all' | null>(null)

  function applySettings(settings: Settings, catalog = data?.catalog) {
    if (!catalog) return
    setData({ catalog, settings })
    setDraft(draftForProvider(settings.active_provider, catalog, settings))
    setApiKey('')
    setConfirmRemoval(null)
  }

  async function load() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const next = await getProviderSettings(controller.signal)
      if (controller.signal.aborted || request.current !== controller || !openRef.current) return
      applySettings(next.settings, next.catalog)
    } catch (failure) {
      if (!controller.signal.aborted && request.current === controller && openRef.current)
        setError(providerSettingsError(failure))
    } finally {
      if (!controller.signal.aborted && request.current === controller && openRef.current) {
        request.current = null
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!open) {
      setApiKey('')
      setData(null)
      setDraft(null)
      setError('')
      setNotice('')
      setAction(null)
      setConfirmRemoval(null)
      return
    }
    const element = dialog.current
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    closeButton.current?.focus({ preventScroll: true })
    void load()
    return () => {
      request.current?.abort()
      request.current = null
      if (element?.open) element.close()
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [open])

  function dismiss() {
    request.current?.abort()
    request.current = null
    setApiKey('')
    closeRef.current()
  }

  function choose(provider: ProviderId) {
    if (!data) return
    setDraft(draftForProvider(provider, data.catalog, data.settings))
    setApiKey('')
    setError('')
    setNotice('')
    setConfirmRemoval(null)
  }

  function changeCapability<K extends keyof ProviderCapabilities>(
    key: K,
    value: ProviderCapabilities[K],
  ) {
    setDraft((current) =>
      current ? { ...current, capabilities: { ...current.capabilities, [key]: value } } : current,
    )
  }

  function changeProtocol(protocol: ProviderProtocol) {
    setDraft((current) => {
      if (!current) return current
      const mode = current.capabilities.structured_output
      return {
        ...current,
        protocol,
        workspace_id: protocol === 'anthropic_messages' ? current.workspace_id : '',
        capabilities: {
          ...current.capabilities,
          structured_output:
            protocol !== 'chat_completions' && mode === 'json_object' ? 'none' : mode,
        },
      }
    })
  }

  async function mutate(
    kind: Exclude<PendingAction, null>,
    run: (signal: AbortSignal) => Promise<Settings>,
  ) {
    if (action) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setAction(kind)
    setError('')
    setNotice('')
    try {
      const settings = await run(controller.signal)
      if (controller.signal.aborted || request.current !== controller || !openRef.current) return
      if (data) {
        applySettings(settings)
      } else {
        const next = await getProviderSettings(controller.signal)
        if (controller.signal.aborted || request.current !== controller || !openRef.current) return
        applySettings(next.settings, next.catalog)
      }
      setNotice(
        kind === 'clear'
          ? `Saved connections updated. ${settings.provider_name} is now selected. Your original Meta setup is unchanged.`
          : `${settings.provider_name} is selected for your next AI request. No AI request was made.`,
      )
      savedRef.current?.()
    } catch (failure) {
      if (!controller.signal.aborted && request.current === controller && openRef.current)
        setError(providerSettingsError(failure))
    } finally {
      if (!controller.signal.aborted && request.current === controller && openRef.current) {
        request.current = null
        setAction(null)
        setLoading(false)
      }
    }
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft) return
    void mutate('save', (signal) => saveProviderSettings({ ...draft, api_key: apiKey }, signal))
  }

  if (!open) return null

  const selected = data?.catalog.find((entry) => entry.id === draft?.provider)
  const savedProfile = data?.settings.profiles.find(
    (profile) => profile.provider === draft?.provider,
  )
  const active = data?.settings
  const savedProfiles =
    data?.settings.profiles.filter((profile) => profile.source === 'saved') ?? []
  const sameEndpoint = Boolean(
    savedProfile && draft?.base_url.replace(/\/+$/, '') === savedProfile.base_url,
  )
  const canKeepKey = Boolean(savedProfile?.key_configured && sameEndpoint)
  const disabled = loading || action !== null
  const modes: StructuredOutputMode[] =
    draft?.protocol !== 'chat_completions'
      ? ['none', 'json_schema']
      : draft?.provider === 'deepseek'
        ? ['none', 'json_object']
        : ['none', 'json_schema', 'json_object']

  return (
    <dialog
      ref={dialog}
      className="provider-settings"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault()
        dismiss()
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          dismiss()
      }}
    >
      <header className="provider-settings-header">
        <div>
          <h2 id={titleId}>AI connection</h2>
          <p id={descriptionId}>
            Choose the service that helps you plan your product and next trial.
          </p>
        </div>
        <button
          ref={closeButton}
          className="provider-settings-close"
          type="button"
          onClick={dismiss}
          aria-label="Close AI connection settings"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      {loading ? (
        <p className="provider-settings-loading" role="status">
          Loading your saved connections…
        </p>
      ) : null}

      {!loading && !data ? (
        <div className="provider-settings-load-error">
          <p className="provider-settings-error" role="alert">
            {error}
          </p>
          <button
            type="button"
            className="provider-settings-secondary"
            onClick={() => void load()}
            disabled={action !== null}
          >
            Try again
          </button>
          <details className="provider-settings-removal">
            <summary>Reset saved connections</summary>
            <p>
              If saved settings cannot be opened, you can remove them and return to your original
              Meta setup. Saved keys will need to be entered again.
            </p>
            {confirmRemoval === 'all' ? (
              <div className="provider-settings-confirm">
                <p>Remove all saved AI connections from this computer?</p>
                <button
                  type="button"
                  className="provider-settings-danger"
                  disabled={action !== null}
                  onClick={() =>
                    void mutate('clear', (signal) => clearProviderSettings(undefined, signal))
                  }
                >
                  Remove all saved connections
                </button>
                <button
                  type="button"
                  className="provider-settings-secondary"
                  onClick={() => setConfirmRemoval(null)}
                  disabled={action !== null}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="provider-settings-text-button"
                onClick={() => setConfirmRemoval('all')}
              >
                Reset saved connections
              </button>
            )}
          </details>
        </div>
      ) : null}

      {data && draft && selected && active ? (
        <div className="provider-settings-layout">
          <aside className="provider-settings-saved" aria-label="Saved AI connections">
            <h3>Currently selected</h3>
            <strong>{active.provider_name}</strong>
            <p className="provider-settings-active-model">{active.model || 'Model not set'}</p>
            <p>
              {active.configured
                ? 'Connection details saved. Access is checked when you ask for help.'
                : 'Add the missing connection details to use AI help.'}
            </p>
            <h3>Your connections</h3>
            <ul>
              {data.settings.profiles.map((profile) => (
                <li
                  key={profile.provider}
                  className={profile.provider === draft.provider ? 'is-editing' : undefined}
                >
                  <button
                    type="button"
                    className="provider-settings-profile"
                    onClick={() => choose(profile.provider)}
                    disabled={disabled}
                    aria-label={`Edit ${profile.provider_name} connection`}
                  >
                    <span>{profile.provider_name}</span>
                    <small>
                      {profile.provider === active.provider
                        ? 'Selected'
                        : profile.configured
                          ? 'Saved'
                          : 'Needs setup'}
                    </small>
                  </button>
                  {profile.provider !== active.provider ? (
                    <button
                      type="button"
                      className="provider-settings-use"
                      disabled={disabled || !profile.configured}
                      onClick={() =>
                        void mutate('select', (signal) =>
                          selectProviderSettings(profile.provider, signal),
                        )
                      }
                      aria-label={`Use saved ${profile.provider_name} connection`}
                    >
                      Use
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="provider-settings-private">
              Keys stay in a private settings file on this computer. They are never included in your
              project downloads.
            </p>
          </aside>

          <form className="provider-settings-form" onSubmit={save} autoComplete="off">
            <fieldset disabled={disabled}>
              <legend className="provider-settings-sr-only">Connection details</legend>
              <label className="provider-settings-field">
                <span>AI service</span>
                <select
                  value={draft.provider}
                  onChange={(event) => choose(event.target.value as ProviderId)}
                >
                  {data.catalog.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="provider-settings-field" htmlFor={modelId}>
                <span>Model</span>
                <input
                  id={modelId}
                  value={draft.model}
                  maxLength={200}
                  required
                  spellCheck={false}
                  autoCapitalize="none"
                  placeholder="Exact model ID from your service"
                  onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                />
                <small>
                  Use a model available in your account.{' '}
                  {selected.details_url ? (
                    <a href={selected.details_url} target="_blank" rel="noopener noreferrer">
                      Open {selected.name} documentation ↗
                    </a>
                  ) : (
                    'Check the documentation for your endpoint.'
                  )}
                </small>
                {draft.provider === 'meta' && ['muse-spark-1.3-contributor', 'muse-spark-1.2-contributor'].includes(draft.model) && (
                  <small>
                    Contributor mode lets Meta use submitted content to train future models.{' '}
                    <a href="https://dev.meta.ai/docs/pricing-rate-limits" target="_blank" rel="noopener noreferrer">Meta details ↗</a>
                  </small>
                )}
              </label>

              <label className="provider-settings-field">
                <span>{canKeepKey ? 'Replace API key' : 'API key'}</span>
                <input
                  type="password"
                  name="rematter-provider-key"
                  value={apiKey}
                  maxLength={4096}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-describedby={keyHelpId}
                  placeholder={
                    canKeepKey
                      ? 'Leave blank to keep your saved key'
                      : 'Paste a key from this service'
                  }
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <small id={keyHelpId}>
                  {canKeepKey
                    ? 'A blank field keeps the key saved for this service and address.'
                    : savedProfile?.key_configured && !sameEndpoint
                      ? 'The address changed. Enter a key for the new address; your old key will not be reused.'
                      : draft.provider === 'custom'
                        ? 'A local service can work without a key. Remote services require one.'
                        : 'The key is stored locally after you save. It is never shown again here.'}
                </small>
              </label>

              <details
                className="provider-settings-details"
                open={draft.provider === 'custom' || undefined}
              >
                <summary>Connection details</summary>
                <div>
                  <label className="provider-settings-field">
                    <span>API base URL</span>
                    <input
                      type="url"
                      value={draft.base_url}
                      required
                      maxLength={512}
                      spellCheck={false}
                      autoCapitalize="none"
                      placeholder="https://your-service.example/v1"
                      onChange={(event) => setDraft({ ...draft, base_url: event.target.value })}
                    />
                    <small>
                      Use the base address, without the final method path. Changing it requires a
                      new key.
                    </small>
                  </label>
                  {draft.provider === 'custom' ? (
                    <label className="provider-settings-field">
                      <span>API format</span>
                      <select
                        value={draft.protocol}
                        onChange={(event) => changeProtocol(event.target.value as ProviderProtocol)}
                      >
                        {Object.entries(protocolLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <small>Choose the format implemented by your service.</small>
                    </label>
                  ) : (
                    <p className="provider-settings-protocol">
                      Request format: {protocolLabels[draft.protocol]}
                    </p>
                  )}
                  {draft.protocol === 'anthropic_messages' ? (
                    <label className="provider-settings-field">
                      <span>
                        Workspace ID <small>optional</small>
                      </span>
                      <input
                        value={draft.workspace_id}
                        maxLength={128}
                        spellCheck={false}
                        placeholder="wrkspc_…"
                        onChange={(event) =>
                          setDraft({ ...draft, workspace_id: event.target.value })
                        }
                      />
                      <small>Needed only if your key is not already tied to a workspace.</small>
                    </label>
                  ) : null}
                </div>
              </details>

              <details className="provider-settings-details">
                <summary>Model features</summary>
                <div>
                  <p>
                    These features vary by model. Turn on only what your model’s documentation
                    supports.
                  </p>
                  <label className="provider-settings-field">
                    <span>Structured replies</span>
                    <select
                      value={draft.capabilities.structured_output}
                      onChange={(event) =>
                        changeCapability(
                          'structured_output',
                          event.target.value as StructuredOutputMode,
                        )
                      }
                    >
                      {modes.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode === 'none'
                            ? 'Off'
                            : mode === 'json_schema'
                              ? 'JSON schema'
                              : 'JSON object'}
                        </option>
                      ))}
                    </select>
                    <small>
                      Required for project guidance. Choose the JSON format your model supports; the
                      app also checks the returned fields.
                    </small>
                  </label>
                  <label className="provider-settings-check">
                    <input
                      type="checkbox"
                      checked={draft.capabilities.tool_calls}
                      onChange={(event) => changeCapability('tool_calls', event.target.checked)}
                    />
                    <span>
                      Use ReMatter’s calculation tools
                      <small>
                        Requires function calling. The model can ask the app to run its available
                        calculations.
                      </small>
                    </span>
                  </label>
                  <label className="provider-settings-check">
                    <input
                      type="checkbox"
                      checked={draft.capabilities.vision}
                      onChange={(event) => changeCapability('vision', event.target.checked)}
                    />
                    <span>
                      Read photos
                      <small>Requires a model that accepts images.</small>
                    </span>
                  </label>
                  {selected.capabilities.reasoning !== 'unsupported' ? (
                    <label className="provider-settings-check">
                      <input
                        type="checkbox"
                        checked={draft.capabilities.reasoning}
                        onChange={(event) => changeCapability('reasoning', event.target.checked)}
                      />
                      <span>
                        Adjust thinking effort
                        <small>
                          Enable only if the model supports this connection’s low, medium and high
                          reasoning control.
                        </small>
                      </span>
                    </label>
                  ) : (
                    <p className="provider-settings-protocol">
                      Thinking-effort controls are not available for this connection.
                    </p>
                  )}
                </div>
              </details>

              {draft.capabilities.structured_output === 'none' ? (
                <p className="provider-settings-feature-note">
                  Project guidance is off until you choose a supported format under Model features →
                  Structured replies.
                </p>
              ) : null}

              {error ? (
                <p className="provider-settings-error" role="alert">
                  {error}
                </p>
              ) : null}
              {notice ? (
                <p className="provider-settings-notice" role="status">
                  {notice}
                </p>
              ) : null}

              <div className="provider-settings-save-row">
                <button type="submit" className="provider-settings-primary">
                  {action === 'save' ? 'Saving…' : 'Save and use'}
                </button>
                <p>
                  Saving stores your settings. This service is contacted only when you ask for AI
                  help.
                </p>
              </div>
            </fieldset>

            <details className="provider-settings-removal">
              <summary>Remove saved connections</summary>
              <p>
                Removing saved settings does not erase your original Meta setup. Removed keys must
                be entered again.
              </p>
              {confirmRemoval ? (
                <div className="provider-settings-confirm">
                  <p>
                    {confirmRemoval === 'all'
                      ? 'Remove all saved AI connections from this computer?'
                      : `Remove the saved ${active.provider_name} connection?`}
                  </p>
                  <button
                    type="button"
                    className="provider-settings-danger"
                    disabled={disabled}
                    onClick={() =>
                      void mutate('clear', (signal) =>
                        clearProviderSettings(
                          confirmRemoval === 'current' ? active.provider : undefined,
                          signal,
                        ),
                      )
                    }
                  >
                    {action === 'clear'
                      ? 'Removing…'
                      : confirmRemoval === 'all'
                        ? 'Remove all saved connections'
                        : 'Remove connection'}
                  </button>
                  <button
                    type="button"
                    className="provider-settings-secondary"
                    onClick={() => setConfirmRemoval(null)}
                    disabled={disabled}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="provider-settings-remove-actions">
                  <button
                    type="button"
                    className="provider-settings-text-button"
                    disabled={disabled || active.source !== 'saved'}
                    onClick={() => setConfirmRemoval('current')}
                  >
                    Remove selected connection
                  </button>
                  <button
                    type="button"
                    className="provider-settings-text-button"
                    disabled={disabled || savedProfiles.length === 0}
                    onClick={() => setConfirmRemoval('all')}
                  >
                    Remove all saved connections
                  </button>
                </div>
              )}
            </details>
          </form>
        </div>
      ) : null}
    </dialog>
  )
}
