import type { AdvisorBrief, CalculationDetails, MixAmountUnit } from '../types'

type Component = CalculationDetails['components'][number]

export function CaseDetails({
  details,
  onChange,
}: {
  details: CalculationDetails
  onChange: (details: CalculationDetails) => void
}) {
  function updateComponent(id: number, update: Partial<Component>) {
    onChange({
      ...details,
      components: details.components.map((component) =>
        component.id === id ? { ...component, ...update } : component,
      ),
    })
  }

  const amountTotal = details.components.reduce((sum, component) => {
    const amount = Number(component.amount)
    return sum + (Number.isFinite(amount) ? amount : 0)
  }, 0)

  return (
    <details id="case-calculation-details" className="workshop-case-details">
      <summary>Details for calculations</summary>
      <p>
        Your material, product and process already come from this case. Add precise quantities here
        once when a calculation needs them; the tools below use the same details.
      </p>
      <p className="workshop-case-details-note">
        Names, amounts and targets are not inferred from your description. Leave unknown values
        blank.
      </p>
      <label>
        Case name (optional)
        <input
          maxLength={120}
          value={details.label}
          onChange={(event) => onChange({ ...details, label: event.target.value })}
          placeholder="Current case"
        />
      </label>
      <div className="workshop-case-details-group">
        <h3>Exact recipe</h3>
        <p>Use the materials and amounts in the processed mix you measured.</p>
        <label>
          Amount unit
          <select
            value={details.amount_unit}
            onChange={(event) =>
              onChange({ ...details, amount_unit: event.target.value as MixAmountUnit })
            }
          >
            <option value="g">Grams</option>
            <option value="mass_percent">Mass percent</option>
            <option value="volume_percent">Volume percent</option>
          </select>
        </label>
        {details.components.map((component, index) => (
          <div className="workshop-case-component" key={component.id}>
            <div className="workshop-case-component-heading">
              <h4>Material {index + 1}</h4>
              <button
                type="button"
                disabled={details.components.length <= 1}
                aria-label={`Remove material ${index + 1}`}
                onClick={() =>
                  onChange({
                    ...details,
                    components: details.components.filter((item) => item.id !== component.id),
                  })
                }
              >
                Remove
              </button>
            </div>
            <label>
              Material {index + 1} name
              <input
                maxLength={120}
                value={component.name}
                onChange={(event) => updateComponent(component.id, { name: event.target.value })}
                placeholder="Exact material name"
              />
            </label>
            <div className="workshop-case-component-pair">
              <label>
                Material {index + 1} role
                <select
                  value={component.role}
                  onChange={(event) =>
                    updateComponent(component.id, { role: event.target.value as Component['role'] })
                  }
                >
                  <option value="main">Main material</option>
                  <option value="binder">Binder</option>
                  <option value="other">Other material</option>
                </select>
              </label>
              <label>
                Material {index + 1} amount ({details.amount_unit === 'g' ? 'g' : '%'})
                <input
                  type="number"
                  min="0.000001"
                  max={details.amount_unit === 'g' ? '1000000' : '100'}
                  step="any"
                  value={component.amount}
                  onChange={(event) =>
                    updateComponent(component.id, { amount: event.target.value })
                  }
                />
              </label>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="outline-button workshop-case-add"
          disabled={details.components.length >= 20}
          onClick={() =>
            onChange({
              ...details,
              components: [
                ...details.components,
                {
                  id: Math.max(0, ...details.components.map((component) => component.id)) + 1,
                  name: '',
                  role: 'other',
                  amount: '',
                },
              ],
            })
          }
        >
          Add material
        </button>
        {details.amount_unit !== 'g' && (
          <p className="workshop-case-details-note">
            Complete recipe percentages must total 100. Current total:{' '}
            {amountTotal.toLocaleString('en-US', { maximumFractionDigits: 6 })}%.
          </p>
        )}
        <label>
          Amount basis
          <input
            maxLength={300}
            value={details.amount_basis}
            onChange={(event) => onChange({ ...details, amount_basis: event.target.value })}
            placeholder="For example, dry mass or as received"
          />
        </label>
      </div>
      <div className="workshop-case-details-group">
        <h3>Mass target</h3>
        <p>Enter the numeric mass range once for the mass calculation and weight adjustment.</p>
        <div className="workshop-case-component-pair">
          <label>
            Mass target minimum (kg)
            <input
              type="number"
              min="0"
              max="1000000"
              step="any"
              value={details.mass_target_min_kg}
              onChange={(event) => onChange({ ...details, mass_target_min_kg: event.target.value })}
            />
          </label>
          <label>
            Mass target maximum (kg)
            <input
              type="number"
              min="0.000001"
              max="1000000"
              step="any"
              value={details.mass_target_max_kg}
              onChange={(event) => onChange({ ...details, mass_target_max_kg: event.target.value })}
            />
          </label>
        </div>
      </div>
    </details>
  )
}

export function CaseSummary({ brief }: { brief: AdvisorBrief }) {
  const fields = [
    ['Product', brief.product],
    ['Material', brief.input],
    ['Targets', brief.targets],
    ['Process', brief.process],
  ]

  return (
    <aside className="workshop-case-summary" aria-label="Current case">
      <p className="workshop-eyebrow">Using your case</p>
      <dl>
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value.trim() || `Add ${label.toLowerCase()} to your case at the top.`}</dd>
          </div>
        ))}
      </dl>
    </aside>
  )
}
