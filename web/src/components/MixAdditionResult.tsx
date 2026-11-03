import type { BalanceMixResult } from '../types'
import type { UnitSystem } from '../unitConversion'
import { chooseMixCandidate } from '../mixCandidate'
import { formatMixMass } from '../mixAdjustment'

/** Presents one exactly checked composition amount without widening the feasible interval. */
export function MixAdditionResult({ result, system }: { result: BalanceMixResult; system: UnitSystem }) {
  if (!result.feasible) return null
  const bounds = result.exact_addition_kg
  const candidate = chooseMixCandidate(bounds, system)
  if (!bounds) return <p>{typeof result.example_addition_kg === 'number' && Number.isFinite(result.example_addition_kg)
    ? <>Estimated amount: <strong>{formatMixMass(result.example_addition_kg, system)}</strong> of {result.addition_name}.</>
    : 'The calculated amount is unavailable.'}</p>
  if (!candidate) return <p>The calculation details could not be read. Calculate again.</p>
  const fractionText = (value: { numerator: string; denominator: string }) =>
    value.denominator === '1' ? value.numerator : `${value.numerator}/${value.denominator}`
  return <>
    {candidate.kind === 'precision' ? <p>This interval needs more precision than a short amount can show. See the calculation details.</p>
      : candidate.kind === 'decimal' ? candidate.amount === '0' ?
      <p>No addition is needed for the composition range you chose.{(bounds.max === null || BigInt(bounds.max.numerator) > 0n) && ' Other amounts may also fit.'}</p> :
      <p>One amount to explore: <strong>{candidate.amount} {candidate.unit}</strong> of {result.addition_name}.</p>
      : <p>The calculated amount is {`${candidate.numerator}/${candidate.denominator}`.length <= 24
        ? <><strong>{candidate.numerator}/{candidate.denominator} kg</strong> of {result.addition_name} (about {candidate.approximate} {candidate.unit}).</>
        : <>about <strong>{candidate.approximate} {candidate.unit}</strong> of {result.addition_name}. The exact fraction is in the calculation details.</>}</p>}
    {candidate.kind === 'decimal' && <p>For the entered values, the calculated composition is within your chosen range, assuming even mixing and no losses.</p>}
    {candidate.kind === 'fraction' && <p>The exact fraction reaches your chosen composition with even mixing and no losses; the decimal is approximate.</p>}
    <details>
      <summary>Calculation details</summary>
      <p>Exact calculated addition range: {fractionText(bounds.min)} kg to {bounds.max === null ? 'no upper limit' : `${fractionText(bounds.max)} kg`}.</p>
    </details>
  </>
}
