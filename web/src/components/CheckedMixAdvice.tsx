import { chooseMixCandidate } from '../mixCandidate'
import type { ExactAddition } from '../mixCandidate'
import type { UnitSystem } from '../unitConversion'

/** Present a calculator result separately from any generated advice. */
export function CheckedMixAdvice({ feasible, bounds, stock, system, component, targetMin, targetMax }: {
  feasible: boolean
  bounds: ExactAddition | null
  stock: string
  system: UnitSystem
  component?: string
  targetMin?: number
  targetMax?: number
}) {
  const candidate = feasible ? chooseMixCandidate(bounds, system) : null
  return <div className="pw-notice">
    <strong>From your mix calculation</strong>
    {component && targetMin !== undefined && targetMax !== undefined && <p>Target: {targetMin}–{targetMax}% {component} by mass.</p>}
    {!feasible ? <p>No single fixed addition fits your chosen composition range.</p>
      : !candidate || candidate.kind === 'precision' ? <p>See Adjust mix for the exact calculation.</p>
      : candidate.kind === 'decimal' ? candidate.amount === '0'
        ? <p>No addition is needed for the range you entered.</p>
        : <p>One amount to explore: <strong>{candidate.amount} {candidate.unit}</strong> of {stock}.</p>
      : <p>One exact amount to explore: <strong>{candidate.numerator}/{candidate.denominator} kg</strong> of {stock} (about {candidate.approximate} {candidate.unit}).</p>}
    <small>Composition calculation; assumes even mixing and no losses.</small>
  </div>
}
