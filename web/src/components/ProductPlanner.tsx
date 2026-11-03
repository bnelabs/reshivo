import { useEffect, useState } from 'react'
import { api } from '../api'
import type { AssemblyObservationFields, ProductCatalog, WorkshopCase } from '../types'
import { CaseSummary } from './CaseDetails'
import { MyMixPlanner } from './MyMixPlanner'
import { PublishedExample } from './PublishedExample'
import { TestedLevels } from './TestedLevels'

export function ProductPlanner({
  caseData,
  onEditCase,
  assemblyObservation,
  onAssemblyObservationChange,
}: {
  caseData: WorkshopCase
  onEditCase: () => void
  assemblyObservation: AssemblyObservationFields
  onAssemblyObservationChange: (observation: AssemblyObservationFields) => void
}) {
  const materialKey = JSON.stringify([
    caseData.brief.input,
    caseData.brief.variation,
    caseData.brief.contamination,
    caseData.brief.process,
    caseData.details.components,
    caseData.details.amount_unit,
    caseData.details.amount_basis,
  ])
  const [mode, setMode] = useState<'my_mix' | 'published' | 'tested_levels'>('my_mix')
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
    <section className="product-page" aria-label="Calculation tools for this case">
      <div className="product-intro">
        <div>
          <p className="eyebrow">Your case, carried through</p>
          <h2>Calculations for this case</h2>
          <p>
            Use the material, product and process you already entered, with matching measurements.
          </p>
        </div>
        <span className="product-label">Research prototype</span>
      </div>
      <CaseSummary brief={caseData.brief} />
      <div className="mix-mode-switch" role="group" aria-label="Measurement source">
        <button type="button" aria-pressed={mode === 'my_mix'} onClick={() => setMode('my_mix')}>
          This case
        </button>
        <button
          type="button"
          aria-pressed={mode === 'published'}
          onClick={() => setMode('published')}
        >
          Published polyethylene example
        </button>
        <button
          type="button"
          aria-pressed={mode === 'tested_levels'}
          onClick={() => setMode('tested_levels')}
        >
          Tested input levels
        </button>
      </div>
      <section hidden={mode !== 'my_mix'} aria-label="My mix planner">
        <MyMixPlanner
          key={materialKey}
          active={mode === 'my_mix'}
          caseData={caseData}
          onEditCase={onEditCase}
          assemblyObservation={assemblyObservation}
          onAssemblyObservationChange={onAssemblyObservationChange}
        />
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
      <section hidden={mode !== 'tested_levels'} aria-label="Tested input levels">
        <TestedLevels active={mode === 'tested_levels'} />
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
    </section>
  )
}
