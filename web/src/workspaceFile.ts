import type { AdvisorFollowupResult, AdvisorMessage, AdvisorResult, AdvisorRoute, AdvisorTrialResult, WorkshopCase } from './types.ts'

export const WORKSPACE_FORMAT = 'rematter-material-workspace'
export const WORKSPACE_VERSION = 1
export const WORKSPACE_MAX_BYTES = 1024 * 1024

export type MeasurementDraft = {
  fields: {
    property_name: string
    property_unit: string
    input_name: string
    input_unit: string
    target_min: string
    target_max: string
    method: string
  }
  data_kind: '' | 'synthetic' | 'user_reported'
  settings: {
    id: string
    level: string
    readings: {
      value: string
      group_kind: 'unknown' | 'repeat' | 'specimen' | 'run' | 'batch'
      group_label: string
      reading_id: string
      specimen_id: string
      run_id: string
      batch_id: string
      repeat_of: string
    }[]
  }[]
}

export type CompositionDraft = {
  component_id: number | null
  fields: {
    input_mass_kg: string
    input_min_percent: string
    input_max_percent: string
    addition_name: string
    addition_percent: string
    target_min_percent: string
    target_max_percent: string
  }
}

export type WorkspaceSnapshot = {
  case_data: WorkshopCase
  unit_system: 'metric' | 'us'
  plan: AdvisorResult | null
  followup?: AdvisorFollowupResult | null
  selected_route: AdvisorRoute | null
  trial: AdvisorTrialResult | null
  history: AdvisorMessage[]
  measurement_draft: MeasurementDraft | null
  mix_draft: CompositionDraft | null
}

export type SavedWorkspace = WorkspaceSnapshot & {
  format: typeof WORKSPACE_FORMAT
  version: typeof WORKSPACE_VERSION
  saved_at: string
}

type ObjectValue = Record<string, unknown>
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])
const briefKeys = ['input', 'variation', 'contamination', 'product', 'use_case', 'targets', 'process', 'available_changes']
const detailsKeys = ['label', 'components', 'amount_unit', 'amount_basis', 'mass_target_min_kg', 'mass_target_max_kg']
const routeKeys = ['id', 'title', 'change', 'why', 'steps', 'tradeoffs', 'check']
const metadataKeys = ['result_kind', 'live', 'provider', 'model', 'usage', 'elapsed_ms', 'request_id', 'physical_product_tested', 'performance_verified']
const providerIds = ['meta', 'openrouter', 'openai', 'google', 'anthropic', 'nvidia', 'deepseek', 'custom']
const snapshotKeys = ['case_data', 'unit_system', 'plan', 'selected_route', 'trial', 'history', 'measurement_draft', 'mix_draft']
const optionalSnapshotKeys = ['followup']

function fail(label: string, reason: string): never {
  throw new Error(`${label}: ${reason}`)
}

function object(value: unknown, label: string, required: string[], optional: string[] = []): ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(label, 'expected an object')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) fail(label, 'expected plain saved data')
  const row = value as ObjectValue
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(row)) {
    if (forbiddenKeys.has(key) || !allowed.has(key)) fail(label, `unsupported field “${key}”`)
  }
  for (const key of required) {
    if (!Object.hasOwn(row, key)) fail(label, `missing field “${key}”`)
  }
  return row
}

function string(value: unknown, label: string, maximum: number, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > maximum || (nonempty && !value.trim()))
    fail(label, `expected ${nonempty ? 'nonempty ' : ''}text of at most ${maximum} characters`)
}

function array(value: unknown, label: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    fail(label, `expected between ${minimum} and ${maximum} entries`)
  return value
}

function choice(value: unknown, label: string, allowed: readonly unknown[]): void {
  if (!allowed.includes(value)) fail(label, 'unsupported value')
}

function integer(value: unknown, label: string, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(label, `expected a whole number of at least ${minimum}`)
}

function strings(value: unknown, label: string, minimum: number, maximum: number, length = 900): void {
  array(value, label, minimum, maximum).forEach((item, index) => string(item, `${label} ${index + 1}`, length, true))
}

function sameData(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right))
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => sameData(item, right[index]))
  const a = left as ObjectValue
  const b = right as ObjectValue
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameData(a[key], b[key]))
}

function apiCaseText(value: unknown): unknown {
  // Match Python str.strip() for binding only; keep saved draft text literal.
  if (typeof value === 'string')
    return value.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, '')
  if (Array.isArray(value)) return value.map(apiCaseText)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, apiCaseText(item)]))
  return value
}

function brief(value: unknown, label: string): void {
  const row = object(value, label, briefKeys)
  for (const key of briefKeys) string(row[key], `${label} ${key}`, 3000)
}

function details(value: unknown, label: string): Set<number> {
  const row = object(value, label, detailsKeys, ['balance'])
  string(row.label, `${label} name`, 120)
  string(row.amount_basis, `${label} amount basis`, 300)
  string(row.mass_target_min_kg, `${label} minimum mass`, 160)
  string(row.mass_target_max_kg, `${label} maximum mass`, 160)
  choice(row.amount_unit, `${label} amount unit`, ['g', 'mass_percent', 'volume_percent'])
  const ids = new Set<number>()
  for (const [index, component] of array(row.components, `${label} components`, 1, 20).entries()) {
    const part = object(component, `${label} material ${index + 1}`, ['id', 'name', 'role', 'amount'])
    integer(part.id, `${label} material identifier`, 1)
    if (ids.has(part.id)) fail(label, 'material identifiers must be different')
    ids.add(part.id)
    string(part.name, `${label} material name`, 120)
    choice(part.role, `${label} material role`, ['main', 'binder', 'other'])
    string(part.amount, `${label} material amount`, 160)
  }
  if (row.balance !== undefined) {
    const balance = object(row.balance, `${label} balance target`, ['coordinate_basis', 'target_min_mm', 'target_max_mm'])
    string(balance.coordinate_basis, `${label} balance axis`, 1000)
    string(balance.target_min_mm, `${label} balance minimum`, 160)
    string(balance.target_max_mm, `${label} balance maximum`, 160)
  }
  return ids
}

function route(value: unknown, label: string): void {
  const row = object(value, label, routeKeys)
  string(row.id, `${label} identifier`, 100, true)
  string(row.title, `${label} title`, 120, true)
  for (const key of ['change', 'why', 'check']) string(row[key], `${label} ${key}`, 1500, true)
  strings(row.steps, `${label} steps`, 1, 5)
  strings(row.tradeoffs, `${label} tradeoffs`, 1, 3)
}

function sources(value: unknown, label: string): void {
  const ids = new Set<string>()
  for (const source of array(value, label, 0, 20)) {
    const row = object(source, label, ['id', 'title', 'url', 'scope'])
    string(row.id, `${label} identifier`, 120, true)
    if (ids.has(row.id)) fail(label, 'reference identifiers must be different')
    ids.add(row.id)
    string(row.title, `${label} title`, 500, true)
    string(row.scope, `${label} scope`, 3000, true)
    string(row.url, `${label} URL`, 2000, true)
    try {
      const url = new URL(row.url)
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || row.url !== row.url.trim())
        fail(label, 'reference links must be ordinary HTTP or HTTPS URLs without credentials')
    } catch {
      fail(label, 'reference links must be ordinary HTTP or HTTPS URLs without credentials')
    }
  }
}

function metadata(row: ObjectValue, label: string, caseDetails: unknown): void {
  choice(row.live, `${label} recorded live flag`, [true, false])
  choice(row.provider, `${label} provider`, providerIds)
  string(row.model, `${label} model`, 200, true)
  integer(row.elapsed_ms, `${label} recorded elapsed time`)
  if (row.request_id !== null) string(row.request_id, `${label} recorded request identifier`, 200)
  choice(row.physical_product_tested, `${label} physical-test flag`, [false])
  choice(row.performance_verified, `${label} property-verification flag`, [false])
  if (!row.usage || typeof row.usage !== 'object' || Array.isArray(row.usage)) fail(label, 'recorded usage must be an object')
  const usage = object(row.usage, `${label} recorded usage`, Object.keys(row.usage))
  if (Object.keys(usage).length > 32) fail(label, 'too many recorded usage fields')
  for (const [key, amount] of Object.entries(usage)) {
    if (forbiddenKeys.has(key) || !key.length || key.length > 80) fail(label, 'unsupported recorded usage field')
    integer(amount, `${label} recorded usage`)
  }
  if (row.requested_reasoning_effort !== undefined) choice(row.requested_reasoning_effort, `${label} recorded reasoning setting`, ['low', 'medium', 'high'])
  if (row.guidance_adjusted !== undefined && row.guidance_adjusted !== true) fail(label, 'invalid locally adapted guidance marker')
  if (Object.hasOwn(row, 'reasoning_effort')) choice(row.reasoning_effort, `${label} applied reasoning setting`, [null, 'low', 'medium', 'high'])
  if (row.calculation_context !== undefined) {
    details(row.calculation_context, `${label} recorded case details`)
    if (!sameData(apiCaseText(row.calculation_context), apiCaseText(caseDetails))) fail(label, 'recorded calculation context does not match this case')
  }
}

function plan(value: unknown, caseDetails: unknown): void {
  const label = 'Saved options'
  const row = object(value, label, [...metadataKeys, 'answer', 'material_routes', 'engineering_routes', 'next_steps', 'questions', 'sources'], ['quarantined_answer', 'requested_reasoning_effort', 'reasoning_effort', 'calculation_context', 'guidance_adjusted'])
  choice(row.result_kind, label, ['engineering_proposals'])
  metadata(row, label, caseDetails)
  string(row.answer, `${label} explanation`, 3000)
  if (row.quarantined_answer !== undefined) strings(row.quarantined_answer, `${label} removed paragraphs`, 0, 100, 3000)
  const ids = new Set<string>()
  for (const kind of ['material_routes', 'engineering_routes']) {
    for (const item of array(row[kind], `${label} ${kind}`, 0, 3)) {
      route(item, `${label} route`)
      const id = (item as ObjectValue).id as string
      if (ids.has(id)) fail(label, 'route identifiers must be different')
      ids.add(id)
    }
  }
  strings(row.next_steps, `${label} next steps`, 0, 5)
  strings(row.questions, `${label} questions`, 0, 3)
  sources(row.sources, `${label} references`)
}

function followup(value: unknown, caseDetails: unknown): void {
  const label = 'Saved follow-up'
  const row = object(value, label, [...metadataKeys, 'answer', 'next_steps', 'questions', 'sources'], ['quarantined_answer', 'requested_reasoning_effort', 'reasoning_effort', 'calculation_context', 'guidance_adjusted'])
  choice(row.result_kind, label, ['engineering_followup'])
  metadata(row, label, caseDetails)
  string(row.answer, `${label} explanation`, 3000, true)
  if (row.quarantined_answer !== undefined) strings(row.quarantined_answer, `${label} removed paragraphs`, 0, 100, 3000)
  strings(row.next_steps, `${label} next steps`, 0, 3)
  strings(row.questions, `${label} questions`, 0, 3)
  sources(row.sources, `${label} references`)
}

function trial(value: unknown, caseData: ObjectValue, selectedRoute: unknown): void {
  const label = 'Saved trial'
  const row = object(value, label, [...metadataKeys, 'route_id', 'targets', 'brief', 'selected_route', 'title', 'objective', 'comparison', 'change', 'keep_fixed', 'materials', 'steps', 'checks', 'questions', 'sources'], ['requested_reasoning_effort', 'reasoning_effort', 'calculation_context', 'guidance_adjusted'])
  choice(row.result_kind, label, ['trial_proposal'])
  metadata(row, label, caseData.details)
  brief(row.brief, `${label} case`)
  if (!sameData(apiCaseText(row.brief), apiCaseText(caseData.brief))) fail(label, 'the trial description does not match this case')
  string(row.targets, `${label} original targets`, 3000, true)
  if (apiCaseText(row.targets) !== apiCaseText((caseData.brief as ObjectValue).targets)) fail(label, 'the original targets do not match this case')
  route(row.selected_route, `${label} route`)
  string(row.route_id, `${label} route identifier`, 100, true)
  if (!selectedRoute || !sameData(row.selected_route, selectedRoute) || row.route_id !== (selectedRoute as ObjectValue).id)
    fail(label, 'the trial must match the selected route')
  string(row.title, `${label} title`, 120, true)
  for (const key of ['objective', 'comparison', 'change']) string(row[key], `${label} ${key}`, 1500, true)
  strings(row.keep_fixed, `${label} fixed conditions`, 1, 5)
  strings(row.materials, `${label} materials`, 1, 6)
  for (const item of array(row.steps, `${label} steps`, 2, 7)) {
    const step = object(item, `${label} step`, ['action', 'record'])
    string(step.action, `${label} action`, 900, true)
    string(step.record, `${label} record`, 900, true)
  }
  for (const item of array(row.checks, `${label} checks`, 1, 6)) {
    const check = object(item, `${label} check`, ['property', 'target', 'method', 'if_outside'])
    string(check.property, `${label} property`, 120, true)
    string(check.target, `${label} check target`, 3000, true)
    if (check.target !== 'Not set' && !(row.targets as string).includes(check.target)) fail(label, 'a check target is not quoted from the original targets')
    string(check.method, `${label} check method`, 1500, true)
    string(check.if_outside, `${label} next adjustment`, 1500, true)
  }
  strings(row.questions, `${label} questions`, 0, 3)
  sources(row.sources, `${label} references`)
}

function measurementDraft(value: unknown): void {
  const label = 'Measurement draft'
  const row = object(value, label, ['fields', 'data_kind', 'settings'])
  const fields = object(row.fields, `${label} fields`, ['property_name', 'property_unit', 'input_name', 'input_unit', 'target_min', 'target_max', 'method'])
  for (const key of ['property_name', 'input_name']) string(fields[key], `${label} ${key}`, 120)
  for (const key of ['property_unit', 'input_unit']) string(fields[key], `${label} ${key}`, 40)
  for (const key of ['target_min', 'target_max']) string(fields[key], `${label} ${key}`, 160)
  string(fields.method, `${label} method`, 1000)
  choice(row.data_kind, `${label} reading type`, ['', 'synthetic', 'user_reported'])
  for (const item of array(row.settings, `${label} settings`, 2, 20)) {
    const setting = object(item, `${label} setting`, ['id', 'level', 'readings'])
    string(setting.id, `${label} setting name`, 80)
    string(setting.level, `${label} recorded level`, 160)
    for (const entry of array(setting.readings, `${label} readings`, 1, 20)) {
      const reading = object(entry, `${label} reading`, ['value', 'group_kind', 'group_label', 'reading_id', 'specimen_id', 'run_id', 'batch_id', 'repeat_of'])
      string(reading.value, `${label} reading value`, 160)
      choice(reading.group_kind, `${label} reading group`, ['unknown', 'repeat', 'specimen', 'run', 'batch'])
      for (const key of ['group_label', 'reading_id', 'specimen_id', 'run_id', 'batch_id', 'repeat_of']) string(reading[key], `${label} ${key}`, 160)
    }
  }
}

function compositionDraft(value: unknown, components: Set<number>): void {
  const label = 'Composition draft'
  const keys = ['input_mass_kg', 'input_min_percent', 'input_max_percent', 'addition_name', 'addition_percent', 'target_min_percent', 'target_max_percent']
  const row = object(value, label, ['component_id', 'fields'])
  if (row.component_id !== null) {
    integer(row.component_id, `${label} component identifier`, 1)
    if (!components.has(row.component_id)) fail(label, 'the selected component is not in this case')
  }
  const fields = object(row.fields, `${label} fields`, keys)
  for (const key of keys) string(fields[key], `${label} ${key}`, key === 'addition_name' ? 120 : 160)
}

function validate(value: unknown): asserts value is SavedWorkspace {
  const row = object(value, 'Workspace file', ['format', 'version', 'saved_at', ...snapshotKeys], optionalSnapshotKeys)
  if (row.format !== WORKSPACE_FORMAT) fail('Workspace file', 'choose a Reshivo material-workspace file')
  if (row.version !== WORKSPACE_VERSION) fail('Workspace file', 'this workspace version is not supported')
  string(row.saved_at, 'Saved date', 30, true)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.saved_at) || !Number.isFinite(Date.parse(row.saved_at)) || new Date(row.saved_at).toISOString() !== row.saved_at)
    fail('Saved date', 'expected a valid UTC saved time')
  choice(row.unit_system, 'Display units', ['metric', 'us'])
  const caseData = object(row.case_data, 'Saved case', ['brief', 'details'])
  brief(caseData.brief, 'Saved case description')
  const components = details(caseData.details, 'Saved case details')
  if (row.plan !== null) plan(row.plan, caseData.details)
  if (row.followup !== undefined && row.followup !== null) followup(row.followup, caseData.details)
  if (row.selected_route !== null) route(row.selected_route, 'Selected route')
  if (row.trial !== null) trial(row.trial, caseData, row.selected_route)
  for (const item of array(row.history, 'Saved discussion', 0, 6)) {
    const message = object(item, 'Saved discussion message', ['role', 'content'])
    choice(message.role, 'Saved discussion role', ['user', 'assistant'])
    string(message.content, 'Saved discussion content', 6000, true)
  }
  if (row.measurement_draft !== null) measurementDraft(row.measurement_draft)
  if (row.mix_draft !== null) compositionDraft(row.mix_draft, components)
}

export function parseWorkspaceFile(text: string): SavedWorkspace {
  if (typeof text !== 'string') fail('Workspace file', 'expected JSON text')
  if (new TextEncoder().encode(text).length > WORKSPACE_MAX_BYTES) fail('Workspace file', 'the file is larger than one megabyte')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    fail('Workspace file', 'the file is not valid JSON')
  }
  validate(value)
  return value
}

export function serializeWorkspaceFile(snapshot: WorkspaceSnapshot): string {
  object(snapshot, 'Workspace snapshot', snapshotKeys, optionalSnapshotKeys)
  const value = { format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, saved_at: new Date().toISOString(), ...snapshot }
  validate(value)
  const text = JSON.stringify(value, null, 2)
  if (new TextEncoder().encode(text).length > WORKSPACE_MAX_BYTES) fail('Workspace file', 'the workspace is larger than one megabyte')
  return text
}
