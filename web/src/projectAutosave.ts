import { PROJECT_WORKSPACE_MAX_BYTES, validateProjectWorkspace, serializeProjectWorkspace, type ProjectWorkspace } from './projectWorkspace.ts'

const PREFIX = 'reshivo:project-autosave:v1:'
const TAB_KEY = 'reshivo:project-autosave:tab'
const BLANK_KEY = 'reshivo:project-autosave:blank'
const MAX_ENVELOPE_BYTES = 6 * 1024 * 1024

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>
type Recovery = { workspace: ProjectWorkspace; savedAt: string }
type Envelope = { schema: 'reshivo-autosave-v1'; savedAt: string; workspace: unknown }

function decode(source: string | null): Recovery | null {
  if (!source || source.length > MAX_ENVELOPE_BYTES) return null
  try {
    const item: unknown = JSON.parse(source)
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const envelope = item as Record<string, unknown>
    if (envelope.schema !== 'reshivo-autosave-v1' || typeof envelope.savedAt !== 'string'
      || !Number.isFinite(Date.parse(envelope.savedAt)) || Object.keys(envelope).some((k) => !['schema', 'savedAt', 'workspace'].includes(k))) return null
    const project = JSON.stringify(envelope.workspace)
    if (new TextEncoder().encode(project).byteLength > PROJECT_WORKSPACE_MAX_BYTES) return null
    return { workspace: validateProjectWorkspace(envelope.workspace), savedAt: envelope.savedAt }
  } catch { return null }
}

/** Local recovery stores project data only, never the browser's provider settings. */
export function createProjectAutosave(local: StorageLike, session: StorageLike, newId: () => string = () => crypto.randomUUID()) {
  let tabId = session.getItem(TAB_KEY)
  if (!tabId || !/^[a-zA-Z0-9-]{1,128}$/.test(tabId)) {
    tabId = newId()
    session.setItem(TAB_KEY, tabId)
  }
  let ownKey = PREFIX + tabId
  let expected = local.getItem(ownKey)
  const deliberatelyBlank = session.getItem(BLANK_KEY) === '1'
  let recovered = deliberatelyBlank ? null : decode(expected)
  let unreadableOwn = expected !== null && !recovered
  // A newly opened tab can recover the latest project. It writes its own entry.
  if (!recovered && !deliberatelyBlank) {
    let latest: Recovery | null = null
    for (let i = 0; i < local.length; i++) {
      const key = local.key(i)
      if (!key?.startsWith(PREFIX)) continue
      const candidate = decode(local.getItem(key))
      if (candidate && (!latest || Date.parse(candidate.savedAt) > Date.parse(latest.savedAt))) latest = candidate
    }
    recovered = latest
  }
  return {
    recovered,
    save(workspace: ProjectWorkspace, allowEmpty = false): void {
      const hasContent = Object.values(workspace.project).some((entry) => entry?.value?.trim())
        || workspace.configurations.length > 0 || workspace.checks.length > 0 || workspace.records.length > 0
        || Object.keys(workspace.costs).length > 0 || Boolean(workspace.intake_notes?.trim())
        || Boolean(workspace.advice_notes?.length || Object.keys(workspace.trial_ideas ?? {}).length || workspace.mix_adjustment_drafts?.length)
      if (!hasContent) {
        if (allowEmpty) session.setItem(BLANK_KEY, '1')
        return
      }
      const project = JSON.parse(serializeProjectWorkspace(workspace)) as unknown
      const envelope: Envelope = { schema: 'reshivo-autosave-v1', savedAt: new Date().toISOString(), workspace: project }
      const encoded = JSON.stringify(envelope)
      // Duplicated browser tabs can inherit sessionStorage. Fork rather than replace
      // another tab's newer work, including when it was deleted in that tab.
      if (unreadableOwn || (session.getItem(BLANK_KEY) === '1' && expected !== null) || local.getItem(ownKey) !== expected) {
        tabId = newId(); session.setItem(TAB_KEY, tabId); ownKey = PREFIX + tabId
        if (local.getItem(ownKey) !== null) throw new Error('Could not create a separate local project save.')
        unreadableOwn = false
      }
      local.setItem(ownKey, encoded)
      expected = encoded
      session.removeItem(BLANK_KEY)
    },
    /** Remove recoverable saves of this case; other projects remain untouched. */
    forget(workspace: ProjectWorkspace): void {
      const remove: string[] = []
      for (let i = 0; i < local.length; i++) {
        const key = local.key(i)
        if (key?.startsWith(PREFIX) && decode(local.getItem(key))?.workspace.case_id === workspace.case_id) remove.push(key)
      }
      for (const key of remove) local.removeItem(key)
      if (remove.includes(ownKey)) expected = null
    },
  }
}
