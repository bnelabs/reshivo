import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root, configFile: false, server: { middlewareMode: true }, appType: 'custom' })
try {
  const { CheckedMixAdvice } = await server.ssrLoadModule('/src/components/CheckedMixAdvice.tsx')
  const bounds = { min: { numerator: '15', denominator: '17' }, max: { numerator: '15', denominator: '13' }, example: { numerator: '225', denominator: '221' } }
  const display = (props) => renderToStaticMarkup(React.createElement(CheckedMixAdvice, props))
  const metric = display({ feasible: true, bounds, stock: '5%-A stock', system: 'metric' })
  assert.match(metric, /0\.89 kg/)
  assert.match(display({ feasible: true, bounds, stock: 'clean HDPE', system: 'metric', component: 'paper', targetMin: 0, targetMax: 2.9 }), /Target: 0–2\.9% paper by mass/)
  assert.doesNotMatch(metric, /0\.88 kg/)
  assert.match(display({ feasible: true, bounds, stock: '5%-A stock', system: 'us' }), /lb/)
  assert.match(display({ feasible: false, bounds: null, stock: '5%-A stock', system: 'metric' }), /No single fixed addition/)
  console.log('AI view uses an independently checked, in-range mix candidate')
} finally {
  await server.close()
}
