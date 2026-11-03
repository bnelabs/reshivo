import type { ProjectIntakeDraft } from './projectIntake'
import { validateMaterialAmount } from './checkEditing.ts'
import { recordedRecipeFraction, recordedRecipeMatchesFraction, recordedRecipeTarget } from './referenceComposition.ts'
import type { MixAdjustmentDraft } from './mixAdjustment'

export type TrialConfiguration = {
  id: string; revision: number; name: string
  materials: { id: string; name: string; amount: string; unit: string }[]
  process: string; geometry: string; notes: string
}
export type ProductCheck = {
  id: string; name: string; unit: string; method: string
  minimum: string | null; maximum: string | null; required: boolean
}
export type TrialReading = {
  value: string; reading_id?: string | null; specimen_id?: string | null
  run_id?: string | null; batch_id?: string | null; repeat_of?: string | null
}
export type TrialRecord = {
  id: string; case_id: string; configuration_id: string; configuration_revision: number
  check_id: string; unit: string; method: string; data_kind: 'synthetic' | 'user_reported'
  conditions_confirmed: boolean; readings: TrialReading[]
}
export type ProcessCostStatus = 'unknown' | 'known' | 'excluded'
export type CostDraft = {
  currency: string; mass_basis: string; functional_basis: string; acceptance_basis: string
  prices: Record<string, string>; price_units?: Record<string, 'kg' | 'lb'>; energy_kwh: string; energy_rate: string
  labor_hours: string; labor_rate: string; other_charge: string; other_name: string
  usable_count: string; usable_mass_kg: string; usable_area_m2: string
  mode: 'actual' | 'planned'; accepted_fraction: string
  gross_count: string; gross_mass_kg: string; gross_area_m2: string; batch_mass_kg: string
  process_statuses?: Partial<Record<'energy' | 'labor' | 'other', ProcessCostStatus>>
}
export type SavedMixContext = {
  case_id: string
  destination: { id: string; revision: number; component_id: string; component_name: string }
  inputs: { component: string; input_mass_kg: number; input_min_percent: number; input_max_percent: number; addition_name: string; addition_percent: number; target_min_percent: number; target_max_percent: number }
  source_recipe?: { id: string; revision: number; name: string; component_id: string; component_name: string; basis: 'whole_recipe'; fraction: { numerator: string; denominator: string }; materials: { id: string; name: string; amount: string; unit: string }[]; process: string; geometry: string; readings_included: false }
}
export type ProjectAdviceNote = {
  id: string; created_at: string; provider: string; model: string
  project_snapshot: ProjectIntakeDraft
  configuration_versions: { id: string; revision: number }[]
  assessment_kind: 'synthetic' | 'user_reported'; text: string; kind: 'model_proposal' | 'local_guidance'
  mix_context?: SavedMixContext
}
export type TrialIdea = {title:string;change:string;why:string;steps:string[];tradeoffs:string[];check:string;provider:string;model:string;note_id?:string}
export type SavedMixAdjustmentDraft = {
  case_id: string; configuration_id: string; configuration_revision: number
  component_id: string; component_name: string; project_snapshot: ProjectIntakeDraft; values: MixAdjustmentDraft
  reference?: { setup_id: string; setup_revision: number; setup_snapshot: string; component_id: string; component_name: string; basis: 'whole_recipe'; fraction: string; latest_revision_at_review: number; range?: { min: string; max: string; numerator: string; denominator: string } }
}
export type ProjectWorkspace = {
  schema: 'reshivo-project-v2'; case_id: string; project: ProjectIntakeDraft
  configurations: TrialConfiguration[]; checks: ProductCheck[]; records: TrialRecord[]
  costs: Record<string, CostDraft>
  record_exclusions?: Record<string, string>
  advice_notes?: ProjectAdviceNote[]
  intake_notes?: string
  trial_ideas?: Record<string,TrialIdea>
  mix_adjustment_drafts?: SavedMixAdjustmentDraft[]
}
export type TrialComparisonRequest = Pick<ProjectWorkspace, 'case_id' | 'configurations' | 'checks' | 'records'> & {
  assessment_kind: 'synthetic' | 'user_reported'
}
export const PROJECT_WORKSPACE_SCHEMA = 'reshivo-project-v2'
const LEGACY_PROJECT_WORKSPACE_SCHEMA = 'rematter-project-v2'
export const PROJECT_WORKSPACE_MAX_BYTES = 4 * 1024 * 1024
const PROJECT_FIELDS = ['product', 'input', 'variation', 'use', 'priorities', 'process', 'constraints'] as const
const COST_FIELDS = ['currency', 'mass_basis', 'functional_basis', 'acceptance_basis', 'energy_kwh', 'energy_rate',
  'labor_hours', 'labor_rate', 'other_charge', 'other_name', 'usable_count', 'usable_mass_kg', 'usable_area_m2',
  'accepted_fraction', 'gross_count', 'gross_mass_kg', 'gross_area_m2', 'batch_mass_kg'] as const
const GROUP_FIELDS = ['reading_id', 'specimen_id', 'run_id', 'batch_id', 'repeat_of'] as const

function object(value: unknown, required: readonly string[], optional: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  const item = value as Record<string, unknown>
  if (required.some((key) => !Object.hasOwn(item, key)) || Object.keys(item).some((key) => !required.includes(key) && !optional.includes(key))) {
    throw new Error(`${label} contains missing or unsupported fields.`)
  }
  return item
}
function text(value: unknown, label: string, max = 160, required = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${label} must be ${required ? 'nonempty ' : ''}text within ${max} characters.`)
}
function list(value: unknown, max: number, label: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} must contain at most ${max} entries.`)
}
function revision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000_000) throw new Error('Use a nonnegative integer configuration revision.')
}
function unique(ids: string[], label: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`${label} identifiers must be unique.`)
}
function clone<T>(value: T): T { return structuredClone(value) }
function validateProjectDraft(value: unknown, label: string): void {
  const project = object(value, PROJECT_FIELDS, [], label)
  for (const field of PROJECT_FIELDS) {
    if (project[field] === null) continue
    const record = object(project[field], ['value', 'source', 'quote'], [], `${label} ${field}`)
    text(record.value, `${label} ${field}`, 1000, true); text(record.quote, 'Source quote', 1500, true)
    if (typeof record.source !== 'string' || !/^(message|history\.[0-5]|user_review)$/.test(record.source)
      || !record.quote.includes(record.value) || (record.source === 'user_review' && record.quote !== record.value)) throw new Error('Project details need their literal source text.')
  }
}

function validateSavedMixContext(value: unknown, caseId: unknown): void {
  const mix = object(value, ['case_id', 'destination', 'inputs'], ['source_recipe'], 'Saved mix context')
  if (mix.case_id !== caseId) throw new Error('A saved mix context must belong to its project.')
  const destination = object(mix.destination, ['id', 'revision', 'component_id', 'component_name'], [], 'Saved mix destination')
  text(destination.id, 'Saved mix setup', 160, true); revision(destination.revision)
  text(destination.component_id, 'Saved mix material ID', 160, true); text(destination.component_name, 'Saved mix material', 160, true)
  const inputs = object(mix.inputs, ['component', 'input_mass_kg', 'input_min_percent', 'input_max_percent', 'addition_name', 'addition_percent', 'target_min_percent', 'target_max_percent'], [], 'Saved mix inputs')
  text(inputs.component, 'Saved mix component', 160, true); text(inputs.addition_name, 'Saved mix added stock', 120, true)
  if (inputs.component !== (destination.component_name as string).trim()) throw new Error('A saved mix must retain its selected material.')
  for (const field of ['input_mass_kg', 'input_min_percent', 'input_max_percent', 'addition_percent', 'target_min_percent', 'target_max_percent']) {
    const number = inputs[field]
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || (field === 'input_mass_kg' ? number === 0 || number > 1_000_000 : number > 100)) throw new Error('Saved mix inputs need valid finite numbers.')
  }
  if ((inputs.input_min_percent as number) > (inputs.input_max_percent as number) || (inputs.target_min_percent as number) > (inputs.target_max_percent as number)) throw new Error('Saved mix ranges need ordered limits.')
  if (mix.source_recipe !== undefined) {
    const source = object(mix.source_recipe, ['id', 'revision', 'name', 'component_id', 'component_name', 'basis', 'fraction', 'materials', 'process', 'geometry', 'readings_included'], [], 'Saved recipe source')
    text(source.id, 'Saved recipe setup', 160, true); revision(source.revision); text(source.name, 'Saved recipe name', 160, true)
    text(source.component_id, 'Saved recipe ingredient ID', 160, true); text(source.component_name, 'Saved recipe ingredient', 160, true)
    text(source.process, 'Saved recipe process', 2000); text(source.geometry, 'Saved recipe shape', 2000)
    if (source.basis !== 'whole_recipe' || source.readings_included !== false) throw new Error('A saved recipe source needs its whole-recipe basis.')
    const fraction = object(source.fraction, ['numerator', 'denominator'], [], 'Saved recipe fraction')
    if (typeof fraction.numerator !== 'string' || typeof fraction.denominator !== 'string' || !/^\d{1,2500}$/.test(fraction.numerator) || !/^[1-9]\d{0,2499}$/.test(fraction.denominator)) throw new Error('A saved recipe fraction needs valid nonnegative terms.')
    list(source.materials, 50, 'Saved recipe ingredients')
    if (!source.materials.length) throw new Error('A saved recipe needs its recorded ingredients.')
    const ids: string[] = []
    for (const material of source.materials) {
      const item = object(material, ['id', 'name', 'amount', 'unit'], [], 'Saved recipe ingredient')
      text(item.id, 'Saved ingredient ID', 160, true); ids.push(item.id)
      text(item.name, 'Saved ingredient name', 160, true); text(item.amount, 'Saved ingredient amount', 160, true); text(item.unit, 'Saved ingredient unit', 160, true)
    }
    unique(ids, 'Saved ingredient')
    if (!source.materials.some((material) => (material as Record<string, unknown>).id === source.component_id && (material as Record<string, unknown>).name === source.component_name)) throw new Error('A saved recipe must retain its selected ingredient.')
    const recipe = { id: source.id, revision: source.revision, name: source.name, materials: source.materials,
      process: source.process, geometry: source.geometry, notes: '' } as TrialConfiguration
    if (!recordedRecipeMatchesFraction(recipe, source.component_id as string, fraction.numerator as string,
      fraction.denominator as string, inputs.target_min_percent as number, inputs.target_max_percent as number))
      throw new Error('A saved recipe fraction must match its ingredients and trial range.')
  }
}

export function newProjectWorkspace(project?: ProjectIntakeDraft): ProjectWorkspace {
  return { schema: PROJECT_WORKSPACE_SCHEMA, case_id: crypto.randomUUID(),
    project: project ? clone(project) : { product: null, input: null, variation: null, use: null, priorities: null, process: null, constraints: null },
    configurations: [], checks: [], records: [], costs: {}, record_exclusions: {}, advice_notes: [], trial_ideas:{}, mix_adjustment_drafts: [] }
}
export function newCostDraft(): CostDraft {
  return { currency: '', mass_basis: '', functional_basis: '', acceptance_basis: '', prices: {},
    energy_kwh: '', energy_rate: '', labor_hours: '', labor_rate: '', other_charge: '', other_name: '',
    usable_count: '', usable_mass_kg: '', usable_area_m2: '', mode: 'actual', accepted_fraction: '',
    gross_count: '', gross_mass_kg: '', gross_area_m2: '', batch_mass_kg: '',
    process_statuses: { energy: 'unknown', labor: 'unknown', other: 'unknown' } }
}
export function configurationKey(configuration: TrialConfiguration): string
export function configurationKey(id: string, revision: number): string
export function configurationKey(configuration: TrialConfiguration | string, version?: number): string {
  return typeof configuration === 'string' ? `${configuration}@${version}` : `${configuration.id}@${configuration.revision}`
}
export function currentConfigurations(workspace: ProjectWorkspace): TrialConfiguration[] {
  const current = new Map<string, TrialConfiguration>()
  for (const configuration of workspace.configurations) {
    if (!current.has(configuration.id) || current.get(configuration.id)!.revision < configuration.revision) current.set(configuration.id, configuration)
  }
  return clone([...current.values()])
}

export function validateProjectWorkspace(value: unknown): ProjectWorkspace {
  const root = object(value, ['schema', 'case_id', 'project', 'configurations', 'checks', 'records', 'costs'], ['record_exclusions', 'advice_notes', 'trial_ideas', 'mix_adjustment_drafts', 'intake_notes'], 'Workspace')
  if (root.schema !== PROJECT_WORKSPACE_SCHEMA && root.schema !== LEGACY_PROJECT_WORKSPACE_SCHEMA) throw new Error('This is not a supported Reshivo project workspace.')
  text(root.case_id, 'Case identifier', 160, true)
  validateProjectDraft(root.project, 'Project details')
  if (root.intake_notes !== undefined) text(root.intake_notes, 'Project discussion', 20000)
  list(root.configurations, 100, 'Configurations'); list(root.checks, 50, 'Checks'); list(root.records, 1000, 'Records')
  const configurations = new Map<string, Record<string, unknown>>()
  for (const entry of root.configurations) {
    const item = object(entry, ['id', 'revision', 'name', 'materials', 'process', 'geometry', 'notes'], [], 'Configuration')
    text(item.id, 'Configuration identifier', 160, true); revision(item.revision); text(item.name, 'Configuration name')
    for (const field of ['process', 'geometry', 'notes']) text(item[field], field, 2000)
    list(item.materials, 50, 'Materials')
    const materialIds: string[] = []
    for (const material of item.materials) {
      const stock = object(material, ['id', 'name', 'amount', 'unit'], [], 'Material')
      text(stock.id, 'Material identifier', 160, true); materialIds.push(stock.id)
      for (const field of ['name', 'amount', 'unit']) text(stock[field], `Material ${field}`)
      if (!(stock.name as string).trim()) throw new Error('A saved setup has an unnamed material. Correct the project JSON before opening; your current project is unchanged.')
      const amountError = validateMaterialAmount(stock.amount)
      if (amountError) throw new Error(`A saved setup has an invalid material amount: ${amountError} Correct the project JSON before opening; your current project is unchanged.`)
    }
    unique(materialIds, 'Material')
    const key = configurationKey(item.id, item.revision)
    if (configurations.has(key)) throw new Error('Configuration versions must be unique; keep changed setups as new revisions.')
    configurations.set(key, item)
  }
  if (root.mix_adjustment_drafts !== undefined) {
    list(root.mix_adjustment_drafts, 5000, 'Mix adjustment drafts')
    const references = new Set<string>()
    for (const entry of root.mix_adjustment_drafts) {
      const draft = object(entry, ['case_id', 'configuration_id', 'configuration_revision', 'component_id', 'component_name', 'project_snapshot', 'values'], ['reference'], 'Mix adjustment draft')
      text(draft.case_id, 'Mix adjustment case identifier', 160, true)
      text(draft.configuration_id, 'Mix adjustment configuration identifier', 160, true)
      revision(draft.configuration_revision)
      text(draft.component_id, 'Mix adjustment material identifier', 160, true)
      text(draft.component_name, 'Mix adjustment material name', 160, true)
      validateProjectDraft(draft.project_snapshot, 'Mix adjustment project snapshot')
      const configuration = configurations.get(configurationKey(draft.configuration_id, draft.configuration_revision))
      if (draft.case_id !== root.case_id || !configuration) throw new Error('A mix adjustment draft must belong to this case and an exact captured setup version.')
      const material = (configuration.materials as { id: string; name: string }[]).find((item) => item.id === draft.component_id)
      if (!material || material.name !== draft.component_name) throw new Error('A mix adjustment draft must retain the selected material in its exact setup version.')
      const reference = JSON.stringify([draft.configuration_id, draft.configuration_revision, draft.component_id])
      if (references.has(reference)) throw new Error('Mix adjustment drafts must be unique for each setup version and material.')
      references.add(reference)
      const values = object(draft.values, ['inputMass', 'inputMin', 'inputMax', 'additionName', 'additionPercent', 'targetMin', 'targetMax'], ['inputMassOrigin'], 'Mix adjustment values')
      for (const field of ['inputMin', 'inputMax', 'additionPercent', 'targetMin', 'targetMax']) text(values[field], `Mix adjustment ${field}`, 160)
      text(values.inputMass, 'Mix adjustment portion mass', 168)
      text(values.additionName, 'Mix adjustment stock name', 120)
      if (values.inputMassOrigin !== undefined && (!['metric', 'us'].includes(values.inputMassOrigin as string) || !(values.inputMass as string).startsWith('invalid:'))) throw new Error('An invalid mass draft may record only its original metric or US unit.')
      if (draft.reference !== undefined) {
        const reference = object(draft.reference, ['setup_id', 'setup_revision', 'setup_snapshot', 'component_id', 'component_name', 'basis', 'fraction', 'latest_revision_at_review'], ['range'], 'Recorded recipe reference')
        text(reference.setup_id, 'Reference setup identifier', 160, true); revision(reference.setup_revision)
        text(reference.setup_snapshot, 'Reference setup snapshot', 100000, true)
        text(reference.component_id, 'Reference material identifier', 160, true); text(reference.component_name, 'Reference material name', 160, true)
        text(reference.fraction, 'Reference fraction', 1100, true); revision(reference.latest_revision_at_review)
        const source = configurations.get(configurationKey(reference.setup_id, reference.setup_revision)) as unknown as TrialConfiguration | undefined
        const sourceMaterial = source?.materials.find((item) => item.id === reference.component_id)
        const latestRevision = Math.max(...(root.configurations as TrialConfiguration[]).filter((item) => item.id === reference.setup_id).map((item) => item.revision))
        if (reference.basis !== 'whole_recipe' || !source || JSON.stringify(source) !== reference.setup_snapshot || !sourceMaterial || sourceMaterial.name !== reference.component_name || (reference.latest_revision_at_review as number) < (reference.setup_revision as number) || (reference.latest_revision_at_review as number) > latestRevision) throw new Error('A recorded recipe reference must retain its exact setup, material and review version.')
        const calculated = recordedRecipeFraction(source, sourceMaterial.id)
        if (!calculated.ok) throw new Error('A recorded recipe reference must match its entered amounts and target.')
        const target = recordedRecipeTarget(calculated)
        let rangeMatches = reference.range === undefined && target.range === undefined
        if (reference.range !== undefined) {
          const range = object(reference.range, ['min', 'max', 'numerator', 'denominator'], [], 'Recorded recipe range')
          for (const field of ['min', 'max', 'numerator', 'denominator']) text(range[field], `Recorded recipe range ${field}`, 500, true)
          rangeMatches = Boolean(target.range && (['min', 'max', 'numerator', 'denominator'] as const).every((field) => range[field] === target.range![field]))
        }
        if (target.fraction !== reference.fraction || values.targetMin !== target.min || values.targetMax !== target.max || !rangeMatches) throw new Error('A recorded recipe reference must match its entered amounts and target.')
      }
    }
  }
  if (root.advice_notes !== undefined) {
    list(root.advice_notes, 30, 'Saved planning notes')
    const noteIds: string[] = []
    for (const entry of root.advice_notes) {
      const note = object(entry, ['id', 'created_at', 'provider', 'model', 'project_snapshot', 'configuration_versions', 'assessment_kind', 'text', 'kind'], ['mix_context'], 'Saved planning note')
      text(note.id, 'Planning note identifier', 160, true); noteIds.push(note.id)
      text(note.created_at, 'Planning note creation time', 64, true)
      if (!Number.isFinite(Date.parse(note.created_at))) throw new Error('Planning note creation time must be a valid timestamp.')
      text(note.provider, 'Planning note provider', 160, true); text(note.model, 'Planning note model', 200, true)
      text(note.text, 'Planning note text', 100000, true)
      if (!['model_proposal','local_guidance'].includes(note.kind as string)) throw new Error('Saved planning notes must remain historical model proposals or local guidance.')
      if (note.kind==='local_guidance' && note.provider!=='local') throw new Error('Local planning guidance must retain its local origin.')
      if (note.kind==='model_proposal' && note.provider==='local') throw new Error('Local guidance cannot be saved as a model proposal.')
      if (!['synthetic', 'user_reported'].includes(note.assessment_kind as string)) throw new Error('A planning note needs its explicit assessment kind.')
      validateProjectDraft(note.project_snapshot, 'Planning note project snapshot')
      if (note.mix_context !== undefined) validateSavedMixContext(note.mix_context, root.case_id)
      list(note.configuration_versions, 100, 'Planning note configuration versions')
      const references: string[] = []
      for (const version of note.configuration_versions) {
        const reference = object(version, ['id', 'revision'], [], 'Planning note configuration reference')
        text(reference.id, 'Planning note configuration identifier', 160, true); revision(reference.revision)
        const key = configurationKey(reference.id, reference.revision)
        if (!configurations.has(key)) throw new Error('A planning note must reference an exact captured configuration version.')
        references.push(key)
      }
      unique(references, 'Planning note configuration reference')
    }
    unique(noteIds, 'Planning note')
  }
  if (root.trial_ideas !== undefined) {
    if (!root.trial_ideas || typeof root.trial_ideas !== 'object' || Array.isArray(root.trial_ideas)) throw new Error('Trial ideas must be keyed by setup version.')
    if (Object.keys(root.trial_ideas).length > 100) throw new Error('Keep trial ideas within 100 versions.')
    const noteIds = new Set(((root.advice_notes ?? []) as {id:string}[]).map(note=>note.id))
    for (const [key, entry] of Object.entries(root.trial_ideas)) {
      if (!configurations.has(key)) throw new Error('A trial idea must belong to an exact captured setup version.')
      const idea=object(entry,['title','change','why','steps','tradeoffs','check','provider','model'],['note_id'],'Trial idea')
      text(idea.title,'Trial idea title',120,true)
      for(const field of ['change','why','check']) text(idea[field],`Trial idea ${field}`,1500,true)
      text(idea.provider,'Trial idea provider',160,true);text(idea.model,'Trial idea model',200,true)
      for(const field of ['steps','tradeoffs']) {
        const rows=idea[field];list(rows,field==='steps'?5:3,`Trial idea ${field}`)
        if(!rows.length)throw new Error('A trial idea needs its original steps and trade-offs.')
        for(const row of rows)text(row,`Trial idea ${field}`,900,true)
      }
      if(idea.note_id!==undefined){text(idea.note_id,'Planning note identifier',160,true);if(!noteIds.has(idea.note_id))throw new Error('A trial idea note must be a saved planning note.')}
    }
  }
  const checks = new Map<string, Record<string, unknown>>()
  for (const entry of root.checks) {
    const item = object(entry, ['id', 'name', 'unit', 'method', 'minimum', 'maximum', 'required'], [], 'Check')
    text(item.id, 'Check identifier', 160, true)
    for (const field of ['name', 'unit']) text(item[field], `Check ${field}`)
    text(item.method, 'Check method', 2000)
    for (const field of ['minimum', 'maximum']) if (item[field] !== null) text(item[field], `Check ${field}`)
    if (typeof item.required !== 'boolean') throw new Error('A check requirement must be true or false.')
    if (checks.has(item.id)) throw new Error('Check identifiers must be unique.')
    checks.set(item.id, item)
  }
  const recordIds: string[] = []
  let totalReadings = 0
  for (const entry of root.records) {
    const item = object(entry, ['id', 'case_id', 'configuration_id', 'configuration_revision', 'check_id', 'unit', 'method', 'data_kind', 'conditions_confirmed', 'readings'], [], 'Record')
    for (const field of ['id', 'case_id', 'configuration_id', 'check_id']) text(item[field], `Record ${field}`, 160, true)
    revision(item.configuration_revision); text(item.unit, 'Record unit'); text(item.method, 'Record method', 2000)
    if (item.case_id !== root.case_id || !configurations.has(configurationKey(item.configuration_id as string, item.configuration_revision))) throw new Error('A record must belong to this case and an exact captured configuration version.')
    const check = checks.get(item.check_id as string)
    if (!check || check.unit !== item.unit || check.method !== item.method) throw new Error('A record must retain its check, unit and method; create a new check for changed meanings.')
    if (!['synthetic', 'user_reported'].includes(item.data_kind as string) || typeof item.conditions_confirmed !== 'boolean') throw new Error('A record needs explicit source kind and condition confirmation.')
    recordIds.push(item.id as string)
    list(item.readings, 1000, 'Readings'); totalReadings += item.readings.length
    if (totalReadings > 10000) throw new Error('Keep the workspace within 10000 readings.')
    const identified = new Map<string, Record<string, unknown>>()
    for (const reading of item.readings) {
      const row = object(reading, ['value'], GROUP_FIELDS, 'Reading')
      text(row.value, 'Reading value')
      for (const field of GROUP_FIELDS) if (Object.hasOwn(row, field) && row[field] !== null) text(row[field], field)
      if (typeof row.reading_id === 'string' && row.reading_id.trim()) {
        if (identified.has(row.reading_id)) throw new Error('Reading identifiers must be unique within a record.')
        identified.set(row.reading_id, row)
      }
    }
    for (const reading of item.readings) {
      const row = reading as Record<string, unknown>
      const seen = new Set<unknown>()
      let at = row
      while (typeof at.repeat_of === 'string' && at.repeat_of.trim()) {
        if (seen.has(at.repeat_of)) throw new Error('Repeated readings cannot form a cycle.')
        seen.add(at.repeat_of)
        const parent = identified.get(at.repeat_of)
        if (!parent) throw new Error('A repeated reading must reference a reading in its own record.')
        if (at.specimen_id && parent.specimen_id && at.specimen_id !== parent.specimen_id) throw new Error('Repeated readings cannot change a known specimen identifier.')
        at = parent
      }
    }
  }
  unique(recordIds, 'Record')
  if (root.record_exclusions !== undefined) {
    if (!root.record_exclusions || typeof root.record_exclusions !== 'object' || Array.isArray(root.record_exclusions)) throw new Error('Record exclusions must name retained records and their reasons.')
    for (const [recordId, reason] of Object.entries(root.record_exclusions)) {
      if (!recordIds.includes(recordId)) throw new Error('An excluded record must still be retained in this workspace.')
      text(reason, 'Record exclusion reason', 1000, true)
    }
  }
  if (!root.costs || typeof root.costs !== 'object' || Array.isArray(root.costs)) throw new Error('Costs must be keyed by configuration version.')
  if (Object.keys(root.costs).length > 100) throw new Error('Keep costs within 100 configuration versions.')
  for (const [key, entry] of Object.entries(root.costs)) {
    const configuration = configurations.get(key)
    if (!configuration) throw new Error('A cost draft must belong to an exact captured configuration version.')
    const cost = object(entry, [...COST_FIELDS, 'prices', 'mode'], ['process_statuses', 'price_units'], 'Cost draft')
    for (const field of COST_FIELDS) text(cost[field], `Cost ${field}`, ['mass_basis', 'functional_basis', 'acceptance_basis', 'other_name'].includes(field) ? 2000 : 160)
    if (!['actual', 'planned'].includes(cost.mode as string)) throw new Error('Cost mode must be actual or planned.')
    if (!cost.prices || typeof cost.prices !== 'object' || Array.isArray(cost.prices)) throw new Error('Material prices must be keyed by material identifier.')
    const materials = new Set((configuration.materials as { id: string }[]).map((material) => material.id))
    if (Object.keys(cost.prices).length > 50) throw new Error('Keep material prices within 50 entries.')
    for (const [materialId, price] of Object.entries(cost.prices)) {
      if (!materials.has(materialId)) throw new Error('A price must belong to a material in this exact configuration.')
      text(price, 'Material price')
    }
    if (cost.price_units !== undefined) {
      if (!cost.price_units || typeof cost.price_units !== 'object' || Array.isArray(cost.price_units) || Object.keys(cost.price_units).length > 50) throw new Error('Price units must be keyed by material identifier.')
      for (const [materialId, unit] of Object.entries(cost.price_units)) {
        if (!materials.has(materialId) || !['kg', 'lb'].includes(unit as string)) throw new Error('A price unit must use kg or lb for a material in this setup.')
      }
    }
    if (cost.process_statuses !== undefined) {
      const statuses = object(cost.process_statuses, [], ['energy', 'labor', 'other'], 'Process cost statuses')
      if (Object.values(statuses).some((status) => !['unknown', 'known', 'excluded'].includes(status as string))) throw new Error('Each process cost status must be unknown, known or excluded.')
    }
  }
  return { ...clone(root), schema: PROJECT_WORKSPACE_SCHEMA } as ProjectWorkspace
}

export function serializeProjectWorkspace(workspace: ProjectWorkspace): string {
  const encoded = JSON.stringify(validateProjectWorkspace(workspace), null, 2)
  if (new TextEncoder().encode(encoded).byteLength > PROJECT_WORKSPACE_MAX_BYTES) throw new Error('This workspace exceeds the 4 MB file limit.')
  return encoded
}
export function parseProjectWorkspace(source: string): ProjectWorkspace {
  if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > PROJECT_WORKSPACE_MAX_BYTES) throw new Error('Choose a project workspace file no larger than 4 MB.')
  let parsed: unknown
  try { parsed = JSON.parse(source) } catch { throw new Error('This file is not valid project JSON.') }
  const workspace = validateProjectWorkspace(parsed)
  for (const record of workspace.records) record.conditions_confirmed = false
  return workspace
}
export function downloadProjectWorkspace(workspace: ProjectWorkspace): void {
  const blob = new Blob([serializeProjectWorkspace(workspace)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = 'reshivo-project.json'
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function buildTrialComparisonRequest(workspace: ProjectWorkspace, assessment_kind: 'synthetic' | 'user_reported'): TrialComparisonRequest {
  const checked = validateProjectWorkspace(workspace)
  if (!['synthetic', 'user_reported'].includes(assessment_kind)) throw new Error('Choose synthetic or user-reported readings explicitly.')
  return { case_id: checked.case_id, configurations: checked.configurations, checks: checked.checks,
    records: checked.records.filter((record) => !Object.hasOwn(checked.record_exclusions ?? {}, record.id)), assessment_kind }
}
export async function requestTrialComparison<T = Record<string, unknown>>(workspace: ProjectWorkspace, kind: 'synthetic' | 'user_reported', signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/project/trial-records', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildTrialComparisonRequest(workspace, kind)), signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || `Request failed (${response.status})`)
  return data as T
}
