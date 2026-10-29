import type { Design, Material } from '../types'

export const format = (value: number | undefined, digits = 3) =>
  value === undefined
    ? '—'
    : value.toLocaleString('en-US', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })
function FileIcon({ download = false }: { download?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      {download ? (
        <>
          <path d="M12 3v12m-5-5 5 5 5-5" />
          <path d="M4 16v5h16v-5" />
        </>
      ) : (
        <>
          <path d="M6 3h8l5 5v13H6z" />
          <path d="M14 3v6h5" />
        </>
      )}
    </svg>
  )
}

export function ResultsPanel({
  design,
  material,
  reportUrl,
  dirty,
  reference,
}: {
  design: Design | null
  material?: Material
  reportUrl?: string
  dirty: boolean
  reference: boolean
}) {
  const e = design?.evaluation
  const section = design?.section
  return (
    <aside className="results-rail" aria-label="Calculation result">
      <h2>{reference ? 'Reference result' : 'Candidate result'}</h2>
      <div className="metric">
        <strong>
          {format(e?.volume_mm3 === undefined ? undefined : e.volume_mm3 / 1000, 1)}{' '}
          <small>cm³</small>
        </strong>
        <span>Material volume</span>
      </div>
      <div className="metric">
        <strong>
          {format(e?.tip_deflection_mm)} <small>mm</small>
        </strong>
        <span>Tip deflection</span>
      </div>
      <div className="metric">
        <strong>
          {format(e?.root_bending_stress_MPa)} <small>MPa</small>
        </strong>
        <span>Root bending stress</span>
      </div>
      {e && (
        <div
          className={`screen-status ${e.passes_declared_screens ? 'pass' : 'fail'}`}
          role="status"
        >
          <span>{e.passes_declared_screens ? '✓' : '!'}</span>
          {dirty
            ? 'Previous result · inputs changed'
            : e.passes_declared_screens
              ? 'Passes declared screens'
              : 'Does not pass declared screens'}
        </div>
      )}
      {e && !e.passes_declared_screens && (
        <p className="failed-reasons">
          {e.failed_screens.map((s) => s.replaceAll('_', ' ')).join(', ')}
        </p>
      )}
      <dl className="section-dimensions">
        <dt>Section</dt>
        <dd>{section ? (section.shape === 'i' ? 'I-section' : 'Rectangle') : '—'}</dd>
        <dt>Height</dt>
        <dd>{section ? `${section.height_mm} mm` : '—'}</dd>
        <dt>Flange</dt>
        <dd>{section?.flange_mm ? `${section.flange_mm} mm` : '—'}</dd>
        <dt>Web</dt>
        <dd>{section?.web_mm ? `${section.web_mm} mm` : '—'}</dd>
      </dl>
      <div className="export-links">
        <a
          className={`primary download-button ${!design?.stl_url || dirty ? 'disabled' : ''}`}
          href={dirty ? undefined : design?.stl_url}
          aria-disabled={!design?.stl_url || dirty}
          download
        >
          <FileIcon download />
          Download STL
        </a>
        <a
          className={!design?.design_url || dirty ? 'disabled' : ''}
          href={dirty ? undefined : design?.design_url}
          download
        >
          <FileIcon />
          Design JSON
        </a>
        <a
          className={!reportUrl || dirty ? 'disabled' : ''}
          href={dirty ? undefined : reportUrl}
          download
        >
          <FileIcon />
          Experiment report
        </a>
      </div>
      <section className="evidence-summary">
        <h2>Evidence &amp; limits</h2>
        <p>Measured: stiffness and yield</p>
        <p>Assumed: perfect clamp</p>
        <p>Unknown: creep and fatigue</p>
      </section>
    </aside>
  )
}
