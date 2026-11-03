import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root, configFile: false, server: { middlewareMode: true }, appType: 'custom' })
try {
  const { MixAdjustment } = await server.ssrLoadModule('/src/components/MixAdjustment.tsx')
  const { newProjectWorkspace } = await server.ssrLoadModule('/src/projectWorkspace.ts')
  const workspace = newProjectWorkspace()
  workspace.configurations = [
    { id: 'selected', revision: 2, name: 'Empty setup', materials: [], process: '', geometry: '', notes: '' },
    { id: 'alternative', revision: 1, name: 'Available setup', materials: [{ id: 'stock', name: 'Stock', amount: '1', unit: 'kg' }], process: '', geometry: '', notes: '' },
  ]
  const markup = renderToStaticMarkup(React.createElement(MixAdjustment, {
    workspace, enabled: true, showHistoricalIdeas: true,
    planningContext: { brief: {}, question: '', project_context: { configurations: [] } },
    onDraftChange() {},
  }))
  assert.match(markup, /Add a material to this setup/)
  assert.match(markup, /<select[^>]*>.*<option value="selected" selected="">Empty setup · version 2<\/option>.*<option value="alternative">Available setup · version 1<\/option>/)
  console.log('An empty selected setup retains a selector for another setup')
} finally {
  await server.close()
}
