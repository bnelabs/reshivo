import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ProductCatalog } from '../types'
import { MyMixPlanner } from './MyMixPlanner'
import { PublishedExample } from './PublishedExample'

export function ProductPlanner() {
  const [mode, setMode] = useState<'my_mix' | 'published'>('my_mix')
  const [catalog, setCatalog] = useState<ProductCatalog | null>(null)
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const [catalogError, setCatalogError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setCatalogError('')
    api<ProductCatalog>('/api/products/catalog', undefined, controller.signal)
      .then(setCatalog)
      .catch((error) => {
        if (!controller.signal.aborted)
          setCatalogError(error instanceof Error ? error.message : 'Published data could not load.')
      })
    return () => controller.abort()
  }, [catalogAttempt])
  return (
    <main className="product-page">
      <div className="product-intro">
        <div>
          <p className="eyebrow">From recycled input to product</p>
          <h1>What are you making?</h1>
          <p>
            Choose a product and a target. Use measurements of the material you actually processed.
          </p>
        </div>
        <span className="product-label">Research prototype</span>
      </div>
      <div className="mix-mode-switch" role="group" aria-label="Measurement source">
        <button type="button" aria-pressed={mode === 'my_mix'} onClick={() => setMode('my_mix')}>
          My mix
        </button>
        <button
          type="button"
          aria-pressed={mode === 'published'}
          onClick={() => setMode('published')}
        >
          Published polyethylene example
        </button>
      </div>
      <section hidden={mode !== 'my_mix'} aria-label="My mix planner">
        <MyMixPlanner active={mode === 'my_mix'} />
      </section>
      <section hidden={mode !== 'published'} aria-label="Published polyethylene example">
        {catalog ? (
          <PublishedExample catalog={catalog} active={mode === 'published'} />
        ) : (
          <div className="product-setup">
            <h2>Published polyethylene example</h2>
            <p>{catalogError || 'Loading the published measurements…'}</p>
            {catalogError && (
              <button
                type="button"
                className="outline-button"
                onClick={() => setCatalogAttempt((n) => n + 1)}
              >
                Try loading the example again
              </button>
            )}
            <p className="helper">My mix remains available without these published data.</p>
          </div>
        )}
      </section>
      {catalog && (
        <section className="collected-measurements">
          <div className="collected-heading">
            <div>
              <p className="eyebrow">Source measurements</p>
              <h2>What the collected data can answer</h2>
            </div>
            <span>{catalog.source_groups.length} source groups</span>
          </div>
          <p className="helper">These studies do not supply missing properties for My mix.</p>
          <div className="source-group-list">
            {catalog.source_groups.map((group) => (
              <details className="source-group" key={group.id}>
                <summary>{group.title}</summary>
                <p>{group.summary}</p>
                <p>{group.can_answer}</p>
                <ul>
                  {group.cannot_answer.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <a href={group.source_url} target="_blank" rel="noreferrer">
                  Read the source ↗
                </a>
                <span className="source-license">{group.license}</span>
              </details>
            ))}
          </div>
          <p className="helper">
            A physical test covers only the material, process and product configuration that was
            tested.
          </p>
        </section>
      )}
    </main>
  )
}
