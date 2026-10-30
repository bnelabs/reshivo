import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import type { Bootstrap, Design, Experiment, Proposals, Requirements } from './types'
import { RequirementsPanel } from './components/RequirementsPanel'
import { ResultsPanel, format, describeChecks } from './components/ResultsPanel'
import { MaterialEvidence } from './components/MaterialEvidence'

const DesignViewport = lazy(() => import('./components/DesignViewport'))

export default function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null)
  const [requirements, setRequirements] = useState<Requirements>({})
  const [materialId, setMaterialId] = useState('')
  const [scenario, setScenario] = useState('lower_sensitivity')
  const [experiment, setExperiment] = useState<Experiment | null>(null)
  const [proposals, setProposals] = useState<Proposals | null>(null)
  const [view, setView] = useState('i')
  const [candidateView, setCandidateView] = useState('i')
  const [tab, setTab] = useState('design')
  const [busy, setBusy] = useState(true)
  const [metaBusy, setMetaBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    async function start() {
      try {
        const data = await api<Bootstrap>('/api/bootstrap', undefined, controller.signal)
        setBootstrap(data)
        setRequirements(data.config.requirements)
        setMaterialId(data.materials[0].id)
        const result = await api<Experiment>(
          '/api/experiments',
          {
            material_id: data.materials[0].id,
            requirements: data.config.requirements,
            search: data.config.search,
          },
          controller.signal,
        )
        setExperiment(result)
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'ReMatter could not load')
      } finally {
        if (!controller.signal.aborted) setBusy(false)
      }
    }
    start()
    return () => controller.abort()
  }, [])
  const active = useMemo<Design | null>(
    () =>
      view.startsWith('meta:')
        ? (proposals?.candidates[Number(view.split(':')[1])] ?? null)
        : (experiment?.exports.find((d) => d.family === view) ?? null),
    [view, proposals, experiment],
  )
  const candidate = experiment?.exports.find((d) => d.family === 'i')
  const reference = experiment?.exports.find((d) => d.family === 'rectangle')
  const comparisonCandidate = candidateView.startsWith('meta:')
    ? (proposals?.candidates[Number(candidateView.split(':')[1])] ?? null)
    : candidate
  const material = bootstrap?.materials.find((m) => m.id === materialId)
  const change = (fn: () => void) => {
    fn()
    setDirty(true)
    setError('')
  }
  async function run() {
    if (!bootstrap) return
    setBusy(true)
    setError('')
    try {
      const result = await api<Experiment>('/api/experiments', {
        material_id: materialId,
        requirements,
        scenario,
        search: bootstrap.config.search,
      })
      setExperiment(result)
      setProposals(null)
      setView('i')
      setCandidateView('i')
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Calculation failed')
    } finally {
      setBusy(false)
    }
  }
  async function propose() {
    setMetaBusy(true)
    setError('')
    try {
      const result = await api<Proposals>('/api/proposals', {
        material_id: materialId,
        requirements,
        scenario,
        max_candidates: 3,
      })
      setProposals(result)
      let best = 0
      let volume = Infinity
      result.candidates.forEach((candidate, index) => {
        const value = candidate.evaluation.volume_mm3
        if (candidate.evaluation.passes_declared_screens && value !== undefined && value < volume) {
          best = index
          volume = value
        }
      })
      setView(`meta:${best}`)
      setCandidateView(`meta:${best}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Meta generation failed')
    } finally {
      setMetaBusy(false)
    }
  }
  return (
    <>
      <header className="app-header">
        <a className="wordmark" href="/">
          ReMatter
        </a>
        <nav aria-label="Main navigation">
          <button className={tab === 'design' ? 'selected' : ''} onClick={() => setTab('design')}>
            Design
          </button>
          <button
            className={tab === 'evidence' ? 'selected' : ''}
            onClick={() => setTab('evidence')}
          >
            Materials
          </button>
        </nav>
        <span className="simulation-label">Simulation</span>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      {!bootstrap ? (
        <main className="startup-state">
          <h1>ReMatter</h1>
          <p>
            {error ? 'Start the local service and reload this page.' : 'Loading material data…'}
          </p>
          {error && (
            <button className="primary" onClick={() => location.reload()}>
              Retry connection
            </button>
          )}
        </main>
      ) : tab === 'evidence' ? (
        <MaterialEvidence data={bootstrap} />
      ) : (
        <div className="workbench-grid">
          <RequirementsPanel
            materials={bootstrap.materials}
            materialId={materialId}
            scenario={scenario}
            requirements={requirements}
            busy={busy}
            metaBusy={metaBusy}
            connected={bootstrap.meta.configured}
            dirty={dirty}
            onMaterial={(v) => change(() => setMaterialId(v))}
            onScenario={(v) => change(() => setScenario(v))}
            onRequirement={(k, v) => change(() => setRequirements((r) => ({ ...r, [k]: v })))}
            onRun={run}
            onMeta={propose}
          />
          <main className="design-main">
            <div className="design-heading">
              <h1>Support beam</h1>
              <div className="segmented" aria-label="Displayed geometry">
                <button
                  className={view !== 'rectangle' ? 'active' : ''}
                  onClick={() => setView(candidateView)}
                >
                  Design
                </button>
                <button
                  className={view === 'rectangle' ? 'active' : ''}
                  onClick={() => setView('rectangle')}
                >
                  Rectangle
                </button>
              </div>
            </div>
            <Suspense
              fallback={
                <div className="viewport">
                  <div className="viewport-message">Loading 3D preview…</div>
                </div>
              }
            >
              <DesignViewport
                design={active}
                span={experiment?.requirements.span_mm ?? requirements.span_mm ?? 300}
                dirty={dirty}
                emptyMessage={
                  busy
                    ? 'Calculating the design…'
                    : experiment
                      ? 'No design of this shape fits your settings.'
                      : 'Find a design to see it here.'
                }
              />
            </Suspense>
            {!busy && experiment?.exports.length === 0 && (
              <div className="infeasible-message" role="status">
                <h2>No design fits these settings</h2>
                <p>
                  Try a smaller load, more height or a higher tip movement limit. There’s no design
                  to download yet.
                </p>
              </div>
            )}
            <section className="volume-comparison">
              <div className="comparison-heading">
                <h2>Compare volume</h2>
                <span>Same load and size limits</span>
              </div>
              {[
                [candidateView.startsWith('meta:') ? 'Meta design' : 'Design', comparisonCandidate],
                ['Rectangle', reference],
              ].map(([label, item]) => {
                const design = item as Design | undefined
                const value = design?.evaluation.volume_mm3
                const max = Math.max(
                  reference?.evaluation.volume_mm3 || 0,
                  comparisonCandidate?.evaluation.volume_mm3 || 0,
                  1,
                )
                return (
                  <div className="comparison-row" key={label as string}>
                    <span>{label as string}</span>
                    <div className="bar-track">
                      <div
                        className={`bar ${label === 'Rectangle' ? 'reference' : ''}`}
                        style={{
                          width: value === undefined ? 0 : `${Math.min(100, (value / max) * 100)}%`,
                        }}
                      />
                    </div>
                    <strong>{format(value === undefined ? undefined : value / 1000, 1)} cm³</strong>
                  </div>
                )
              })}
            </section>
            {proposals && (
              <section className="proposal-results">
                <h2>Design ideas from Meta</h2>
                <p className="helper">
                  {proposals.model} · {proposals.live ? 'generated now' : 'test response'} ·
                  calculated by ReMatter
                </p>
                <p className="helper">
                  Meta’s explanations can be wrong. The results below come from ReMatter’s bending
                  model.
                </p>
                <div className="proposal-list">
                  {proposals.candidates.map((c, i) => (
                    <button
                      key={c.id}
                      className={view === `meta:${i}` ? 'selected' : ''}
                      onClick={() => {
                        setView(`meta:${i}`)
                        setCandidateView(`meta:${i}`)
                      }}
                    >
                      <span>{c.name}</span>
                      <small>
                        {c.evaluation.passes_declared_screens
                          ? `${format((c.evaluation.volume_mm3 || 0) / 1000, 1)} cm³ · passes design checks`
                          : `Needs changes · ${describeChecks(c.evaluation.failed_screens)}`}
                      </small>
                      <p>{c.rationale}</p>
                    </button>
                  ))}
                </div>
                <p className="helper">
                  Best I-section from the design search:{' '}
                  {format(
                    candidate?.evaluation.volume_mm3 === undefined
                      ? undefined
                      : candidate.evaluation.volume_mm3 / 1000,
                    1,
                  )}{' '}
                  cm³. The search checks many sizes; Meta suggests a few ideas. They use different
                  amounts of computation, so this is not a test of which method is more efficient.
                </p>
              </section>
            )}
          </main>
          <ResultsPanel
            design={active}
            material={material}
            reportUrl={view.startsWith('meta:') ? proposals?.report_url : experiment?.report_url}
            dirty={dirty}
            reference={view === 'rectangle'}
          />
        </div>
      )}
      <footer>Simulated results. These designs haven’t been physically tested.</footer>
    </>
  )
}
