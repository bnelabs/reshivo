import assert from 'node:assert/strict'
import { newProjectWorkspace } from '../src/projectWorkspace.ts'
import { safeSetupName, savedGuidanceTexts } from '../src/savedGuidanceReview.ts'

const w = newProjectWorkspace()
const setup = { id:'a', revision:1, name:'Saved title', notes:'Unverified trial idea: Saved title. details', materials:[], process:'', geometry:'' }
w.configurations = [setup]
w.trial_ideas = { 'a@1': { title:'Saved title', change:'change', why:'reason', steps:['step'], tradeoffs:['tradeoff'], check:'check', provider:'fixture', model:'fixture' } }
w.advice_notes = [
  { kind:'model_proposal', text:'First saved note' },
  { kind:'local_guidance', text:'Imported local note also needs review' },
]
const texts = savedGuidanceTexts(w)
assert.equal(texts.length, 4)
assert.ok(texts.includes('First saved note'))
assert.ok(texts.includes('Imported local note also needs review'))
assert.ok(texts.some((text) => text.includes('Saved title') && text.includes('check')))
assert.ok(texts.includes(setup.notes))
assert.equal(safeSetupName(w, setup, 'Trial setup'), 'Trial setup')
assert.equal(safeSetupName(w, { ...setup, name:'User name', notes:'User note' }, 'Trial setup'), 'User name')
console.log('Saved notes, ideas and copied idea notes are screened and copied titles can be masked')
