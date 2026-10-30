import type { Bootstrap } from '../types'
import { shortCondition } from './RequirementsPanel'

export function MaterialEvidence({ data }: { data: Bootstrap }) {
  return (
    <main className="material-page">
      <h1>PP tensile tests</h1>
      <p className="evidence-intro">
        Recycled polypropylene (PP), tested in eight conditions in one study. Each row includes five
        samples from the same condition. The study does not compare suppliers or separate waste
        batches.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Test condition</th>
              <th>Samples</th>
              <th>Stiffness (MPa)</th>
              <th>Variation (SD)</th>
              <th>Yield strength (MPa)</th>
              <th>Variation (SD)</th>
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
          <h2>Where the numbers come from</h2>
          <p>
            The study measures stiffness, yield strength and stretch before breaking. Each value
            stays linked to its test condition. SD means standard deviation: the spread between
            samples.
          </p>
          <a href={data.source.url} target="_blank" rel="noreferrer">
            View the original test data ↗
          </a>
          <p>Source license: {data.source.license}</p>
        </section>
        <section>
          <h2>What’s missing</h2>
          <p>
            The additive recipes haven’t been matched to these test codes yet. We also lack density,
            Poisson’s ratio, differences between waste batches, creep and fatigue data. These
            numbers cannot tell us the recipe for a new blend.
          </p>
          <p>
            Lower estimate subtracts twice the sample standard deviation from each average. It helps
            explore lower stiffness and strength. This setting does not give a statistical
            confidence range or predict another waste batch.
          </p>
        </section>
      </div>
    </main>
  )
}
