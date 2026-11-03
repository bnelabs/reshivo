import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toCanonical, toDisplay, unitLabel } from './unitConversion'
import type { CanonicalUnit, UnitSystem } from './unitConversion'

const UnitContext = createContext<{ system: UnitSystem; setSystem: (system: UnitSystem) => void }>({
  system: 'metric',
  setSystem: () => {},
})

export function UnitSystemProvider({ children }: { children: ReactNode }) {
  const [system, setSystem] = useState<UnitSystem>('metric')
  return <UnitContext.Provider value={{ system, setSystem }}>{children}</UnitContext.Provider>
}

export function useUnitSystem() {
  return useContext(UnitContext).system
}

export function useUnitSettings() {
  return useContext(UnitContext)
}

export function UnitSystemToggle() {
  const { system, setSystem } = useContext(UnitContext)
  return (
    <label>
      Mass and balance units
      <select value={system} onChange={(event) => setSystem(event.target.value as UnitSystem)}>
        <option value="metric">Metric (kg, g, mm)</option>
        <option value="us">US customary (lb, in)</option>
      </select>
      <small>Displayed conversions are rounded. Switching preserves values; editing replaces the stored value. Other tools use their shown units.</small>
    </label>
  )
}

export function UnitInput({ value, onChange, unit, disabled = false, maxLength, canonicalize, invalidMessage = 'Enter a valid number.', displaySystem, onFocus, onBlur }: {
  value: string
  onChange: (value: string) => void
  unit: CanonicalUnit
  disabled?: boolean
  maxLength?: number
  canonicalize?: (display: string, unit: CanonicalUnit, system: UnitSystem) => string
  invalidMessage?: string
  displaySystem?: UnitSystem
  onFocus?: () => void
  onBlur?: () => void
}) {
  const currentSystem = useUnitSystem()
  const system = displaySystem ?? currentSystem
  const [draft, setDraft] = useState(() => toDisplay(value, unit, system))
  const latest = useRef({ value, system })
  const invalid = value.startsWith('invalid:') || (value.trim() !== '' && !Number.isFinite(Number(value)))
  useLayoutEffect(() => {
    if (latest.current.value !== value || latest.current.system !== system) {
      setDraft(toDisplay(value, unit, system))
      latest.current = { value, system }
    }
  }, [value, unit, system])
  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        maxLength={maxLength}
        value={draft}
        disabled={disabled}
        aria-invalid={invalid}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(event) => {
          const next = event.target.value
          const canonical = canonicalize ? canonicalize(next, unit, system) : toCanonical(next, unit, system)
          setDraft(next)
          latest.current = { value: canonical, system }
          onChange(canonical)
        }}
      />
      {invalid && invalidMessage && <small>{invalidMessage}</small>}
    </>
  )
}

export { unitLabel, toDisplay }
export { outwardBound } from './unitConversion'
