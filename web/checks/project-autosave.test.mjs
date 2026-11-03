import assert from 'node:assert/strict'
import { createProjectAutosave } from '../src/projectAutosave.ts'
import { newProjectWorkspace } from '../src/projectWorkspace.ts'
class MemoryStorage {
  map = new Map()
  get length() { return this.map.size }
  key(i) { return [...this.map.keys()][i] ?? null }
  getItem(k) { return this.map.get(k) ?? null }
  setItem(k,v) { this.map.set(k,String(v)) }
  removeItem(k) { this.map.delete(k) }
}
const local = new MemoryStorage(), firstTab = new MemoryStorage()
const first = createProjectAutosave(local, firstTab, () => 'tab-one')
assert.equal(first.recovered, null)
const workspace = newProjectWorkspace()
first.save(workspace)
assert.equal(local.length, 0, 'a blank project does not replace recoverable work')
workspace.project.product = {value:'Floor mat',quote:'Floor mat',source:'user_review'}
workspace.intake_notes = 'Ask about this batch.'
workspace.configurations = [{id:'plan',revision:1,name:'Plan',materials:[],process:'',geometry:'',notes:''}]
workspace.checks = [{id:'mass',name:'Mass',unit:'g',method:'scale',minimum:'1',maximum:'2',required:true}]
workspace.records = [{id:'one',case_id:workspace.case_id,configuration_id:'plan',configuration_revision:1,check_id:'mass',unit:'g',method:'scale',data_kind:'user_reported',conditions_confirmed:true,readings:[{value:'1.5'}]}]
first.save(workspace)
const stored = [...local.map.values()].join(' ')
assert.match(stored, /Floor mat/)
assert.doesNotMatch(stored, /api_key|authorization|provider_settings/i)
const reload = createProjectAutosave(local, firstTab, () => 'unused')
assert.equal(reload.recovered.workspace.case_id, workspace.case_id)
assert.equal(reload.recovered.workspace.intake_notes, 'Ask about this batch.')
assert.equal(reload.recovered.workspace.records[0].conditions_confirmed, true, 'same-device recovery preserves the user confirmation')
// A cloned tab obtains the same tab id. Updates after it loads fork on conflict.
const cloneTab = new MemoryStorage(); cloneTab.map = new Map(firstTab.map)
const second = createProjectAutosave(local, cloneTab, () => 'tab-two')
first.save({...workspace, intake_notes:'First tab changes'})
second.save({...workspace, intake_notes:'Second tab changes'})
assert.equal(local.length, 2)
assert.ok([...local.map.values()].some(v=>v.includes('First tab changes')))
assert.ok([...local.map.values()].some(v=>v.includes('Second tab changes')))
// Invalid input never overwrites the last recoverable save.
const previous = [...local.map.values()].join('\n')
assert.throws(() => first.save({...workspace, schema:'not-a-project'}))
assert.equal([...local.map.values()].join('\n'), previous)
const broken = new MemoryStorage(); broken.setItem('reshivo:project-autosave:v1:bad','not json')
assert.equal(createProjectAutosave(broken, new MemoryStorage(), ()=>'new').recovered, null)
const unavailable = new MemoryStorage(); unavailable.setItem=()=>{throw new Error('quota')}
assert.throws(()=>createProjectAutosave(unavailable,new MemoryStorage(),()=> 'new').save(workspace), /quota/)
const freshLocal = new MemoryStorage(), sameTab = new MemoryStorage()
let nextId = 0
const fresh = createProjectAutosave(freshLocal,sameTab,()=> `page-${++nextId}`)
fresh.save(workspace)
fresh.save(newProjectWorkspace(), true)
const afterNew = createProjectAutosave(freshLocal,sameTab,()=> `page-${++nextId}`)
assert.equal(afterNew.recovered,null,'explicitly starting new stays blank after refresh')
const newCase = {...newProjectWorkspace(), project:workspace.project}
afterNew.save(newCase)
assert.equal(freshLocal.length,2,'the earlier project survives starting a new one')
const corruptTab = new MemoryStorage(); corruptTab.setItem('reshivo:project-autosave:tab','bad')
const preserveCorrupt = createProjectAutosave(broken,corruptTab,()=> 'fork')
preserveCorrupt.save(workspace)
assert.equal(broken.getItem('reshivo:project-autosave:v1:bad'),'not json', 'unreadable data is never overwritten')
second.forget(workspace)
assert.equal(local.length,0,'forget removes all copies of the current case')
console.log('Autosave restores project without provider settings and forks conflicting tabs')
