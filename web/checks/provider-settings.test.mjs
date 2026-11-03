import assert from 'node:assert/strict'
import { getProviderSettings, ProviderSettingsError, saveProviderSettings } from '../src/providerSettings.ts'

const ids = ['meta', 'openrouter', 'openai', 'google', 'anthropic', 'nvidia', 'deepseek', 'custom']
const capabilities = { vision: false, tool_calls: false, structured_output: 'none', reasoning: false }
const catalog = ids.map((id) => ({
  id, name: id, default_base_url: '', default_model: '', protocol: 'chat_completions',
  defaults: capabilities,
  capabilities: { vision: 'model_dependent', tool_calls: 'model_dependent', structured_output: ['none'], reasoning: 'unsupported' },
  details_url: '',
}))
const profile = {
  provider: 'meta', provider_name: 'Meta', model: 'muse-spark-1.3-contributor',
  base_url: 'https://api.meta.ai/v1', protocol: 'chat_completions', configured: false,
  key_configured: false, key_hint: '', capabilities, source: 'local_env',
}
const settings = { ...profile, active_provider: 'meta', profiles: [profile] }
const originalFetch = globalThis.fetch
try {
  let requestOptions
  globalThis.fetch = async (_url, options) => {
    requestOptions = options
    return Response.json({ catalog, settings, session_only: true })
  }
  const session = await getProviderSettings()
  assert.equal(session.sessionOnly, true)
  assert.equal(requestOptions.credentials, 'same-origin')

  globalThis.fetch = async () => Response.json({ catalog, settings })
  assert.equal((await getProviderSettings()).sessionOnly, false)

  globalThis.fetch = async () => Response.json({ catalog, settings, session_only: 'true' })
  await assert.rejects(getProviderSettings(), ProviderSettingsError)

  let received
  globalThis.fetch = async (_url, options) => {
    received = options
    return Response.json(settings)
  }
  await saveProviderSettings({
    provider: 'meta', model: profile.model, base_url: profile.base_url,
    protocol: profile.protocol, capabilities, workspace_id: '', api_key: 'synthetic-key',
  })
  assert.equal(received.credentials, 'same-origin')
  assert.equal(JSON.parse(received.body).api_key, 'synthetic-key')
} finally {
  globalThis.fetch = originalFetch
}
console.log('Provider settings preserve session mode and send connection requests with same-origin credentials')
