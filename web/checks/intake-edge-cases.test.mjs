import assert from 'node:assert/strict'
import { api } from '../src/api.ts'
import { recentIntakeHistory } from '../src/projectIntake.ts'

// A long answer accepted as a current message must remain valid in the next turn.
const longAnswer = 'a'.repeat(3400)
assert.equal(recentIntakeHistory([{ role: 'user', content: longAnswer }], 'next')[0].content, longAnswer)
assert.equal(recentIntakeHistory([{ role: 'user', content: 'a'.repeat(4000) }], 'next')[0].content.length, 4000)
assert.throws(() => recentIntakeHistory([{ role: 'user', content: 'a'.repeat(4001) }], 'next'), /4,000/)

const originalFetch = globalThis.fetch
try {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  await assert.rejects(api('/api/project/intake', {}), /Could not connect.*project is still here/)
  globalThis.fetch = async () => new Response('<html>unavailable</html>', { status: 502 })
  await assert.rejects(api('/api/project/intake', {}), /service could not complete.*502.*project is still here/)
  globalThis.fetch = async () => new Response('not json', { status: 200 })
  await assert.rejects(api('/api/project/intake', {}), /reply could not be read.*project is still here/)
  globalThis.fetch = async () => new Response(JSON.stringify({error:{message:'Connect your AI provider.'}}), { status: 401 })
  await assert.rejects(api('/api/project/intake', {}), /Connect your AI provider/)
  const controller = new AbortController()
  controller.abort()
  const aborted = new DOMException('Aborted', 'AbortError')
  globalThis.fetch = async () => { throw aborted }
  await assert.rejects(api('/api/project/intake', {}, controller.signal), error => error === aborted)
} finally { globalThis.fetch = originalFetch }
console.log('Intake preserves accepted long answers across turns and API failures give a recoverable message')
