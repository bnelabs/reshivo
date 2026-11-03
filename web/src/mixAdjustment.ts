import type { BalanceMixRequest } from './types'
import type { ProjectWorkspace, SavedMixAdjustmentDraft, TrialConfiguration } from './projectWorkspace'
import type { ProjectIntakeDraft } from './projectIntake'
import { toDisplay, unitLabel } from './unitConversion.ts'
import type { UnitSystem } from './unitConversion.ts'
import { recordedRecipeFraction, recordedRecipeTarget } from './referenceComposition.ts'

export type MixAdjustmentDraft = {
  trackedComponent?: string
  inputMass: string
  inputMassOrigin?: UnitSystem
  inputMin: string
  inputMax: string
  additionName: string
  additionPercent: string
  targetMin: string
  targetMax: string
}

export const emptyMixAdjustmentDraft = (): MixAdjustmentDraft => ({
  inputMass: '', inputMin: '', inputMax: '', additionName: '', additionPercent: '', targetMin: '', targetMax: '',
})

/** A named component is user supplied and stays tied to the chosen material stream. */
export function trackedMixComponent(component: { name: string }, draft: MixAdjustmentDraft): string {
  return draft.trackedComponent === undefined ? component.name : draft.trackedComponent.trim()
}

export function originalMixStreamDescription(materialName: string, projectInput: string | null | undefined): string {
  return materialName === 'Project materials (see project description)' ? projectInput ?? '' : ''
}

export function savedMixAdjustmentRecord(workspace: ProjectWorkspace, setup: TrialConfiguration | undefined, component: { id: string; name: string } | undefined): SavedMixAdjustmentDraft | undefined {
  return workspace.mix_adjustment_drafts?.find((item) => item.case_id === workspace.case_id && item.configuration_id === setup?.id && item.configuration_revision === setup?.revision && item.component_id === component?.id && item.component_name === component?.name)
}
export function savedMixAdjustment(workspace: ProjectWorkspace, setup: TrialConfiguration | undefined, component: { id: string; name: string } | undefined): MixAdjustmentDraft {
  return savedMixAdjustmentRecord(workspace, setup, component)?.values ?? emptyMixAdjustmentDraft()
}
function matchingReferenceRange(a: SavedMixAdjustmentDraft['reference'], b: ReturnType<typeof recordedRecipeTarget>) {
  if (!a) return false
  if (!a.range || !b.range) return !a.range && !b.range
  return (['min', 'max', 'numerator', 'denominator'] as const).every((field) => a.range![field] === b.range![field])
}
export function mixDraftNeedsProjectReview(draft: SavedMixAdjustmentDraft | undefined, project: ProjectIntakeDraft): boolean {
  return Boolean(draft && JSON.stringify(draft.project_snapshot) !== JSON.stringify(project))
}

/** Bind an edit to the exact captured case, setup version and component. */
export function updateSavedMixAdjustment(workspace: ProjectWorkspace, caseId: string, setup: TrialConfiguration, component: { id: string; name: string }, project: ProjectIntakeDraft, field: Exclude<keyof MixAdjustmentDraft, 'inputMassOrigin'>, value: string, massOrigin?: UnitSystem): ProjectWorkspace {
  const limit = field === 'additionName' ? 120 : field === 'inputMass' ? 168 : 160
  if (workspace.case_id !== caseId || JSON.stringify(workspace.project) !== JSON.stringify(project) || typeof value !== 'string' || value.length > limit) return workspace
  const captured = workspace.configurations.find((item) => item.id === setup.id && item.revision === setup.revision)
  if (!captured || JSON.stringify(captured) !== JSON.stringify(setup) || !captured.materials.some((item) => item.id === component.id && item.name === component.name)) return workspace
  const old = workspace.mix_adjustment_drafts ?? []
  const index = old.findIndex((item) => item.configuration_id === setup.id && item.configuration_revision === setup.revision && item.component_id === component.id)
  if (index >= 0 && old[index].component_name !== component.name) return workspace
  const previous = index >= 0 ? old[index].values : emptyMixAdjustmentDraft()
  if (field === 'inputMass' && value.startsWith('invalid:') && massOrigin !== 'metric' && massOrigin !== 'us') return workspace
  const { inputMassOrigin: _previousOrigin, ...withoutOrigin } = previous
  const values = field === 'trackedComponent'
    ? { ...previous, trackedComponent: value, inputMin: '', inputMax: '', additionPercent: '', targetMin: '', targetMax: '' }
    : field === 'inputMass'
    ? { ...withoutOrigin, inputMass: value, ...(value.startsWith('invalid:') ? { inputMassOrigin: massOrigin } : {}) }
    : { ...previous, [field]: value }
  const next = { case_id: caseId, configuration_id: setup.id, configuration_revision: setup.revision,
    component_id: component.id, component_name: component.name,
    project_snapshot: index >= 0 ? old[index].project_snapshot : structuredClone(project),
    values,
    ...(index >= 0 && old[index].reference && field !== 'targetMin' && field !== 'targetMax' && field !== 'trackedComponent' ? { reference: old[index].reference } : {}) }
  return { ...workspace, mix_adjustment_drafts: index < 0 ? [...old, next] : old.map((item, i) => i === index ? next : item) }
}

/** Return to the whole material without transferring component-specific percentages. */
export function trackWholeMixMaterial(workspace: ProjectWorkspace, caseId: string, setup: TrialConfiguration, component: { id: string; name: string }, project: ProjectIntakeDraft): ProjectWorkspace {
  const cleared = updateSavedMixAdjustment(workspace, caseId, setup, component, project, 'trackedComponent', '')
  if (cleared === workspace) return workspace
  return { ...cleared, mix_adjustment_drafts: (cleared.mix_adjustment_drafts ?? []).map((draft) => {
    if (draft.configuration_id !== setup.id || draft.configuration_revision !== setup.revision || draft.component_id !== component.id) return draft
    const { trackedComponent: _trackedComponent, ...values } = draft.values
    return { ...draft, values }
  }) }
}

/** Apply an explicitly reviewed whole-recipe point without replacing existing target entries. */
export function useRecordedRecipeTarget(workspace: ProjectWorkspace, caseId: string, setup: TrialConfiguration, component: { id: string; name: string }, project: ProjectIntakeDraft, source: TrialConfiguration, sourceComponent: { id: string; name: string }, capturedLatest: number): ProjectWorkspace {
  if (workspace.case_id !== caseId || JSON.stringify(workspace.project) !== JSON.stringify(project)) return workspace
  const destination = workspace.configurations.find((item) => item.id === setup.id && item.revision === setup.revision)
  const savedSource = workspace.configurations.find((item) => item.id === source.id && item.revision === source.revision)
  const latestDestination = Math.max(...workspace.configurations.filter((item) => item.id === setup.id).map((item) => item.revision))
  const latestSource = Math.max(...workspace.configurations.filter((item) => item.id === source.id).map((item) => item.revision))
  if (!destination || !savedSource || latestDestination !== setup.revision || latestSource !== capturedLatest || JSON.stringify(destination) !== JSON.stringify(setup) || JSON.stringify(savedSource) !== JSON.stringify(source)) return workspace
  if (!destination.materials.some((item) => item.id === component.id && item.name === component.name) || !savedSource.materials.some((item) => item.id === sourceComponent.id && item.name === sourceComponent.name)) return workspace
  const point = recordedRecipeFraction(savedSource, sourceComponent.id)
  if (!point.ok) return workspace
  const target = recordedRecipeTarget(point)
  const old = workspace.mix_adjustment_drafts ?? []
  const index = old.findIndex((item) => item.configuration_id === setup.id && item.configuration_revision === setup.revision && item.component_id === component.id)
  const existing = index >= 0 ? old[index] : undefined
  if (existing?.values.trackedComponent !== undefined) return workspace
  if (existing && (existing.component_name !== component.name || JSON.stringify(existing.project_snapshot) !== JSON.stringify(project) || existing.values.targetMin.trim() || existing.values.targetMax.trim())) return workspace
  const draft: SavedMixAdjustmentDraft = {
    case_id: caseId, configuration_id: setup.id, configuration_revision: setup.revision,
    component_id: component.id, component_name: component.name,
    project_snapshot: existing?.project_snapshot ?? structuredClone(project),
    values: { ...(existing?.values ?? emptyMixAdjustmentDraft()), targetMin: target.min, targetMax: target.max },
    reference: { setup_id: source.id, setup_revision: source.revision, setup_snapshot: JSON.stringify(source), component_id: sourceComponent.id,
      component_name: sourceComponent.name, basis: 'whole_recipe', fraction: target.fraction, latest_revision_at_review: latestSource,
      ...('range' in target ? { range: target.range } : {}) },
  }
  return { ...workspace, mix_adjustment_drafts: index < 0 ? [...old, draft] : old.map((item, i) => i === index ? draft : item) }
}

export function recordedRecipeNeedsReview(workspace: ProjectWorkspace, draft: SavedMixAdjustmentDraft | undefined): boolean {
  const ref = draft?.reference
  if (!ref) return false
  if (draft?.values.trackedComponent !== undefined) return true
  const versions = workspace.configurations.filter((item) => item.id === ref.setup_id)
  const source = versions.find((item) => item.revision === ref.setup_revision)
  const point = source && recordedRecipeFraction(source, ref.component_id)
  const target = point?.ok ? recordedRecipeTarget(point) : null
  return !source || JSON.stringify(source) !== ref.setup_snapshot || !target || target.fraction !== ref.fraction || target.min !== draft?.values.targetMin || target.max !== draft?.values.targetMax || !matchingReferenceRange(ref, target) || Math.max(...versions.map((item) => item.revision)) !== ref.latest_revision_at_review
}

/** Carry the user's reviewed source mapping with the calculation, not as a product claim. */
export function recordedRecipeDiscussion(workspace: ProjectWorkspace, setup: TrialConfiguration, component: { id: string; name: string }, project: ProjectIntakeDraft, sourceName: (setup: TrialConfiguration) => string): string {
  if (JSON.stringify(workspace.project) !== JSON.stringify(project)) return ''
  const savedSetup = workspace.configurations.find((item) => item.id === setup.id && item.revision === setup.revision)
  if (!savedSetup || JSON.stringify(savedSetup) !== JSON.stringify(setup) || Math.max(...workspace.configurations.filter((item) => item.id === setup.id).map((item) => item.revision)) !== setup.revision) return ''
  const draft = savedMixAdjustmentRecord(workspace, setup, component)
  if (!draft?.reference || mixDraftNeedsProjectReview(draft, project) || recordedRecipeNeedsReview(workspace, draft)) return ''
  const ref = draft.reference
  const source = workspace.configurations.find((item) => item.id === ref.setup_id && item.revision === ref.setup_revision)
  if (!source) return ''
  const description = ref.range
    ? `The exact source fraction is ${ref.range.numerator}/${ref.range.denominator} of the whole recipe; the chosen ${ref.range.min}–${ref.range.max}% target is an enclosing rounded range.`
    : `The exact source fraction and chosen target are ${ref.fraction}% of the whole recipe.`
  return `Reference recipe: ${sourceName(source)}, version ${ref.setup_revision}. The user mapped its ${ref.component_name} to ${component.name}. ${description} This identifies the recipe composition.`
}

/** Confirm that the earlier reference is still the one the user intends after a new version. */
export function confirmRecordedRecipeReview(workspace: ProjectWorkspace, caseId: string, setup: TrialConfiguration, component: { id: string; name: string }, project: ProjectIntakeDraft, expectedLatestRevision: number): ProjectWorkspace {
  if (workspace.case_id !== caseId || JSON.stringify(workspace.project) !== JSON.stringify(project)) return workspace
  const destination = workspace.configurations.find((item) => item.id === setup.id && item.revision === setup.revision)
  if (!destination || JSON.stringify(destination) !== JSON.stringify(setup) || Math.max(...workspace.configurations.filter((item) => item.id === setup.id).map((item) => item.revision)) !== setup.revision) return workspace
  const draft = savedMixAdjustmentRecord(workspace, setup, component)
  const ref = draft?.reference
  if (!draft || !ref || JSON.stringify(draft.project_snapshot) !== JSON.stringify(project)) return workspace
  const versions = workspace.configurations.filter((item) => item.id === ref.setup_id)
  const source = versions.find((item) => item.revision === ref.setup_revision)
  const point = source && recordedRecipeFraction(source, ref.component_id)
  const target = point?.ok ? recordedRecipeTarget(point) : null
  if (!source || JSON.stringify(source) !== ref.setup_snapshot || !target || target.fraction !== ref.fraction || draft.values.targetMin !== target.min || draft.values.targetMax !== target.max || !matchingReferenceRange(ref, target)) return workspace
  const latest = Math.max(...versions.map((item) => item.revision))
  if (latest !== expectedLatestRevision) return workspace
  return { ...workspace, mix_adjustment_drafts: (workspace.mix_adjustment_drafts ?? []).map((item) => item === draft ? { ...item, reference: { ...ref, latest_revision_at_review: latest } } : item) }
}

/** Explicit user review binds the same entered numbers to the current project. */
export function confirmSavedMixAdjustment(workspace: ProjectWorkspace, caseId: string, setup: TrialConfiguration, component: { id: string; name: string }, project: ProjectIntakeDraft): ProjectWorkspace {
  if (workspace.case_id !== caseId || JSON.stringify(workspace.project) !== JSON.stringify(project)) return workspace
  const captured = workspace.configurations.find((item) => item.id === setup.id && item.revision === setup.revision)
  if (!captured || JSON.stringify(captured) !== JSON.stringify(setup) || !captured.materials.some((item) => item.id === component.id && item.name === component.name)) return workspace
  const draft = savedMixAdjustmentRecord(workspace, setup, component)
  if (!draft) return workspace
  return { ...workspace, mix_adjustment_drafts: (workspace.mix_adjustment_drafts ?? []).map((item) => item === draft ? { ...item, project_snapshot: structuredClone(project) } : item) }
}

const DECIMAL = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i
/** Percent fields accept a trailing percent sign without rescaling the number. */
function percentText(value: string): string {
  const text = value.trim()
  return text.endsWith('%') ? text.slice(0, -1).trim() : text
}
function decimalParts(value: string): { sign: string; digits: string; exponent: bigint } | null {
  const matched = DECIMAL.exec(value.trim())
  if (!matched) return null
  const fraction = matched[3] ?? matched[4] ?? ''
  let digits = `${matched[2] ?? ''}${fraction}`.replace(/^0+/, '')
  const sign = matched[1] === '-' ? '-' : ''
  if (!digits) return { sign, digits: '0', exponent: 0n }
  const trailing = /0+$/.exec(digits)?.[0].length ?? 0
  if (trailing) digits = digits.slice(0, -trailing)
  return { sign, digits, exponent: BigInt(matched[5] ?? '0') - BigInt(fraction.length) + BigInt(trailing) }
}
function signature(parts: { sign: string; digits: string; exponent: bigint }): string {
  return `${parts.sign}${parts.digits}e${parts.exponent}`
}
/** Check mathematical decimal equality before and after JS/JSON number conversion. */
export function mixDecimalRoundTrips(value: string): boolean {
  const parts = decimalParts(value)
  const parsed = Number(value)
  if (!parts || !Number.isFinite(parsed) || Object.is(parsed, -0)) return false
  const serialized = decimalParts(JSON.stringify(parsed))
  return Boolean(serialized && signature(parts) === signature(serialized))
}
/** Invalid drafts retain their original units and are never reinterpreted on a unit switch. */
export function mixMassEntryState(draft: MixAdjustmentDraft, system: UnitSystem) {
  const text = draft.inputMass
  const invalid = Boolean(text.trim() && !mixDecimalRoundTrips(text))
  const origin = invalid ? draft.inputMassOrigin : undefined
  return {
    invalid,
    locked: invalid && !origin,
    origin,
    enteredUnit: invalid ? (origin ? unitLabel('kg', origin) : 'unit not recorded') : unitLabel('kg', system),
    displayValue: invalid && !text.startsWith('invalid:') ? `invalid:${text}` : text,
  }
}
export function mixMassInputPrecisionProblem(display: string, system: UnitSystem): boolean {
  const parts = decimalParts(display)
  if (!parts || !Number.isFinite(Number(display))) return false
  if (!mixDecimalRoundTrips(display)) return true
  if (system === 'metric' || parts.digits === '0') return false
  const product = `${parts.sign}${BigInt(parts.digits) * 45359237n}e${parts.exponent - 8n}`
  return !mixDecimalRoundTrips(product)
}
/** Convert pounds with exact decimal arithmetic; preserve ambiguous precision as invalid text. */
export function mixMassCanonical(display: string, system: UnitSystem): string {
  if (!display.trim()) return display
  const parts = decimalParts(display)
  if (!parts || !Number.isFinite(Number(display))) return `invalid:${display}`
  if (mixMassInputPrecisionProblem(display, system)) return `invalid:${display}`
  if (system === 'metric' || parts.digits === '0') return display
  const product = `${parts.sign}${BigInt(parts.digits) * 45359237n}e${parts.exponent - 8n}`
  return JSON.stringify(Number(product))
}
export function mixAdjustmentPrecisionProblem(draft: MixAdjustmentDraft, system: UnitSystem): string | null {
  if (draft.inputMass.startsWith('invalid:') && mixMassInputPrecisionProblem(draft.inputMass.slice(8), system)) return 'portion mass'
  for (const [field, label] of [['inputMass','portion mass'], ['inputMin','lowest input percentage'], ['inputMax','highest input percentage'], ['additionPercent','added-stock percentage'], ['targetMin','trial minimum'], ['targetMax','trial maximum']] as const) {
    const value = field === 'inputMass' ? draft[field] : percentText(draft[field])
    if (decimalParts(value) && Number.isFinite(Number(value)) && !mixDecimalRoundTrips(value)) return label
  }
  return null
}
function number(value: string, percent = false): number | null {
  const s = percent ? percentText(value) : value.trim()
  if (!s || !mixDecimalRoundTrips(s)) return null
  const parsed = Number(s)
  if (!Number.isFinite(parsed) || (parsed === 0 && /[1-9]/.test(s.split(/[eE]/)[0]))) return null
  return parsed
}

/** No material fraction, quantity, or target is inferred from the named setup. */
export function mixAdjustmentRequest(component: string, draft: MixAdjustmentDraft): BalanceMixRequest | null {
  const name = component.trim()
  const addition = draft.additionName.trim()
  if (!name || name.length > 160 || !addition || addition.length > 120) return null
  const mass = number(draft.inputMass)
  const sourceMin = number(draft.inputMin, true)
  const sourceMax = number(draft.inputMax, true)
  const added = number(draft.additionPercent, true)
  const targetMin = number(draft.targetMin, true)
  const targetMax = number(draft.targetMax, true)
  const allPercentages = [sourceMin, sourceMax, added, targetMin, targetMax]
  if (mass === null || mass <= 0 || mass > 1_000_000 || allPercentages.some((v) => v === null || v < 0 || v > 100)) return null
  if (sourceMin! > sourceMax! || targetMin! > targetMax!) return null
  return {
    component: name, input_mass_kg: mass, input_min_percent: sourceMin!, input_max_percent: sourceMax!,
    addition_name: addition, addition_percent: added!, target_min_percent: targetMin!, target_max_percent: targetMax!,
  }
}

/** Captures full setup details as well as values, so edits cannot silently reuse an older result. */
export function mixAdjustmentKey(caseId: string, setup: unknown, componentId: string, draft: MixAdjustmentDraft): string {
  return JSON.stringify({ caseId, setup, componentId, draft })
}

export function formatMixMass(value: number, system: UnitSystem): string {
  const shown = toDisplay(String(value), 'kg', system)
  // Never replace a positive calculation with a displayed zero.
  if (value > 0 && Number(shown) === 0) return `${value} kg`
  return system === 'us' ? `approximately ${shown} ${unitLabel('kg', system)} (calculator value: ${value} kg)` : `approximately ${shown} kg`
}

export function mixAdditionKind(minimum: number, maximum: number | null): 'zero_only' | 'zero_optional' | 'one_amount' | 'range' {
  return minimum === 0 ? maximum === 0 ? 'zero_only' : 'zero_optional' : minimum === maximum ? 'one_amount' : 'range'
}
