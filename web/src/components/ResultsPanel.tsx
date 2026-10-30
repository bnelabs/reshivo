import type { Design, Material } from '../types'

export const format = (value: number | undefined, digits = 3) =>
  value === undefined
    ? '—'
    : value.toLocaleString('en-US', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })

const checkMessages: Record<string, string> = {
  fixed_width: 'Width does not match your setting',
  height_envelope: 'Too tall',
  deflection_target: 'Tip moves too far',
  stress_screen: 'Bending stress is too high',
  small_bending_strain: 'Stretch is beyond this model’s range',
  small_deflection: 'Bending is beyond this model’s range',
  beam_slenderness_screen: 'Beam is too short for its height in this model',
  minimum_feature: 'A section is too thin',
  web_ratio_screen: 'Web is too tall for its thickness',
  flange_ratio_screen: 'Flange extends too far for its thickness',
  invalid_geometry: 'Shape dimensions do not work together',
}

export const describeChecks = (checks: string[]) =>
  checks.map((check) => checkMessages[check] ?? check.replaceAll('_', ' ')).join(' · ')

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
    <aside className="results-rail" aria-label="Design results">
      <h2>{reference ? 'Rectangle results' : 'Design results'}</h2>
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
        <span>Tip movement</span>
      </div>
      <div className="metric">
        <strong>
          {format(e?.root_bending_stress_MPa)} <small>MPa</small>
        </strong>
        <span>Stress at the fixed end</span>
      </div>
      {e && (
        <div
          className={`screen-status ${e.passes_declared_screens ? 'pass' : 'fail'}`}
          role="status"
        >
          <span>{e.passes_declared_screens ? '✓' : '!'}</span>
          {dirty
            ? 'Settings changed · update the design'
            : e.passes_declared_screens
              ? 'Passes design checks'
              : 'Needs changes'}
        </div>
      )}
      {e && !e.passes_declared_screens && (
        <p className="failed-reasons">{describeChecks(e.failed_screens)}</p>
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
          Design report
        </a>
      </div>
      <section className="evidence-summary">
        <h2>About this design</h2>
        <p>Uses measured stiffness and yield strength.</p>
        <p>Assumes a perfectly fixed end.</p>
        <p>Doesn’t cover creep or fatigue.</p>
      </section>
    </aside>
  )
}
