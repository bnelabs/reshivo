import assert from 'node:assert/strict'
import { buildIdeaComparisonQuestion } from '../src/ideaComparison.ts'

const idea = (title, change) => ({ id: title, title, change, why: 'It separates the layers.',
  steps: ['Review the layout.'], tradeoffs: ['The panel may be thicker.'], check: 'Check the fit.' })
assert.equal(buildIdeaComparisonQuestion([]), '')
const first = idea('Separate layers', 'Keep the layers apart.')
const second = idea('Add pockets', 'Hold the material in pockets.')
const question = buildIdeaComparisonQuestion([first, second])
for (const text of [first.title, first.change, first.why, first.tradeoffs[0], first.check, second.title, second.change, 'conditional choice', 'can work together'])
  assert.ok(question.includes(text), text)
assert.match(buildIdeaComparisonQuestion([first]), /understand this suggested idea/)

const longIdeas = Array.from({ length: 6 }, (_, index) => idea(`Idea ${index + 1}`, `${'long detail '.repeat(120)}ending-${index}-12345.6789`))
const bounded = buildIdeaComparisonQuestion(longIdeas)
assert.ok(bounded.length <= 3000, 'the editable question fits the supported request limit')
for (const route of longIdeas) {
  assert.ok(bounded.includes(route.title), 'all ideas remain identifiable')
  assert.ok(bounded.includes(route.change) || bounded.includes(`${route.title} (details omitted`), 'a change is complete or explicitly omitted')
}
console.log('Idea comparison includes the actual suggestions and keeps long details intact or explicitly omitted')
