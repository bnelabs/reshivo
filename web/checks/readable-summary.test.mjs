import assert from 'node:assert/strict'
import { newProjectWorkspace, newCostDraft } from '../src/projectWorkspace.ts'
import { formatProjectSummary, explainUnreachableMix, formatMixSummary } from '../src/readableSummary.ts'
const field = value => ({ value, source: 'user_review', quote: value })
const w = newProjectWorkspace()
w.project.product = field('Floor mat')
w.project.input = field('HDPE and rubber')
w.configurations = [{ id:'a', revision:1, name:'Layered idea', materials:[{id:'m',name:'HDPE',amount:'5',unit:'kg'}], process:'Heat', geometry:'Flat', notes:'' }]
w.trial_ideas = {'a@1':{ title:'Layered idea', change:'Add a layer', why:'Separate materials', steps:['Shape the layer'], tradeoffs:['More work'], check:'Measure thickness', provider:'meta', model:'example'}}
w.costs['a@1'] = { ...newCostDraft(), currency:'EUR', prices:{m:'2'}, energy_kwh:'999', process_statuses:{energy:'unknown', labor:'excluded'} }
w.checks = [{id:'c',name:'Thickness',unit:'mm',minimum:'4',maximum:'6',method:'Caliper',required:true}]
w.records = [{id:'r',case_id:w.case_id,configuration_id:'a',configuration_revision:1,check_id:'c',unit:'mm',method:'Caliper',data_kind:'synthetic',conditions_confirmed:true,readings:[{value:'5'}]}]
const visible = formatProjectSummary(w,true)
for (const text of ['Floor mat','Shape the layer','Measure thickness','Thickness','example data','Energy: unknown','Labour: excluded','2 EUR/kg']) assert.ok(visible.includes(text),text)
assert.ok(!visible.includes('999'), 'an unknown cost must not expose stale values as known')
const hidden = formatProjectSummary(w,false)
assert.ok(!hidden.includes('Shape the layer'))
assert.ok(!hidden.includes('Layered idea'))
assert.ok(hidden.includes('need review'))
const input = { component:'Mixed plastics', input_mass_kg:16300, input_min_percent:15, input_max_percent:20, addition_name:'HDPE', addition_percent:5, target_min_percent:50, target_max_percent:95 }
const reason = explainUnreachableMix(input)
assert.ok(reason.includes('20%') && reason.includes('5%') && reason.includes('50%'))
const summary = formatMixSummary(input,{feasible:false},'metric')
assert.ok(summary.includes(reason))
assert.ok(summary.includes('16300 kg'))
const usSummary = formatMixSummary(input,{feasible:false},'us')
assert.ok(usSummary.includes('lb (16300 kg)'), 'Imperial report displays selected units and original mass')
console.log('Readable summaries keep plan details, provenance, missing costs, and real mix reasons')

// Exercise the print renderer with a DOM-shaped stub: project content remains text,
// and the report uses the in-app brand and section headings without external assets.
const { printTextReport } = await import('../src/readableSummary.ts')
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.classes = []; this.classList = { add: value => this.classes.push(value) }; this.textContent = '' }
  append(...nodes) { this.children.push(...nodes) }
  appendChild(node) { this.children.push(node); return node }
  setAttribute() {}
  addEventListener() {}
}
const documentStub = {
  head: new Element('head'), body: new Element('body'),
  createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag),
  createTextNode: value => ({ tag: '#text', textContent: value }),
}
let printed = 0
globalThis.window = { open: () => ({ document: documentStub, focus() {}, print() { printed++ } }) }
printTextReport('Reshivo — project summary\n\nProduct: <script>unsafe()</script>\n\nPlans\n\nMy plan — version 1')
const flatten = node => [node, ...(node.children ?? []).flatMap(flatten)]
const nodes = flatten(documentStub.body)
assert.equal(printed, 1)
assert.ok(nodes.some(node => node.tag === 'svg'), 'the report includes the Reshivo mark')
assert.ok(nodes.some(node => node.tag === 'h2' && node.textContent === 'Plans'))
assert.ok(nodes.some(node => node.tag === '#text' && node.textContent.includes('<script>unsafe()</script>')))
assert.ok(!nodes.some(node => node.tag === 'script'), 'user content cannot become executable HTML')
console.log('Printable report preserves branding, hierarchy and safe text rendering')

// A short calculation should stay on one page, while oversized text may flow.
printTextReport('Reshivo — project summary\n\nPlans\n\nReshivo — mix calculation\n\nPortion: 10 kg\nNo single addition fits.')
const shortNodes = flatten(documentStub.body)
assert.ok(shortNodes.some(node => node.tag === 'section' && node.classes.includes('keep-together')))
const beforeLong = documentStub.body.children.length
printTextReport('Reshivo — mix calculation\n\n' + 'x'.repeat(1001))
const longNodes = documentStub.body.children.slice(beforeLong).flatMap(flatten)
assert.ok(!longNodes.some(node => node.tag === 'section' && node.classes.includes('keep-together')))
console.log('Short mix reports stay together while long content can paginate')

const { formatAdviceForReport, formatEarlierAdviceForReport } = await import('../src/readableSummary.ts')
const guidance = formatAdviceForReport({ answer: 'Explore a textured surface.', next_steps: ['Check grip.'], questions: ['What surface?'], material_routes: [{ title: 'Surface layer', change: 'Add a layer.', why: 'Improve texture.', steps: ['Make a sample.'], tradeoffs: ['More work.'], check: 'Check wet grip.' }] })
for (const text of ['Ideas and next steps', 'Explore a textured surface.', 'Surface layer', 'Make a sample.', 'Check wet grip.', 'What surface?']) assert.ok(guidance.includes(text), text)
assert.ok(formatAdviceForReport({ reply: 'Start with a sample.', first_step: 'Identify the mix.' }).includes('Identify the mix.'))
assert.equal(formatAdviceForReport(null), '')
console.log('Reports include current guidance and next actions without inventing results')

// Reading provenance and review state must survive into exports.
w.records[0].conditions_confirmed = false
const reviewPending = formatProjectSummary(w, true)
assert.ok(reviewPending.includes('conditions need review'))
assert.ok(reviewPending.includes('Method: Caliper.'))
w.records[0].conditions_confirmed = true
assert.ok(formatProjectSummary(w, true).includes('conditions reviewed'))
const savedNote = { text: 'An earlier suggestion.', created_at: '2026-11-03T17:00:00Z', kind: 'model_proposal', provider: 'meta', model: 'example' }
const saved = formatEarlierAdviceForReport(savedNote)
assert.ok(saved.includes('Earlier saved guidance') && saved.includes('Readings and costs may have changed') && saved.includes('An earlier suggestion.'))
assert.equal(formatEarlierAdviceForReport(null), '')
console.log('Reports identify reading review state and label earlier saved guidance')
