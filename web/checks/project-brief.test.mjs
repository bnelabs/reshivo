import assert from 'node:assert/strict'
import { briefFrom } from '../src/projectBrief.ts'

const record = value => ({value, source:'user_review', quote:value})
const empty = () => ({ product:null, input:null, variation:null, use:null, priorities:null, process:null, constraints:null })
const d = empty()
d.product = record('Floor mat')
d.input = record('Recycled polypropylene with 3% paper by mass')
d.variation = record('Paper varies from 1% to 3% by mass')
const brief = briefFrom(d)
assert.equal(brief.input, 'Recycled polypropylene with 3% paper by mass')
assert.equal(brief.variation, 'Paper varies from 1% to 3% by mass')
assert.match(brief.contamination, /user’s stated contamination details/)
assert.doesNotMatch(brief.contamination, /not separately characterized/i)
const unknown = briefFrom(empty())
assert.equal(unknown.variation, '')
assert.equal(unknown.contamination, brief.contamination)
console.log('Provider brief preserves named contamination and does not assert missing details are characterized')
