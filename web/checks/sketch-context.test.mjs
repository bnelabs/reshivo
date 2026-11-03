import assert from 'node:assert/strict'
import { newProjectWorkspace } from '../src/projectWorkspace.ts'
import { sketchFingerprint, sketchPrompt } from '../src/sketchContext.ts'
import { appendRectangularSection, parseRectangularSection } from '../src/sectionDrawing.ts'
const field = value => ({ value, source: 'user_review', quote: value })
const w = newProjectWorkspace()
w.project.product = field('Sheet')
w.project.input = field('Fabric')
w.intake_notes = 'Make a sound sheet.'
w.configurations = [{ id:'plan', revision:1, name:'Plan A', materials:[{id:'m',name:'Fabric',amount:'5',unit:'kg'}], process:'Press', geometry:'Rectangular', notes:'Flat' }]
const initial = sketchFingerprint(w, true)
const changed = structuredClone(w); changed.project.input = field('Mixed plastic')
assert.notEqual(sketchFingerprint(changed, true), initial)
changed.project.input = field('Fabric'); changed.configurations[0].geometry = 'Oval'
assert.notEqual(sketchFingerprint(changed, true), initial)
assert.notEqual(sketchFingerprint(w, false), initial)
const section = parseRectangularSection('120', '3', 'cm')
assert.deepEqual(section, {span:'120', thickness:'3', unit:'cm', spanMm:1200, thicknessMm:30})
assert.equal(parseRectangularSection('0', '2', 'mm'), null)
assert.equal(parseRectangularSection('1<script>', '2', 'mm'), null)
const prompt = sketchPrompt(w, 'plan@1', true, section, '')
for (const value of ['Sheet','Fabric','Press','Rectangular','span 120 cm','thickness 3 cm']) assert.ok(prompt.includes(value))
assert.ok(!sketchPrompt(w, 'plan@1', false, null, '').includes('Plan A'))
class Element { constructor(tag) { this.tag = tag; this.children = []; this.attrs = {} } setAttribute(k,v) { this.attrs[k] = v } appendChild(n) { this.children.push(n) } }
const parent = new Element('div')
appendRectangularSection({createElementNS: (_,tag) => new Element(tag)}, parent, section)
const rect = parent.children[0].children.find(child => child.tag === 'rect')
assert.ok(Math.abs(Number(rect.attrs.width) / Number(rect.attrs.height) - 40) < 1e-9)
assert.equal(parent.children[0].children.filter(child => child.tag === 'rect').length, 1)
console.log('Sketch context tracks changes; rectangular section preserves supplied dimensions')
