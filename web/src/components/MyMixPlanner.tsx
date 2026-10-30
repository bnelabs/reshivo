import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { MixAmountUnit, MixCase, MixMassResult, MixReading, MixVolumeBasis } from '../types'

type ComponentEntry = {
  id: number
  name: string
  role: 'main' | 'binder' | 'other'
  amount: string
}
type ReadingEntry = Omit<
  MixReading,
  'value_g_cm3' | 'batch_id' | 'run_id' | 'specimen_id' | 'repeat_of'
> & {
  value: string
  batch_id: string
  run_id: string
  specimen_id: string
  repeat_of: string
}
type Property = 'mass' | 'absorption' | 'blocking' | 'other'
const blankReading = (id: number): ReadingEntry => ({
  id: `reading-${id}`,
  value: '',
  reading_kind: 'unknown',
  batch_id: '',
  run_id: '',
  specimen_id: '',
  repeat_of: '',
})
const positive = (value: string) =>
  value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0
const quantity = (value: number, digits = 3) =>
  value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
const volumeOptions = (
  <>
    <option value="unknown">Not recorded yet</option>
    <option value="external_volume">External specimen volume, including internal pores</option>
    <option value="solid_volume">Solid-material volume, excluding pores</option>
    <option value="other">Another defined volume</option>
  </>
)
const trimOrNull = (value: string) => value.trim() || null

function downloadResult(result: MixMassResult) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = 'rematter-my-mix-simulation.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function MyMixPlanner({ active }: { active: boolean }) {
  const [productKind, setProductKind] = useState('counterweight')
  const [productName, setProductName] = useState('Counterweight')
  const [property, setProperty] = useState<Property>('mass')
  const [otherProperty, setOtherProperty] = useState('')
  const [otherUnit, setOtherUnit] = useState('')
  const [targetMin, setTargetMin] = useState('')
  const [targetMax, setTargetMax] = useState('')
  const [volume, setVolume] = useState('')
  const [frequencyMin, setFrequencyMin] = useState('')
  const [frequencyMax, setFrequencyMax] = useState('')
  const [thickness, setThickness] = useState('')
  const [installation, setInstallation] = useState('')
  const [caseLabel, setCaseLabel] = useState('')
  const [components, setComponents] = useState<ComponentEntry[]>([
    { id: 1, name: '', role: 'main', amount: '' },
    { id: 2, name: '', role: 'binder', amount: '' },
  ])
  const [amountUnit, setAmountUnit] = useState<MixAmountUnit>('mass_percent')
  const [amountBasis, setAmountBasis] = useState('')
  const [process, setProcess] = useState('')
  const [densityMethod, setDensityMethod] = useState('')
  const [densityBasis, setDensityBasis] = useState<MixVolumeBasis>('unknown')
  const [calculationBasis, setCalculationBasis] = useState<MixVolumeBasis>('unknown')
  const [basisDetails, setBasisDetails] = useState('')
  const [readings, setReadings] = useState<ReadingEntry[]>([blankReading(1)])
  const [caseNotice, setCaseNotice] = useState('')
  const [result, setResult] = useState<MixMassResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const readingSerial = useRef(1)
  const componentSerial = useRef(2)
  const request = useRef<AbortController | null>(null)
  const output = useRef<HTMLElement | null>(null)

  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (result) {
      output.current?.focus({ preventScroll: true })
      output.current?.scrollIntoView({ block: 'start' })
    }
  }, [result])
  useEffect(() => {
    if (!active) {
      request.current?.abort()
      setBusy(false)
    }
  }, [active])

  function change(update: () => void) {
    request.current?.abort()
    setBusy(false)
    setResult(null)
    setError('')
    update()
  }
  function changeCase(update: () => void) {
    change(update)
    if (
      readings.some(
        (row) => row.value || row.batch_id || row.run_id || row.specimen_id || row.repeat_of,
      )
    )
      setCaseNotice(
        'The material, process or density setup changed. This is a new case: the previous readings were cleared. Enter measurements for this case.',
      )
    setReadings([blankReading(++readingSerial.current)])
  }
  function editComponent(index: number, update: Partial<ComponentEntry>) {
    changeCase(() =>
      setComponents((rows) => rows.map((row, i) => (i === index ? { ...row, ...update } : row))),
    )
  }
  function editReading(index: number, update: Partial<ReadingEntry>) {
    setCaseNotice('')
    change(() =>
      setReadings((rows) => rows.map((row, i) => (i === index ? { ...row, ...update } : row))),
    )
  }
  const amountTotal = components.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
  const compositionValid =
    components.every((row) => row.name.trim() && positive(row.amount)) &&
    components.filter((row) => row.role === 'main').length === 1 &&
    (amountUnit === 'g' || Math.abs(amountTotal - 100) <= 0.000001)
  const basisValid =
    densityBasis !== 'unknown' &&
    calculationBasis === densityBasis &&
    (densityBasis !== 'other' || Boolean(basisDetails.trim()))
  const caseValid = Boolean(
    caseLabel.trim() &&
    compositionValid &&
    amountBasis.trim() &&
    process.trim() &&
    densityMethod.trim() &&
    basisValid,
  )
  const numbersValid =
    [volume, targetMin, targetMax].every(positive) && Number(targetMin) <= Number(targetMax)
  let readingIssue = ''
  readings.forEach((row, index) => {
    if (readingIssue) return
    if (!positive(row.value)) readingIssue = 'Enter a positive density for every reading.'
    else if (row.reading_kind === 'specimen' && !row.specimen_id.trim())
      readingIssue = `Reading ${index + 1} needs its specimen ID, or choose “Reading type unknown”.`
    else if (row.reading_kind === 'repeat') {
      const reference = readings
        .slice(0, index)
        .find((item) => item.id === row.repeat_of && item.reading_kind !== 'repeat')
      if (!reference)
        readingIssue = `Reading ${index + 1} needs an earlier original reading to repeat.`
      else if (
        ['batch_id', 'run_id', 'specimen_id'].some(
          (key) =>
            row[key as 'batch_id' | 'run_id' | 'specimen_id'].trim() !==
            reference[key as 'batch_id' | 'run_id' | 'specimen_id'].trim(),
        )
      )
        readingIssue = `Reading ${index + 1} must use the same batch, run and specimen labels as its original reading. Leave both unknown where necessary.`
    }
  })
  const canCalculate =
    property === 'mass' && caseValid && numbersValid && !readingIssue && Boolean(productName.trim())

  async function calculate() {
    if (!canCalculate || busy) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    setBusy(true)
    setError('')
    setResult(null)
    const materialCase: MixCase = {
      label: caseLabel.trim(),
      components: components.map((row) => ({
        name: row.name.trim(),
        role: row.role,
        amount: Number(row.amount),
        unit: amountUnit,
      })),
      amount_basis: amountBasis.trim(),
      process: process.trim(),
      density_method: densityMethod.trim(),
      density_volume_basis: densityBasis,
      calculation_volume_basis: calculationBasis,
      volume_basis_details: basisDetails.trim(),
    }
    try {
      const response = await api<MixMassResult>(
        '/api/products/my-mix',
        {
          product_name: productName.trim(),
          property: 'mass',
          case: materialCase,
          readings: readings.map((row) => ({
            id: row.id,
            value_g_cm3: Number(row.value),
            reading_kind: row.reading_kind,
            batch_id: trimOrNull(row.batch_id),
            run_id: trimOrNull(row.run_id),
            specimen_id: trimOrNull(row.specimen_id),
            repeat_of: row.reading_kind === 'repeat' ? trimOrNull(row.repeat_of) : null,
          })),
          volume_cm3: Number(volume),
          target_min_kg: Number(targetMin),
          target_max_kg: Number(targetMax),
        },
        controller.signal,
      )
      if (!controller.signal.aborted) setResult(response)
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : 'The simulation could not finish.')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  const propertyUnit =
    property === 'mass'
      ? 'kg'
      : property === 'absorption'
        ? 'absorption coefficient'
        : property === 'blocking'
          ? 'dB'
          : otherUnit || 'your units'
  const sourceDescription =
    components
      .filter((row) => row.name.trim())
      .map((row) => row.name.trim())
      .join(' + ') || 'your material'
  return (
    <div className="product-grid mix-planner-grid">
      <form
        className="product-setup"
        onSubmit={(event) => {
          event.preventDefault()
          void calculate()
        }}
      >
        <div className="product-pair">
          <label className="product-field">
            Product
            <select
              value={productKind}
              onChange={(event) =>
                change(() => {
                  const kind = event.target.value
                  setProductKind(kind)
                  setProductName(
                    kind === 'counterweight'
                      ? 'Counterweight'
                      : kind === 'sheet'
                        ? 'Sound sheet'
                        : '',
                  )
                })
              }
            >
              <option value="counterweight">Counterweight</option>
              <option value="sheet">Sound sheet</option>
              <option value="other">Other product</option>
            </select>
          </label>
          <label className="product-field">
            Physical property
            <select
              value={property}
              onChange={(event) =>
                change(() => {
                  setProperty(event.target.value as Property)
                  setTargetMin('')
                  setTargetMax('')
                })
              }
            >
              <option value="mass">Mass</option>
              <option value="absorption">Sound absorption</option>
              <option value="blocking">Sound blocking</option>
              <option value="other">Another property</option>
            </select>
          </label>
        </div>
        <label className="product-field">
          Product name
          <input
            required
            maxLength={120}
            value={productName}
            onChange={(event) => change(() => setProductName(event.target.value))}
            placeholder="Name your product"
          />
        </label>
        {property === 'other' && (
          <div className="product-pair">
            <label className="product-field">
              Property name
              <input
                value={otherProperty}
                onChange={(event) => change(() => setOtherProperty(event.target.value))}
                placeholder="For example, thickness"
              />
            </label>
            <label className="product-field">
              Property units
              <input
                value={otherUnit}
                onChange={(event) => change(() => setOtherUnit(event.target.value))}
                placeholder="For example, mm"
              />
            </label>
          </div>
        )}
        <div className="product-pair">
          <label className="product-field">
            Target minimum ({propertyUnit})
            <input
              type="number"
              min={property === 'mass' ? '0.000001' : undefined}
              step="any"
              required={property === 'mass'}
              value={targetMin}
              onChange={(event) => change(() => setTargetMin(event.target.value))}
            />
          </label>
          <label className="product-field">
            Target maximum ({propertyUnit})
            <input
              type="number"
              min={property === 'mass' ? '0.000001' : undefined}
              step="any"
              required={property === 'mass'}
              value={targetMax}
              onChange={(event) => change(() => setTargetMax(event.target.value))}
            />
          </label>
        </div>
        {targetMin && targetMax && Number(targetMin) > Number(targetMax) && (
          <p className="product-input-note">Minimum must be no greater than maximum.</p>
        )}
        {(property === 'absorption' || property === 'blocking') && (
          <div className="product-step">
            <h2>Define the sound test</h2>
            <div className="product-pair">
              <label className="product-field">
                Frequency from (Hz)
                <input
                  type="number"
                  min="1"
                  value={frequencyMin}
                  onChange={(event) => change(() => setFrequencyMin(event.target.value))}
                />
              </label>
              <label className="product-field">
                Frequency to (Hz)
                <input
                  type="number"
                  min="1"
                  value={frequencyMax}
                  onChange={(event) => change(() => setFrequencyMax(event.target.value))}
                />
              </label>
            </div>
            <label className="product-field">
              Sheet thickness (mm)
              <input
                type="number"
                min="0.000001"
                step="any"
                value={thickness}
                onChange={(event) => change(() => setThickness(event.target.value))}
              />
            </label>
            <label className="product-field">
              Installation
              <textarea
                value={installation}
                onChange={(event) => change(() => setInstallation(event.target.value))}
                placeholder="Backing, air gap and where it will be fitted"
              />
            </label>
          </div>
        )}
        <div className="product-step">
          <h2>1. Describe this processed mix</h2>
          <p className="helper">
            Name the actual materials and amounts. No metal or binder density is used to create a
            mix density.
          </p>
          <label className="product-field">
            Mix case name
            <input
              value={caseLabel}
              maxLength={120}
              required={property === 'mass'}
              onChange={(event) => change(() => setCaseLabel(event.target.value))}
              placeholder="Your reference for this formulation and process"
            />
          </label>
          <label className="product-field">
            Amount unit
            <select
              value={amountUnit}
              onChange={(event) =>
                changeCase(() => setAmountUnit(event.target.value as MixAmountUnit))
              }
            >
              <option value="g">Grams</option>
              <option value="mass_percent">Mass percent</option>
              <option value="volume_percent">Volume percent</option>
            </select>
          </label>
          {components.map((row, index) => (
            <div className="mix-entry-card" key={row.id}>
              <div className="mix-entry-heading">
                <h3>Material {index + 1}</h3>
                <button
                  className="text-button"
                  type="button"
                  disabled={components.length === 1}
                  aria-label={`Remove material ${index + 1}`}
                  onClick={() =>
                    changeCase(() =>
                      setComponents((rows) => rows.filter((item) => item.id !== row.id)),
                    )
                  }
                >
                  Remove
                </button>
              </div>
              <label className="product-field">
                Material {index + 1} name
                <input
                  value={row.name}
                  maxLength={120}
                  onChange={(event) => editComponent(index, { name: event.target.value })}
                  placeholder={
                    row.role === 'binder'
                      ? 'Name the binder or cable-plastic residue'
                      : 'Name the metal dust or other material'
                  }
                />
              </label>
              <div className="product-pair">
                <label className="product-field">
                  Material {index + 1} role
                  <select
                    value={row.role}
                    onChange={(event) =>
                      editComponent(index, { role: event.target.value as ComponentEntry['role'] })
                    }
                  >
                    <option value="main">Main material</option>
                    <option value="binder">Binder</option>
                    <option value="other">Other material</option>
                  </select>
                </label>
                <label className="product-field">
                  Material {index + 1} amount ({amountUnit === 'g' ? 'g' : '%'})
                  <input
                    type="number"
                    min="0.000001"
                    step="any"
                    value={row.amount}
                    onChange={(event) => editComponent(index, { amount: event.target.value })}
                  />
                </label>
              </div>
            </div>
          ))}
          <button
            className="outline-button mix-add-button"
            type="button"
            disabled={components.length >= 20}
            onClick={() =>
              changeCase(() =>
                setComponents((rows) => [
                  ...rows,
                  { id: ++componentSerial.current, name: '', role: 'other', amount: '' },
                ]),
              )
            }
          >
            Add material
          </button>
          {amountUnit !== 'g' && (
            <p className="helper">
              Percentages must total 100. Current total: {quantity(amountTotal, 4)}%.
            </p>
          )}
          <label className="product-field">
            Amount basis
            <input
              value={amountBasis}
              maxLength={300}
              onChange={(event) => changeCase(() => setAmountBasis(event.target.value))}
              placeholder="For example, dry mass or as received; explain any moisture basis"
            />
          </label>
          <label className="product-field">
            Process
            <textarea
              value={process}
              maxLength={2000}
              onChange={(event) => changeCase(() => setProcess(event.target.value))}
              placeholder="Preparation, mixing, temperature, pressure, time and forming conditions used for these specimens"
            />
          </label>
          <p className="helper">
            Changing a material, amount or process starts a new case and clears its density
            readings.
          </p>
        </div>
        {property === 'mass' && (
          <>
            <div className="product-step">
              <h2>2. Match density to volume</h2>
              <label className="product-field">
                Density measurement method
                <textarea
                  value={densityMethod}
                  maxLength={1000}
                  onChange={(event) => changeCase(() => setDensityMethod(event.target.value))}
                  placeholder="How density of the processed mix was measured, units and test conditions"
                />
              </label>
              <label className="product-field">
                Volume used by the density measurement
                <select
                  value={densityBasis}
                  onChange={(event) =>
                    changeCase(() => setDensityBasis(event.target.value as MixVolumeBasis))
                  }
                >
                  {volumeOptions}
                </select>
              </label>
              <label className="product-field">
                Volume used for the mass calculation
                <select
                  value={calculationBasis}
                  onChange={(event) =>
                    changeCase(() => setCalculationBasis(event.target.value as MixVolumeBasis))
                  }
                >
                  {volumeOptions}
                </select>
              </label>
              <label className="product-field">
                Volume basis details
                <textarea
                  value={basisDetails}
                  maxLength={1000}
                  onChange={(event) => changeCase(() => setBasisDetails(event.target.value))}
                  placeholder="How specimen volume was found and which pores or spaces it includes; required for another defined volume"
                />
              </label>
              <p className="helper">
                Both volume meanings must match. External specimen volume includes internal pores.
                Solid-material volume excludes pores and cannot be substituted for external
                dimensions.
              </p>
              {densityBasis !== 'unknown' &&
                calculationBasis !== 'unknown' &&
                densityBasis !== calculationBasis && (
                  <p className="product-input-note">
                    The two volume bases do not match. No mass simulation is available.
                  </p>
                )}
              <p className="helper">
                The density reading can already reflect this specimen’s voids and packing. It does
                not measure what happens when they change.
              </p>
            </div>
            <div className="product-step">
              <h2>3. Enter density readings</h2>
              <p className="helper">
                Use readings of this finished, processed mix in g/cm³. Leave unknown group labels
                blank. Specimens, runs and batches are separate labels; a specimen may have repeated
                readings.
              </p>
              {!caseValid && (
                <p className="product-input-note">
                  Complete the mix, process, method and matching volume bases before entering
                  readings.
                </p>
              )}
              {caseNotice && (
                <p className="mix-case-notice" role="status">
                  {caseNotice}
                </p>
              )}
              <fieldset disabled={!caseValid}>
                <legend className="visually-hidden">Density readings for this case</legend>
                {readings.map((row, index) => (
                  <div className="mix-entry-card" key={row.id}>
                    <div className="mix-entry-heading">
                      <h3>Reading {index + 1}</h3>
                      <button
                        className="text-button"
                        type="button"
                        disabled={readings.length === 1}
                        aria-label={`Remove reading ${index + 1}`}
                        onClick={() =>
                          change(() =>
                            setReadings((rows) =>
                              rows
                                .filter((item) => item.id !== row.id)
                                .map((item) =>
                                  item.repeat_of === row.id ? { ...item, repeat_of: '' } : item,
                                ),
                            ),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                    <label className="product-field">
                      Reading {index + 1} density (g/cm³)
                      <input
                        type="number"
                        min="0.000001"
                        step="any"
                        value={row.value}
                        onChange={(event) => editReading(index, { value: event.target.value })}
                      />
                    </label>
                    <details className="mix-reading-grouping">
                      <summary>
                        Grouping for reading {index + 1}
                        {row.batch_id ||
                        row.run_id ||
                        row.specimen_id ||
                        row.reading_kind !== 'unknown'
                          ? ' · recorded'
                          : ' · unknown'}
                      </summary>
                      <label className="product-field">
                        Reading {index + 1} type
                        <select
                          value={row.reading_kind}
                          onChange={(event) =>
                            editReading(index, {
                              reading_kind: event.target.value as ReadingEntry['reading_kind'],
                              repeat_of: '',
                            })
                          }
                        >
                          <option value="unknown">Reading type unknown</option>
                          <option value="specimen">Reading from an identified specimen</option>
                          <option value="repeat">
                            Repeated test of an earlier reading’s specimen
                          </option>
                        </select>
                      </label>
                      {row.reading_kind === 'repeat' && (
                        <label className="product-field">
                          Reading {index + 1} repeats
                          <select
                            value={row.repeat_of}
                            onChange={(event) =>
                              editReading(index, { repeat_of: event.target.value })
                            }
                          >
                            <option value="">Choose the earlier original reading</option>
                            {readings.slice(0, index).map(
                              (item, earlier) =>
                                item.reading_kind !== 'repeat' && (
                                  <option key={item.id} value={item.id}>
                                    Reading {earlier + 1}
                                  </option>
                                ),
                            )}
                          </select>
                        </label>
                      )}
                      <label className="product-field">
                        Reading {index + 1} batch ID (optional)
                        <input
                          maxLength={80}
                          value={row.batch_id}
                          onChange={(event) => editReading(index, { batch_id: event.target.value })}
                          placeholder="Only if you identify a separate batch"
                        />
                      </label>
                      <div className="product-pair">
                        <label className="product-field">
                          Reading {index + 1} run ID (optional)
                          <input
                            maxLength={80}
                            value={row.run_id}
                            onChange={(event) => editReading(index, { run_id: event.target.value })}
                          />
                        </label>
                        <label className="product-field">
                          Reading {index + 1} specimen ID (optional)
                          <input
                            maxLength={80}
                            value={row.specimen_id}
                            onChange={(event) =>
                              editReading(index, { specimen_id: event.target.value })
                            }
                          />
                        </label>
                      </div>
                      <p className="helper">
                        For a repeat, use the same known labels as the original. Blank labels remain
                        unknown. Reusing a specimen label in a different run or batch does not merge
                        those specimens.
                      </p>
                    </details>
                  </div>
                ))}
                <button
                  type="button"
                  className="outline-button mix-add-button"
                  disabled={readings.length >= 200}
                  onClick={() =>
                    change(() =>
                      setReadings((rows) => [...rows, blankReading(++readingSerial.current)]),
                    )
                  }
                >
                  Add density reading
                </button>
              </fieldset>
              {caseValid && readingIssue && readings.some((row) => row.value) && (
                <p className="product-input-note">{readingIssue}</p>
              )}
            </div>
            <div className="product-step">
              <h2>4. Set the calculation volume</h2>
              <label className="product-field">
                My volume (cm³)
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  value={volume}
                  onChange={(event) => change(() => setVolume(event.target.value))}
                  placeholder="Use the matching volume basis above"
                />
              </label>
              <button
                className="primary product-calculate"
                type="submit"
                disabled={!canCalculate || busy}
              >
                {busy ? 'Calculating…' : 'Simulate my mix mass'}
              </button>
              <p className="helper">
                Only your entered processed-mix densities and volume enter this calculation.
              </p>
            </div>
          </>
        )}
        {error && (
          <p className="product-error" role="alert">
            {error}
          </p>
        )}
      </form>
      <section
        ref={output}
        tabIndex={-1}
        className="product-output mix-output"
        aria-label="My mix results"
      >
        {property !== 'mass' ? (
          <div className="missing-link" role="status">
            <span className="data-kind">Measurement needed</span>
            <h2>
              {property === 'absorption'
                ? 'Sound absorption needs its own test'
                : property === 'blocking'
                  ? 'Sound blocking needs its own test'
                  : `${otherProperty || 'This property'} needs a matching measurement`}
            </h2>
            <p>
              {property === 'absorption'
                ? `Needed: sound-absorption measurements of ${sourceDescription}, made by your stated process, at the stated thickness and frequencies in the stated installation.`
                : property === 'blocking'
                  ? `Needed: sound-transmission measurements of ${sourceDescription}, made by your stated process, at the stated thickness and frequencies in the stated installation. Absorption data cannot answer a blocking target.`
                  : `Needed: measurements of ${otherProperty || 'the chosen property'} linked to ${sourceDescription}, the stated process and this product configuration.`}
            </p>
            <p className="helper">
              This version calculates mass from entered density readings. It does not yet calculate
              this property. Stored studies do not fill the missing link, and no numerical result
              has been generated.
            </p>
          </div>
        ) : result ? (
          <>
            <div className="product-output-heading">
              <div>
                <span className="data-kind">Simulation · my entered readings</span>
                <h2>{result.product_name} mass</h2>
              </div>
              <button type="button" className="text-button" onClick={() => downloadResult(result)}>
                Download JSON
              </button>
            </div>
            <p className="product-result-context">
              {result.case.label} · {quantity(result.volume_cm3, 2)} cm³ · {result.reading_count}{' '}
              entered density readings
            </p>
            <div className="product-metrics">
              <div>
                <strong>
                  {quantity(result.mean_density_mass_kg)} <small>kg</small>
                </strong>
                <span>Using the mean of all entered readings, including repeats</span>
              </div>
              <div>
                <strong>
                  {quantity(result.observed_mass_min_kg)}–{quantity(result.observed_mass_max_kg)}{' '}
                  <small>kg</small>
                </strong>
                <span>Simulated range across these entered readings</span>
              </div>
            </div>
            <p className="source-scenario-count" role="status">
              <strong>
                {result.readings_in_target} of {result.reading_count}
              </strong>{' '}
              reading-based mass scenarios fall inside your {quantity(result.target_min_kg)}–
              {quantity(result.target_max_kg)} kg target.
            </p>
            <p className="product-scope-note">
              This simulates the readings you entered at an exact assumed volume. The mean is
              reading-weighted; repeated tests are not additional specimens or batches. These
              scenarios do not establish finished-product consistency or predict future batches.
            </p>
            <div className="product-reading-table">
              <table>
                <caption>
                  Each entered density is scaled separately. Group labels are supplied by you.
                </caption>
                <thead>
                  <tr>
                    <th>Reading</th>
                    <th>Density (g/cm³)</th>
                    <th>Simulated mass (kg)</th>
                    <th>Grouping</th>
                  </tr>
                </thead>
                <tbody>
                  {result.reading_scenarios.map((row, index) => (
                    <tr key={row.id}>
                      <th>
                        {index + 1}
                        {row.reading_kind === 'repeat' ? ' (repeat)' : ''}
                      </th>
                      <td>{quantity(row.value_g_cm3, 5)}</td>
                      <td>{quantity(row.mass_kg, 5)}</td>
                      <td>
                        {[
                          row.batch_id && `Batch ${row.batch_id}`,
                          row.run_id && `Run ${row.run_id}`,
                          row.specimen_id && `Specimen ${row.specimen_id}`,
                        ]
                          .filter(Boolean)
                          .join(' / ') || 'Unknown'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <section className="volume-choice">
              <h3>Your recorded grouping</h3>
              <p>
                {result.grouping.identified_batch_count} user-identified{' '}
                {result.grouping.identified_batch_count === 1 ? 'batch' : 'batches'} ·{' '}
                {result.grouping.unknown_batch_reading_count} readings with unknown batch ·{' '}
                {result.grouping.repeat_reading_count} marked repeats
              </p>
              <p className="helper">
                These are descriptions of the entered readings and your labels. Separate batches are
                reported only where you identified them; their future performance is not predicted.
              </p>
              {result.grouping.batch_groups.length > 0 && (
                <div className="product-reading-table">
                  <table>
                    <caption>Observed readings grouped by user-identified batch</caption>
                    <thead>
                      <tr>
                        <th>Batch</th>
                        <th>Readings</th>
                        <th>Simulated mass range (kg)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.grouping.batch_groups.map((row) => (
                        <tr key={row.batch_id}>
                          <th>{row.batch_id}</th>
                          <td>{row.reading_count}</td>
                          <td>
                            {quantity(row.mass_min_kg, 5)}–{quantity(row.mass_max_kg, 5)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(result.grouping.run_groups.length > 0 ||
                result.grouping.specimen_groups.length > 0) && (
                <details className="product-detail">
                  <summary>Recorded runs and specimens</summary>
                  {result.grouping.run_groups.map((row, index) => (
                    <p key={`run-${index}`}>
                      Batch {row.batch_id || 'unknown'} / Run {row.run_id}: {row.reading_count}{' '}
                      readings, simulated {quantity(row.mass_min_kg, 5)}–
                      {quantity(row.mass_max_kg, 5)} kg.
                    </p>
                  ))}
                  {result.grouping.specimen_groups.map((row, index) => (
                    <p key={`specimen-${index}`}>
                      Batch {row.batch_id || 'unknown'} / Run {row.run_id || 'unknown'} / Specimen{' '}
                      {row.specimen_id}: {row.reading_count} readings, simulated{' '}
                      {quantity(row.mass_min_kg, 5)}–{quantity(row.mass_max_kg, 5)} kg.
                    </p>
                  ))}
                </details>
              )}
            </section>
            <details className="product-detail">
              <summary>Entered case and calculation notes</summary>
              <p>
                {result.case.components
                  .map(
                    (item) =>
                      `${item.name}: ${item.amount} ${item.unit === 'g' ? 'g' : item.unit === 'mass_percent' ? 'mass %' : 'volume %'}`,
                  )
                  .join('; ')}
              </p>
              <p>Amount basis: {result.case.amount_basis}</p>
              <p>Process: {result.case.process}</p>
              <p>Density method: {result.case.density_method}</p>
              <p>
                Density volume basis: {result.case.density_volume_basis.replaceAll('_', ' ')}.
                Calculation volume basis:{' '}
                {result.case.calculation_volume_basis.replaceAll('_', ' ')}.
              </p>
              <p>{result.case.volume_basis_details}</p>
              <ul>
                {result.assumptions.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
              <p>Case reference: {result.case_fingerprint.slice(0, 16)}</p>
            </details>
          </>
        ) : (
          <div className="product-empty">
            <span className="data-kind">My mix · measurement needed</span>
            <h2>Start with your processed mix</h2>
            <p>
              Describe the recipe and process, record how density was measured, then enter the
              individual readings. Your inputs start empty; the published polyethylene example is
              kept separate.
            </p>
            <div className="mass-equation">Mass = measured mix density × volume</div>
            <p className="helper">
              No component densities, loose dust densities or stored study values fill missing
              measurements. A result will be a simulation of your entered readings.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
