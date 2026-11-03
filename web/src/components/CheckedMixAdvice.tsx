import { chooseMixCandidate } from '../mixCandidate'
import type { ExactAddition } from '../mixCandidate'
import type { UnitSystem } from '../unitConversion'

/** Present a calculator result separately from any generated advice. */
export function CheckedMixAdvice({ feasible, bounds, stock, system }: {
  feasible: boolean
  bounds: ExactAddition | null
  stock: string
  system: UnitSystem
}) {
  const candidate = feasible ? chooseMixCandidate(bounds, system) : null
  return <div className="pw-notice">
    <strong>From your mix calculation</strong>
    {!feasible ? <p>No single fixed addition fits your chosen composition range.</p>
      : !candidate || candidate.kind === 'precision' ? <p>See Adjust mix for the exact calculation.</p>
      : candidate.kind === 'decimal' ? candidate.amount === '0'
        ? <p>No addition is needed for the range you entered.</p>
        : <p>One amount to explore: <strong>{candidate.amount} {candidate.unit}</strong> of {stock}.</p>
      : <p>One exact amount to explore: <strong>{candidate.numerator}/{candidate.denominator} kg</strong> of {stock} (about {candidate.approximate} {candidate.unit}).</p>}
  </div>
}
