export type ProviderId =
  'meta' | 'openrouter' | 'openai' | 'google' | 'anthropic' | 'nvidia' | 'deepseek' | 'custom'

export type ProviderProtocol = 'chat_completions' | 'google_generate_content' | 'anthropic_messages'

export type StructuredOutputMode = 'none' | 'json_object' | 'json_schema'

export type ProviderCapabilities = {
  vision: boolean
  tool_calls: boolean
  structured_output: StructuredOutputMode
  reasoning: boolean
}

export type ProviderCatalogEntry = {
  id: ProviderId
  name: string
  default_base_url: string
  default_model: string
  protocol: ProviderProtocol
  defaults: ProviderCapabilities
  capabilities: {
    vision: 'model_dependent'
    tool_calls: 'model_dependent'
    structured_output: StructuredOutputMode[]
    reasoning: 'model_dependent' | 'unsupported'
  }
  details_url: string
}

export type ProviderProfileStatus = {
  provider: ProviderId
  provider_name: string
  model: string
  base_url: string
  protocol: ProviderProtocol
  configured: boolean
  key_configured: boolean
  key_hint: string
  capabilities: ProviderCapabilities
  source: 'saved' | 'local_env'
  workspace_id?: string
}

export type ProviderSettings = ProviderProfileStatus & {
  active_provider: ProviderId
  profiles: ProviderProfileStatus[]
}

export type ProviderSettingsResponse = {
  catalog: ProviderCatalogEntry[]
  settings: ProviderSettings
}

export type ProviderDraft = {
  provider: ProviderId
  model: string
  base_url: string
  protocol: ProviderProtocol
  capabilities: ProviderCapabilities
  workspace_id: string
}

export type SaveProviderSettingsPayload = ProviderDraft & {
  api_key?: string
  clear_api_key?: boolean
}

const PROVIDERS = new Set<ProviderId>([
  'meta',
  'openrouter',
  'openai',
  'google',
  'anthropic',
  'nvidia',
  'deepseek',
  'custom',
])
const PROTOCOLS = new Set<ProviderProtocol>([
  'chat_completions',
  'google_generate_content',
  'anthropic_messages',
])
const MODES = new Set<StructuredOutputMode>(['none', 'json_object', 'json_schema'])
const MAX_RESPONSE_BYTES = 131_072
const MAX_REQUEST_BYTES = 32_768
const REQUEST_TIMEOUT_MS = 15_000

export class ProviderSettingsError extends Error {
  constructor(
    message: string,
    public readonly kind: 'http' | 'format' | 'network' | 'timeout' | 'aborted',
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ProviderSettingsError'
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit
}

function isProvider(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDERS.has(value as ProviderId)
}

function isProtocol(value: unknown): value is ProviderProtocol {
  return typeof value === 'string' && PROTOCOLS.has(value as ProviderProtocol)
}

function isMode(value: unknown): value is StructuredOutputMode {
  return typeof value === 'string' && MODES.has(value as StructuredOutputMode)
}

function isCapabilities(value: unknown): value is ProviderCapabilities {
  return (
    object(value) &&
    Object.keys(value).every((key) =>
      ['vision', 'tool_calls', 'structured_output', 'reasoning'].includes(key),
    ) &&
    typeof value.vision === 'boolean' &&
    typeof value.tool_calls === 'boolean' &&
    typeof value.reasoning === 'boolean' &&
    isMode(value.structured_output)
  )
}

function safeDocumentationLink(value: unknown): value is string {
  if (value === '') return true
  if (!text(value, 1024)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

function isCatalogEntry(value: unknown): value is ProviderCatalogEntry {
  if (!object(value) || !object(value.capabilities)) return false
  return (
    Object.keys(value).every((key) =>
      [
        'id',
        'name',
        'default_base_url',
        'default_model',
        'protocol',
        'defaults',
        'capabilities',
        'details_url',
      ].includes(key),
    ) &&
    Object.keys(value.capabilities).every((key) =>
      ['vision', 'tool_calls', 'structured_output', 'reasoning'].includes(key),
    ) &&
    isProvider(value.id) &&
    text(value.name, 80) &&
    text(value.default_base_url, 512) &&
    text(value.default_model, 200) &&
    isProtocol(value.protocol) &&
    isCapabilities(value.defaults) &&
    value.capabilities.vision === 'model_dependent' &&
    value.capabilities.tool_calls === 'model_dependent' &&
    Array.isArray(value.capabilities.structured_output) &&
    value.capabilities.structured_output.length <= 3 &&
    value.capabilities.structured_output.every(isMode) &&
    ['model_dependent', 'unsupported'].includes(String(value.capabilities.reasoning)) &&
    safeDocumentationLink(value.details_url)
  )
}

const PROFILE_FIELDS = new Set([
  'provider',
  'provider_name',
  'model',
  'base_url',
  'protocol',
  'configured',
  'key_configured',
  'key_hint',
  'capabilities',
  'source',
  'workspace_id',
])

function isProfile(value: unknown, topLevel = false): boolean {
  if (!object(value)) return false
  return (
    Object.keys(value).every(
      (key) =>
        PROFILE_FIELDS.has(key) || (topLevel && ['active_provider', 'profiles'].includes(key)),
    ) &&
    isProvider(value.provider) &&
    text(value.provider_name, 80) &&
    text(value.model, 200) &&
    text(value.base_url, 512) &&
    isProtocol(value.protocol) &&
    typeof value.configured === 'boolean' &&
    typeof value.key_configured === 'boolean' &&
    text(value.key_hint, 16) &&
    (value.key_hint === '' || /^[•*]{4,16}$/.test(value.key_hint)) &&
    isCapabilities(value.capabilities) &&
    ['saved', 'local_env'].includes(String(value.source)) &&
    (value.workspace_id === undefined || text(value.workspace_id, 128))
  )
}

function parseSettings(value: unknown): ProviderSettings {
  if (
    !object(value) ||
    !isProfile(value, true) ||
    !isProvider(value.active_provider) ||
    value.active_provider !== value.provider ||
    !Array.isArray(value.profiles) ||
    !value.profiles.length ||
    value.profiles.length > PROVIDERS.size ||
    !value.profiles.every((item) => isProfile(item))
  )
    throw new ProviderSettingsError(
      'The saved connection details could not be read. Try again.',
      'format',
    )
  const profiles = value.profiles as ProviderProfileStatus[]
  if (
    new Set(profiles.map((profile) => profile.provider)).size !== profiles.length ||
    !profiles.some((profile) => profile.provider === value.provider)
  )
    throw new ProviderSettingsError(
      'The saved connection details could not be read. Try again.',
      'format',
    )
  return value as ProviderSettings
}

const SAFE_SERVER_MESSAGES = new Set([
  'Enter a valid API base URL without spaces.',
  'Enter a valid API base URL.',
  'Use an API base URL without credentials, query parameters or fragments.',
  'Use HTTPS. HTTP is allowed only for a custom service on this computer.',
  "Use this provider's official host, or choose Custom endpoint for a proxy.",
  'Enter the exact model identifier from your provider.',
  'Choose the API protocol supported by this provider.',
  'Select valid model capabilities.',
  'Reasoning controls are not implemented for this provider. Leave this switch off.',
  'This connection supports JSON object mode; strict JSON schema mode is not implemented.',
  'For this native API, select JSON schema mode or disable structured output.',
  'Enter a valid API key without spaces or control characters.',
  'Clear the key or enter a replacement key, using one action at a time.',
  'Use the workspace identifier from your native Messages account, or leave it blank.',
  "Save this provider's connection before selecting it.",
  'Connection settings could not be saved on this computer.',
  'Connection settings could not be cleared.',
])

async function readBoundedResponse(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new ProviderSettingsError('The connection response was too large. Try again.', 'format')
  }
  const reader = response.body?.getReader()
  if (!reader)
    throw new ProviderSettingsError(
      'The connection response could not be read. Try again.',
      'format',
    )
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new ProviderSettingsError(
          'The connection response was too large. Try again.',
          'format',
        )
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new ProviderSettingsError(
      'The connection response could not be read. Try again.',
      'format',
    )
  }
}

async function request(path: string, payload?: unknown, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)
  try {
    const body = payload === undefined ? undefined : JSON.stringify(payload)
    if (body && new TextEncoder().encode(body).length > MAX_REQUEST_BYTES)
      throw new ProviderSettingsError(
        'These connection details are too long. Shorten them and try again.',
        'format',
      )
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
    })
    const data = await readBoundedResponse(response)
    if (!response.ok) {
      const message = object(data) && object(data.error) ? data.error.message : undefined
      const safeMessage =
        typeof message === 'string' && SAFE_SERVER_MESSAGES.has(message) ? message : undefined
      throw new ProviderSettingsError(
        safeMessage ||
          (response.status >= 500
            ? 'Connection settings are unavailable right now. Your entries are still here; try again.'
            : 'Check the connection details and try again. Your entries are still here.'),
        'http',
        response.status,
      )
    }
    return data
  } catch (failure) {
    if (timedOut)
      throw new ProviderSettingsError(
        'The connection request is taking too long. Your entries are still here; try again.',
        'timeout',
      )
    if (controller.signal.aborted)
      throw new ProviderSettingsError('The connection request was stopped.', 'aborted')
    if (failure instanceof ProviderSettingsError) throw failure
    throw new ProviderSettingsError(
      'Could not reach ReMatter. Your entries are still here; try again.',
      'network',
    )
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

export async function getProviderSettings(signal?: AbortSignal): Promise<ProviderSettingsResponse> {
  const data = await request('/api/inference/providers', undefined, signal)
  if (
    !object(data) ||
    !Array.isArray(data.catalog) ||
    data.catalog.length !== PROVIDERS.size ||
    !data.catalog.every(isCatalogEntry) ||
    new Set(data.catalog.map((entry) => entry.id)).size !== PROVIDERS.size
  )
    throw new ProviderSettingsError(
      'The list of AI services could not be read. Try again.',
      'format',
    )
  return { catalog: data.catalog, settings: parseSettings(data.settings) }
}

function settingsFromMutation(value: unknown): ProviderSettings {
  return parseSettings(object(value) && 'settings' in value ? value.settings : value)
}

export async function saveProviderSettings(
  payload: SaveProviderSettingsPayload,
  signal?: AbortSignal,
): Promise<ProviderSettings> {
  return settingsFromMutation(await request('/api/inference/providers/save', payload, signal))
}

export async function selectProviderSettings(
  provider: ProviderId,
  signal?: AbortSignal,
): Promise<ProviderSettings> {
  return settingsFromMutation(
    await request('/api/inference/providers/select', { provider }, signal),
  )
}

export async function clearProviderSettings(
  provider?: ProviderId,
  signal?: AbortSignal,
): Promise<ProviderSettings> {
  return settingsFromMutation(
    await request('/api/inference/providers/clear', provider ? { provider } : {}, signal),
  )
}

export function draftForProvider(
  provider: ProviderId,
  catalog: ProviderCatalogEntry[],
  settings: ProviderSettings,
): ProviderDraft {
  const entry = catalog.find((item) => item.id === provider)
  if (!entry) throw new ProviderSettingsError('Choose an available AI service.', 'format')
  const saved = settings.profiles.find((item) => item.provider === provider)
  return {
    provider,
    model: saved?.model ?? entry.default_model,
    base_url: saved?.base_url ?? entry.default_base_url,
    protocol: saved?.protocol ?? entry.protocol,
    capabilities: { ...(saved?.capabilities ?? entry.defaults) },
    workspace_id: saved?.workspace_id ?? '',
  }
}

export function providerSettingsError(failure: unknown): string {
  return failure instanceof ProviderSettingsError
    ? failure.message
    : 'The connection settings could not be updated. Your entries are still here; try again.'
}
