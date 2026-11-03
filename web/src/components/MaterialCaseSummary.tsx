import type { WorkshopCase } from '../types'

export function MaterialCaseSummary({ caseData, onEdit, onExplore, busy, canExplore }: {
  caseData: WorkshopCase
  onEdit: () => void
  onExplore: () => void
  busy: boolean
  canExplore: boolean
}) {
  const { brief, details } = caseData
  const unit = details.amount_unit === 'g' ? 'g' : details.amount_unit === 'mass_percent' ? 'mass %' : 'volume %'
  return <section className="material-case-summary" aria-label="Current material case">
    <h2>Your material case</h2>
    <h3>{brief.product}</h3>
    {details.label && <p className="material-case-name">{details.label}</p>}
    <dl>
      <dt>What you have</dt><dd>{brief.input}</dd>
      <dt>What changes</dt><dd>{brief.variation || 'Not entered'}</dd>
      <dt>Your target</dt><dd>{brief.targets}</dd>
    </dl>
    <details><summary>Use, process and recipe</summary>
      <p><strong>Use:</strong> {brief.use_case}</p>
      <p><strong>Process:</strong> {brief.process || 'Not entered'}</p>
      <p><strong>Contamination:</strong> {brief.contamination || 'Not entered'}</p>
      <ul>{details.components.filter((row) => row.name.trim()).map((row) => <li key={row.id}>{row.name}{row.amount.trim() && <> · {row.amount} {unit}</>}</li>)}</ul>
      {details.amount_basis && <p>{details.amount_basis}</p>}
    </details>
    <button type="button" className="outline-button" onClick={onEdit}>Edit this case</button>
    <button type="button" className="outline-button" disabled={busy || !canExplore} onClick={onExplore}>Explore fresh options</button>
    <p className="material-case-note">Fresh options replace the selected trial. Save the workspace first if you want to keep it.</p>
  </section>
}
