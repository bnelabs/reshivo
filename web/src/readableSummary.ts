import { currentConfigurations } from './projectWorkspace.ts'
import type { ProjectWorkspace, ProjectAdviceNote } from './projectWorkspace.ts'
import { safeSetupName } from './savedGuidanceReview.ts'
import { describeMixOutcome } from './mixCandidate.ts'
import type { BalanceMixRequest, BalanceMixResult } from './types'
import { toDisplay } from './unitConversion.ts'
import type { UnitSystem } from './unitConversion.ts'
import { appendRectangularSection, parseRectangularSection } from './sectionDrawing.ts'
import type { RectangularSection } from './sectionDrawing.ts'

const shown = (value: string | null | undefined) => value?.trim() || 'Not entered'

/** A readable record, separate from the JSON backup; it does not invent calculated results. */
export function formatProjectSummary(workspace: ProjectWorkspace, includeIdeas: boolean): string {
  const lines = ['Reshivo — project summary', '']
  for (const [label, field] of [
    ['Product', 'product'], ['Materials', 'input'], ['What changes', 'variation'],
    ['Use', 'use'], ['What matters', 'priorities'], ['Process', 'process'], ['Constraints', 'constraints'],
  ] as const) lines.push(`${label}: ${shown(workspace.project[field]?.value)}`)
  lines.push('', 'Plans')
  const setups = workspace.configurations
  const current = new Set(currentConfigurations(workspace).map((setup) => `${setup.id}@${setup.revision}`))
  if (!setups.length) lines.push('No plans recorded yet.')
  for (const [index, setup] of setups.entries()) {
    const name = includeIdeas ? setup.name : safeSetupName(workspace, setup, `Plan ${index + 1}`)
    lines.push('', `${shown(name)} — version ${setup.revision}`)
    if (!current.has(`${setup.id}@${setup.revision}`)) lines.push('Earlier version')
    if (!setup.materials.length) lines.push('Materials: Not entered')
    for (const material of setup.materials) lines.push(`- ${shown(material.name)}: ${shown(material.amount)}${material.amount.trim() ? ` ${material.unit.replaceAll('_', ' ')}` : ''}`)
    lines.push(`Process: ${shown(setup.process)}`, `Shape and size: ${shown(setup.geometry)}`)
    const idea = includeIdeas ? workspace.trial_ideas?.[`${setup.id}@${setup.revision}`] : undefined
    const linkedIdea = Boolean(workspace.trial_ideas?.[`${setup.id}@${setup.revision}`] || setup.notes.startsWith('Unverified trial idea:'))
    if (setup.notes.trim() && (includeIdeas || !linkedIdea)) lines.push(`Plan notes: ${setup.notes}`)
    if (idea) {
      lines.push(`Idea source: ${idea.provider} / ${idea.model}`, `Suggested change: ${idea.change}`, `Why: ${idea.why}`, 'Steps to consider:')
      idea.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`))
      lines.push(`Trade-offs: ${idea.tradeoffs.join(' ')}`, `Next check: ${idea.check}`)
    }
    const cost = workspace.costs[`${setup.id}@${setup.revision}`]
    if (cost) {
      lines.push(`Cost inputs (${shown(cost.currency)}; ${cost.mode === 'planned' ? 'planned' : 'actual'}):`)
      for (const [label, value] of [
        ['Cost basis', cost.mass_basis], ['Product and use', cost.functional_basis],
        ['What counts as usable', cost.acceptance_basis], ['Batch mass (kg)', cost.batch_mass_kg],
      ]) if (value?.trim()) lines.push(`${label}: ${value}`)
      for (const material of setup.materials) {
        const price = cost.prices[material.id]
        lines.push(`- ${shown(material.name)}: ${shown(price)}${price?.trim() ? ` ${cost.currency}/${cost.price_units?.[material.id] ?? 'kg'}` : ''}`)
      }
      const energy = cost.process_statuses?.energy ?? 'unknown'
      const labor = cost.process_statuses?.labor ?? 'unknown'
      const other = cost.process_statuses?.other ?? 'unknown'
      lines.push(energy === 'known' ? `- Energy: ${shown(cost.energy_kwh)} kWh at ${shown(cost.energy_rate)} ${cost.currency}/kWh` : `- Energy: ${energy}`)
      lines.push(labor === 'known' ? `- Labour: ${shown(cost.labor_hours)} hours at ${shown(cost.labor_rate)} ${cost.currency}/hour` : `- Labour: ${labor}`)
      lines.push(other === 'known' ? `- ${shown(cost.other_name)}: ${shown(cost.other_charge)} ${cost.currency}` : `- Other charge: ${other}`)
      const output = cost.mode === 'actual'
        ? [['Usable items', cost.usable_count], ['Usable mass (kg)', cost.usable_mass_kg], ['Usable area (m²)', cost.usable_area_m2]]
        : [['Planned items', cost.gross_count], ['Planned mass (kg)', cost.gross_mass_kg], ['Planned area (m²)', cost.gross_area_m2], ['Expected usable fraction', cost.accepted_fraction]]
      for (const [label, value] of output) if (value?.trim()) lines.push(`${label}: ${value}`)
    }
  }
  if (!includeIdeas && Object.keys(workspace.trial_ideas ?? {}).length) lines.push('', 'Some saved suggestions need review in the app before they can be included.')
  lines.push('', 'Product checks')
  if (!workspace.checks.length) lines.push('No product checks recorded yet.')
  for (const check of workspace.checks) {
    lines.push(`- ${shown(check.name)} (${shown(check.unit)}): minimum ${shown(check.minimum)}, maximum ${shown(check.maximum)}; ${check.required ? 'required' : 'optional'}. Method: ${shown(check.method)}.`)
  }
  lines.push('', 'Recorded readings')
  if (!workspace.records.length) lines.push('No readings recorded yet.')
  for (const record of workspace.records) {
    const setup = workspace.configurations.find((item) => item.id === record.configuration_id && item.revision === record.configuration_revision)
    const check = workspace.checks.find((item) => item.id === record.check_id)
    const name = setup ? (includeIdeas ? setup.name : safeSetupName(workspace, setup, 'Plan')) : 'Unknown plan'
    const excluded = workspace.record_exclusions?.[record.id]
    lines.push(`- ${shown(name)} v${record.configuration_revision} / ${shown(check?.name)}: ${record.readings.map((reading) => shown(reading.value)).join(', ')} ${record.unit} (${record.data_kind === 'synthetic' ? 'example data' : 'entered readings'}; ${record.conditions_confirmed ? 'conditions reviewed' : 'conditions need review'}${excluded ? '; excluded from comparisons' : ''}). Method: ${shown(record.method)}.`)
    if (excluded) lines.push(`  Exclusion reason: ${excluded}`)
    if (record.readings.some((reading) => reading.reading_id || reading.specimen_id || reading.run_id || reading.batch_id || reading.repeat_of)) {
      record.readings.forEach((reading, index) => {
        const groups = [
          ['Reading ID', reading.reading_id], ['Specimen', reading.specimen_id], ['Run', reading.run_id],
          ['Batch', reading.batch_id], ['Repeat of', reading.repeat_of],
        ].filter(([, value]) => value?.trim()).map(([label, value]) => `${label}: ${value}`)
        lines.push(`  Reading ${index + 1}: ${shown(reading.value)} ${record.unit}${groups.length ? `; ${groups.join('; ')}` : ''}`)
      })
    }
  }
  lines.push('')
  return lines.join('\n')
}

/** Keep the user's discussion in an appendix after the current project and guidance. */
export function formatProjectNotes(workspace: ProjectWorkspace): string {
  return workspace.intake_notes?.trim() ? `\nProject notes\nEarlier discussion provided by you:\n${workspace.intake_notes.trim()}\n` : ''
}

function deduplicateResultQuestions(text: string): string {
  const seen = new Set<string>()
  return text.split('\n').filter((line) => {
    if (/^.+ · version \d+(?::|$)/.test(line) || ['Check results', 'Cost result', 'Cost comparison'].includes(line)) seen.clear()
    const question = line.trim()
    if (!question.includes('?')) return true
    if (seen.has(question)) return false
    seen.add(question)
    return true
  }).join('\n')
}

/** A focused printable report. The caller supplies only guidance and results that are current. */
export function formatPrintableProjectReport(
  workspace: ProjectWorkspace,
  includeIdeas: boolean,
  guidance: string,
  mixSummary: string,
  results: string,
): string {
  const lines = ['Reshivo — project summary']
  const add = (label: string, value: string | null | undefined) => {
    if (value?.trim()) lines.push(`${label}: ${value.trim()}`)
  }
  // Keep the product line near the top: the print renderer also uses it as the title.
  add('Product', workspace.project.product?.value)
  const setups = currentConfigurations(workspace)
  // Drop a route card only when that exact reviewed idea is already in a current
  // plan below; other current alternatives and follow-up questions remain useful.
  const savedCards = new Set(includeIdeas ? setups.flatMap((setup) => {
    const idea = workspace.trial_ideas?.[`${setup.id}@${setup.revision}`]
    if (!idea) return []
    const formatted = formatAdviceForReport({ material_routes: [idea] })
    const start = formatted.indexOf('Idea: ')
    return start < 0 ? [] : [formatted.slice(start).trim()]
  }) : [])
  const guidanceLines = guidance.trim().split('\n')
  const keptGuidance: string[] = []
  for (let i = 0; i < guidanceLines.length;) {
    if (!guidanceLines[i].startsWith('Idea: ')) { keptGuidance.push(guidanceLines[i++]); continue }
    const card: string[] = [guidanceLines[i++]]
    while (i < guidanceLines.length && !guidanceLines[i].startsWith('Idea: ') && guidanceLines[i] !== 'Questions to answer:') card.push(guidanceLines[i++])
    if (!savedCards.has(card.join('\n').trim())) keptGuidance.push(...card)
  }
  const printableGuidance = keptGuidance.join('\n').trim()
  if (printableGuidance) lines.push('', printableGuidance)
  const plansWithIdeas = includeIdeas ? setups.filter((setup) => workspace.trial_ideas?.[`${setup.id}@${setup.revision}`]) : []
  if (plansWithIdeas.length) {
    lines.push('', 'Plans to explore')
    for (const setup of plansWithIdeas) {
      lines.push('', `${shown(setup.name)} — version ${setup.revision}`)
      const idea = workspace.trial_ideas?.[`${setup.id}@${setup.revision}`]
      if (idea) {
        if (idea.provider && idea.model) lines.push(`Idea source: ${idea.provider} / ${idea.model}`)
        add('Approach', idea.change)
        add('Why', idea.why)
        if (idea.steps.length) {
          lines.push('Steps:')
          idea.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`))
        }
        add('Next check', idea.check)
        add('Trade-offs', idea.tradeoffs.join(' '))
      }
    }
  }
  if (mixSummary.trim()) lines.push('', mixSummary.trim())
  if (results.trim()) lines.push('', deduplicateResultQuestions(results.trim()))

  lines.push('', 'Project details')
  for (const [label, field] of [
    ['Materials', 'input'], ['What changes', 'variation'], ['Use', 'use'],
    ['What matters', 'priorities'], ['Process', 'process'], ['Constraints', 'constraints'],
  ] as const) add(label, workspace.project[field]?.value)
  for (const [index, setup] of setups.entries()) {
    const name = includeIdeas ? setup.name : safeSetupName(workspace, setup, `Plan ${index + 1}`)
    lines.push('', `${shown(name)} — version ${setup.revision}`)
    for (const material of setup.materials) {
      if (material.name.trim()) lines.push(`- ${material.name.trim()}${material.amount.trim() ? `: ${material.amount.trim()} ${material.unit.replaceAll('_', ' ')}` : ': Amount not entered'}`)
    }
    add('Process', setup.process)
    add('Shape and size', setup.geometry)
    const linkedIdea = Boolean(workspace.trial_ideas?.[`${setup.id}@${setup.revision}`] || setup.notes.startsWith('Unverified trial idea:'))
    if (setup.notes.trim() && (includeIdeas || !linkedIdea)) add('Plan notes', setup.notes)
    const cost = workspace.costs[`${setup.id}@${setup.revision}`]
    if (cost) {
      lines.push(`Cost inputs (${shown(cost.currency)}; ${cost.mode === 'planned' ? 'planned' : 'actual'}):`)
      for (const [label, value] of [
        ['Cost basis', cost.mass_basis], ['Product and use', cost.functional_basis],
        ['What counts as usable', cost.acceptance_basis], ['Batch mass (kg)', cost.batch_mass_kg],
      ]) add(label, value)
      for (const material of setup.materials) {
        const price = cost.prices[material.id]
        lines.push(price?.trim() ? `- ${shown(material.name)}: ${price.trim()} ${cost.currency}/${cost.price_units?.[material.id] ?? 'kg'}` : `- ${shown(material.name)}: price not entered`)
      }
      for (const [label, key, detail] of [
        ['Energy', 'energy', `${shown(cost.energy_kwh)} kWh at ${shown(cost.energy_rate)} ${cost.currency}/kWh`],
        ['Labour', 'labor', `${shown(cost.labor_hours)} hours at ${shown(cost.labor_rate)} ${cost.currency}/hour`],
        ['Other charge', 'other', `${shown(cost.other_name)}: ${shown(cost.other_charge)} ${cost.currency}`],
      ] as const) {
        const status = cost.process_statuses?.[key] ?? 'unknown'
        lines.push(`- ${label}: ${status === 'known' ? detail : status}`)
      }
      const output = cost.mode === 'actual'
        ? [['Usable items', cost.usable_count], ['Usable mass (kg)', cost.usable_mass_kg], ['Usable area (m²)', cost.usable_area_m2]]
        : [['Planned items', cost.gross_count], ['Planned mass (kg)', cost.gross_mass_kg], ['Planned area (m²)', cost.gross_area_m2], ['Expected usable fraction', cost.accepted_fraction]]
      for (const [label, value] of output) add(label, value)
    }
  }
  if (workspace.checks.length) {
    lines.push('', 'Product checks')
    for (const check of workspace.checks) {
      const bounds = [check.minimum?.trim() ? `minimum ${check.minimum}` : '', check.maximum?.trim() ? `maximum ${check.maximum}` : ''].filter(Boolean).join(', ')
      lines.push(`- ${shown(check.name)} (${shown(check.unit)})${bounds ? `: ${bounds}` : ''}; ${check.required ? 'required' : 'optional'}.`)
      add('Method', check.method)
    }
  }
  const currentKeys = new Set(setups.map((setup) => `${setup.id}@${setup.revision}`))
  const readingKeys = new Set(workspace.records.map((record) => `${record.configuration_id}@${record.configuration_revision}`))
  const earlierWithReadings = workspace.configurations.filter((setup) => {
    const key = `${setup.id}@${setup.revision}`
    return !currentKeys.has(key) && readingKeys.has(key)
  })
  if (earlierWithReadings.length) {
    lines.push('', 'Earlier plans with readings')
    for (const [index, setup] of earlierWithReadings.entries()) {
      const name = includeIdeas ? setup.name : safeSetupName(workspace, setup, `Plan ${index + 1}`)
      lines.push('', `${shown(name)} — version ${setup.revision}`)
      for (const material of setup.materials) {
        if (material.name.trim()) lines.push(`- ${material.name.trim()}${material.amount.trim() ? `: ${material.amount.trim()} ${material.unit.replaceAll('_', ' ')}` : ': Amount not entered'}`)
      }
      add('Process', setup.process)
      add('Shape and size', setup.geometry)
    }
  }
  if (workspace.records.length) {
    lines.push('', 'Recorded readings')
    for (const record of workspace.records) {
      const setup = workspace.configurations.find((item) => item.id === record.configuration_id && item.revision === record.configuration_revision)
      const check = workspace.checks.find((item) => item.id === record.check_id)
      const name = setup ? (includeIdeas ? setup.name : safeSetupName(workspace, setup, 'Plan')) : 'Unknown plan'
      const excluded = workspace.record_exclusions?.[record.id]
      lines.push(`- ${shown(name)} v${record.configuration_revision} / ${shown(check?.name)}: ${record.readings.map((reading) => shown(reading.value)).join(', ')} ${record.unit} (${record.data_kind === 'synthetic' ? 'example data' : 'entered readings'}; ${record.conditions_confirmed ? 'conditions reviewed' : 'conditions need review'}${excluded ? '; excluded from comparisons' : ''}).`)
      add('Method', record.method)
      if (excluded) add('Exclusion reason', excluded)
      record.readings.forEach((reading, index) => {
        const groups = [
          ['Reading ID', reading.reading_id], ['Specimen', reading.specimen_id], ['Run', reading.run_id],
          ['Batch', reading.batch_id], ['Repeat of', reading.repeat_of],
        ].filter(([, value]) => value?.trim()).map(([label, value]) => `${label}: ${value}`)
        if (groups.length) lines.push(`  Reading ${index + 1}: ${shown(reading.value)} ${record.unit}; ${groups.join('; ')}`)
      })
    }
  }
  if (workspace.intake_notes?.trim()) lines.push('', 'Project notes', workspace.intake_notes.trim())
  return `${lines.join('\n')}\n`
}

/** Include only guidance the caller has confirmed is current and visible. */
export function formatAdviceForReport(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const data = value as Record<string, unknown>
  const text = (input: unknown): string => typeof input === 'string' ? input.trim() : ''
  const entries = (input: unknown): string[] => Array.isArray(input) ? input.map(text).filter(Boolean) : []
  const answer = text(data.answer) || text(data.reply)
  const firstStep = text(data.first_step)
  const steps = entries(data.next_steps)
  const questions = entries(data.questions)
  const routes = [...(Array.isArray(data.material_routes) ? data.material_routes : []),
    ...(Array.isArray(data.engineering_routes) ? data.engineering_routes : [])]
  if (!answer && !firstStep && !steps.length && !questions.length && !routes.length) return ''
  const lines = ['', 'Ideas and next steps']
  const local = data.origin === 'local' || data.guidance_origin === 'local' || data.result_kind === 'local_planning_guidance'
  const provider = text(data.provider), model = text(data.model)
  if (local) lines.push('Source: Local planning guidance')
  else if (provider && model) lines.push(`Source: ${provider} / ${model}`)
  if (answer) lines.push(answer)
  if (firstStep) lines.push(`First step: ${firstStep}`)
  if (steps.length) { lines.push('Next actions:'); steps.forEach((step) => lines.push(`- ${step}`)) }
  for (const route of routes) {
    if (!route || typeof route !== 'object' || Array.isArray(route)) continue
    const item = route as Record<string, unknown>
    const title = text(item.title), change = text(item.change), why = text(item.why), check = text(item.check)
    if (title) lines.push('', `Idea: ${title}`)
    if (change) lines.push(`What to try: ${change}`)
    if (why) lines.push(`Why: ${why}`)
    entries(item.steps).forEach((step) => lines.push(`- ${step}`))
    entries(item.tradeoffs).forEach((tradeoff) => lines.push(`Trade-off: ${tradeoff}`))
    if (check) lines.push(`What to check: ${check}`)
  }
  if (questions.length) { lines.push('', 'Questions to answer:'); questions.forEach((question) => lines.push(`- ${question}`)) }
  return lines.join('\n') + '\n'
}

/** A saved note is historical: configuration, readings and costs may have changed. */
export function formatEarlierAdviceForReport(note: ProjectAdviceNote | null | undefined): string {
  if (!note || !note.text.trim()) return ''
  const date = note.created_at.slice(0, 16).replace('T', ' ')
  const source = note.kind === 'local_guidance' ? 'Local planning guidance' : `${note.provider} / ${note.model}`
  return `\nEarlier saved guidance\nSaved ${date} UTC · ${source}\nReadings and costs may have changed since this guidance.\n${note.text.trim()}\n`
}

/** Explain only what follows from the entered composition values. */
export function explainUnreachableMix(input: BalanceMixRequest): string | null {
  if (Math.max(input.input_max_percent, input.addition_percent) < input.target_min_percent)
    return `Your starting mix has at most ${input.input_max_percent}% ${input.component}, and the material you add has ${input.addition_percent}%. Both are below your minimum of ${input.target_min_percent}%, so mixing them cannot reach that target. Consider adding material with a higher share of ${input.component}, or change your target.`
  if (Math.min(input.input_min_percent, input.addition_percent) > input.target_max_percent)
    return `Your starting mix has at least ${input.input_min_percent}% ${input.component}, and the material you add has ${input.addition_percent}%. Both are above your maximum of ${input.target_max_percent}%, so mixing them cannot reach that target. Consider adding material with a lower share of ${input.component}, or change your target.`
  return null
}

export function formatMixSummary(input: BalanceMixRequest, result: BalanceMixResult, system: UnitSystem, plan?: { name: string; revision: number }): string {
  return [
    'Reshivo — mix calculation', '', ...(plan ? [`Plan: ${plan.name} · version ${plan.revision}`] : []), `Material tracked: ${input.component}`,
    `Portion: ${system === 'us' ? `about ${toDisplay(String(input.input_mass_kg), 'kg', system)} lb (${input.input_mass_kg} kg)` : `${input.input_mass_kg} kg`}; ${input.input_min_percent}–${input.input_max_percent}% ${input.component}`,
    `Added material: ${input.addition_name}; ${input.addition_percent}% ${input.component}`,
    `Chosen composition: ${input.target_min_percent}–${input.target_max_percent}%`, '',
    result.feasible ? describeMixOutcome(result, system) : explainUnreachableMix(input) ?? describeMixOutcome(result, system),
    '', 'Simulation assumes even mixing and no losses. The finished product still needs its own checks.', '',
  ].join('\n')
}

export function downloadTextFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = name
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** User-controlled print dialog supports paper or Save as PDF without a remote service. */
export function printTextReport(text: string, sketch?: string | null, sectionDrawing?: RectangularSection | null): void {
  const report = window.open('', '_blank')
  if (!report) throw new Error('Allow pop-ups to open the printable report, then try again.')
  const doc = report.document
  const mixOnly = text.startsWith('Reshivo — mix calculation')
  doc.title = mixOnly ? 'Reshivo mix calculation' : 'Reshivo project report'
  const style = doc.createElement('style')
  style.textContent = `
    @page { margin: 15mm 17mm 17mm; }
    * { box-sizing: border-box; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; color: #20342d; background: #eef2ed; font: 14px/1.52 Inter, Arial, sans-serif; }
    .actions { max-width: 880px; margin: 22px auto 12px; padding: 0 24px; }
    button { background: #154b3e; color: white; border: 0; border-radius: 6px; padding: 11px 17px; font: inherit; font-weight: 600; cursor: pointer; }
    main { max-width: 880px; margin: 0 auto 30px; padding: 44px 56px 48px; background: #fff; box-shadow: 0 8px 28px #173f3514; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-bottom: 18px; border-bottom: 1px solid #d9e5dc; }
    .brand { display: flex; align-items: center; gap: 9px; color: #163d33; font-size: 22px; font-weight: 700; letter-spacing: -.8px; }
    .brand svg { width: 29px; height: 29px; flex: none; }
    .report-label { color: #637b6c; font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; }
    .hero { position: relative; margin-top: 23px; padding: 26px 28px 28px; color: #fff; background: #16483b; border-radius: 5px; overflow: hidden; break-inside: avoid; }
    .hero::after { content: ''; position: absolute; right: 0; bottom: 0; width: 24%; height: 6px; background: #9ac27f; }
    .eyebrow { margin: 0 0 8px; color: #c4ddbb; font-size: 10px; letter-spacing: 1.35px; font-weight: 700; text-transform: uppercase; }
    h1 { position: relative; margin: 0; color: #fff; font-size: 28px; line-height: 1.16; letter-spacing: -.6px; overflow-wrap: anywhere; }
    .hero-subtitle { margin: 8px 0 0; color: #d9ebe0; font-size: 12px; }
    section { margin-top: 24px; }
    h2 { margin: 0 0 12px; padding-bottom: 8px; border-bottom: 1px solid #dce8df; color: #173f35; font-size: 16px; letter-spacing: -.15px; break-after: avoid; }
    h3 { margin: 17px 0 8px; color: #173f35; font-size: 14px; break-after: avoid; }
    .line { margin: 5px 0; overflow-wrap: anywhere; white-space: pre-wrap; orphans: 2; widows: 2; }
    .key { color: #4f6b5d; font-weight: 650; }
    .item { padding-left: 13px; text-indent: -13px; }
    .spacer { height: 4px; }
    .visuals { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 23px; break-inside: avoid; }
    figure { margin: 0; padding: 14px; border: 1px solid #d9e6dc; background: #f6f9f4; border-radius: 5px; break-inside: avoid; }
    img { display: block; max-width: 100%; max-height: 78mm; margin: auto; object-fit: contain; }
    figcaption { margin-top: 8px; color: #526d5f; font-size: 11px; }
    footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #d8e3da; color: #718078; font-size: 10px; }
    @media print { section.keep-together { break-inside: avoid; } body { background: white; font-size: 10pt; line-height: 1.4; } .actions { display: none; } main { max-width: none; margin: 0; padding: 0; box-shadow: none; } .hero { margin-top: 18px; padding: 20px 23px 23px; } h1 { font-size: 23pt; } section { margin-top: 15px; } .line { margin: 4px 0; } }
  `
  doc.head.appendChild(style)
  const actions = doc.createElement('div'); actions.className = 'actions'
  const button = doc.createElement('button'); button.type = 'button'; button.textContent = 'Print / Save as PDF'
  button.addEventListener('click', () => report.print()); actions.appendChild(button)
  const main = doc.createElement('main')
  const header = doc.createElement('header')
  const brand = doc.createElement('div'); brand.className = 'brand'
  const ns = 'http://www.w3.org/2000/svg'
  const mark = doc.createElementNS(ns, 'svg'); mark.setAttribute('viewBox', '0 0 128 128'); mark.setAttribute('aria-hidden', 'true')
  for (const [fill, path] of [
    ['#173f35', 'M22 13h43L49 54H13V22a9 9 0 0 1 9-9Z'],
    ['#80ad70', 'M72 13h34a9 9 0 0 1 9 9v34H57L72 13Z'],
    ['#80ad70', 'M13 61h39l16 54H22a9 9 0 0 1-9-9V61Z'],
    ['#173f35', 'M59 63h56v43a9 9 0 0 1-9 9H75L59 63Z'],
  ]) { const part = doc.createElementNS(ns, 'path'); part.setAttribute('fill', fill); part.setAttribute('d', path); mark.appendChild(part) }
  const brandName = doc.createElement('span'); brandName.textContent = 'Reshivo'; brand.append(mark, brandName)
  const reportLabel = doc.createElement('span'); reportLabel.className = 'report-label'; reportLabel.textContent = mixOnly ? 'Mix calculation' : 'Project report'
  header.append(brand, reportLabel)
  const hero = doc.createElement('div'); hero.className = 'hero'
  const eyebrow = doc.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = mixOnly ? 'Your calculation' : 'Material to product'
  const product = text.split('\n').find((line) => line.startsWith('Product: '))?.slice('Product: '.length).trim()
  const title = doc.createElement('h1'); title.textContent = mixOnly ? 'Mix calculation' : product && product !== 'Not entered' ? product : 'Project report'
  const subtitle = doc.createElement('p'); subtitle.className = 'hero-subtitle'; subtitle.textContent = mixOnly ? 'Inputs and calculated result' : 'Your materials, plans and product checks'
  hero.append(eyebrow, title, subtitle); main.append(header, hero)
  let picture: HTMLImageElement | null = null
  const visuals = doc.createElement('div'); visuals.className = 'visuals'
  let hasVisual = false
  if (sketch && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sketch)) {
    const figure = doc.createElement('figure'); picture = doc.createElement('img')
    picture.alt = 'Generated product concept'; picture.src = sketch
    const caption = doc.createElement('figcaption'); caption.textContent = 'AI-generated concept; details are not verified.'
    figure.append(picture, caption); visuals.appendChild(figure); hasVisual = true
  }
  const section = sectionDrawing && parseRectangularSection(sectionDrawing.span, sectionDrawing.thickness, sectionDrawing.unit)
  if (section) {
    const figure = doc.createElement('figure')
    appendRectangularSection(doc, figure, section)
    const caption = doc.createElement('figcaption'); caption.textContent = 'Rectangular section from your dimensions.'
    figure.appendChild(caption); visuals.appendChild(figure); hasVisual = true
  }
  if (hasVisual) main.appendChild(visuals)
  let reportSection = doc.createElement('section')
  if (mixOnly) { const firstHeading = doc.createElement('h2'); firstHeading.textContent = 'Your inputs'; reportSection.appendChild(firstHeading) }
  main.appendChild(reportSection)
  const headings = new Set(['Plans', 'Plans to explore', 'Project details', 'Earlier plans with readings', 'Product checks', 'Recorded readings', 'Ideas and next steps', 'Ideas compared', 'Earlier saved guidance', 'Project notes', 'Cost results', 'Decision results', 'Cost result', 'Cost comparison', 'Check results'])
  const lines = text.split('\n')
  const mixStart = mixOnly ? 0 : lines.indexOf('Reshivo — mix calculation')
  const mixLines = mixStart >= 0 ? lines.slice(mixStart).filter((line) => line.trim()) : []
  const keepMixTogether = mixLines.length <= 14 && mixLines.join('').length <= 1000
  if (mixOnly && keepMixTogether) reportSection.classList.add('keep-together')
  if (lines[0] === 'Reshivo — project summary' || lines[0] === 'Reshivo — mix calculation') lines.shift()
  for (const line of lines) {
    if (!mixOnly && line.startsWith('Product: ')) continue // Already shown in the title.
    const sectionName = line === 'Reshivo — mix calculation' ? 'Mix calculation' : line
    if (headings.has(line) || line === 'Reshivo — mix calculation') {
      reportSection = doc.createElement('section')
      if (line === 'Reshivo — mix calculation' && keepMixTogether) reportSection.classList.add('keep-together')
      const heading = doc.createElement('h2'); heading.textContent = sectionName
      reportSection.appendChild(heading); main.appendChild(reportSection); continue
    }
    if (!line.trim()) { const spacer = doc.createElement('div'); spacer.className = 'spacer'; reportSection.appendChild(spacer); continue }
    if (/ — version \d+$/.test(line)) { const heading = doc.createElement('h3'); heading.textContent = line; reportSection.appendChild(heading); continue }
    const row = doc.createElement('p'); row.className = 'line'
    if (line.startsWith('- ')) row.classList.add('item')
    const separator = line.indexOf(': ')
    if (separator > 0 && separator < 60) {
      const label = doc.createElement('span'); label.className = 'key'; label.textContent = line.slice(0, separator + 1)
      row.append(label, doc.createTextNode(line.slice(separator + 1)))
    } else row.textContent = line
    reportSection.appendChild(row)
  }
  const footer = doc.createElement('footer'); footer.textContent = 'Reshivo · Project report'
  main.appendChild(footer); doc.body.append(actions, main)
  report.focus()
  if (picture && !picture.complete) {
    picture.addEventListener('load', () => report.print(), { once: true })
    picture.addEventListener('error', () => report.print(), { once: true })
  } else report.print()
}
