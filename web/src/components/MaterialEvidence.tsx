import type { Bootstrap } from '../types'
import { shortCondition } from './RequirementsPanel'

export function MaterialEvidence({ data }: { data: Bootstrap }) {
  return (
    <main className="material-page">
      <h1>Material evidence</h1>
      <p className="evidence-intro">
        Eight measured conditions from one recycled-PP study. These are not eight suppliers or
        independent waste batches.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Condition</th>
              <th>Specimens</th>
              <th>Modulus (MPa)</th>
              <th>Reported SD</th>
              <th>Yield (MPa)</th>
              <th>Reported SD</th>
            </tr>
          </thead>
          <tbody>
            {data.materials.map((m) => (
              <tr key={m.id}>
                <th>{shortCondition(m.id)}</th>
                <td>{m.specimens}</td>
                <td>{m.modulus_MPa}</td>
                <td>{m.modulus_sd_MPa}</td>
                <td>{m.yield_stress_MPa}</td>
                <td>{m.yield_stress_sd_MPa}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="evidence-notes">
        <section>
          <h2>What is measured</h2>
          <p>
            Tensile stiffness, yield and ductility, with five specimen measurements for each
            condition. Each property remains linked to its original condition.
          </p>
          <a href={data.source.url} target="_blank" rel="noreferrer">
            Open experimental dataset ↗
          </a>
          <p>Source license: {data.source.license}</p>
        </section>
        <section>
          <h2>What remains unknown</h2>
          <p>
            Named additive-to-condition mappings, density, Poisson ratio, independent batch
            variation, creep and fatigue. Formulation percentages are not inferred.
          </p>
          <p>
            The lower sensitivity scenario uses specimen spread for a numerical sensitivity check.
            It is not a confidence interval or a batch prediction.
          </p>
        </section>
      </div>
    </main>
  )
}
