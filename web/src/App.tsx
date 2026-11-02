import { Workshop } from './components/Workshop'
import { UnitSystemProvider, UnitSystemToggle } from './units'

export default function App() {
  return (
    <UnitSystemProvider>
      <header className="workshop-header">
        <div className="workshop-brand">
          <a href="/" className="workshop-wordmark">
            <span className="workshop-brand-mark" aria-hidden="true" />
            ReMatter
          </a>
          <span>Your AI upcycling engineer</span>
        </div>
        <details className="workshop-unit-menu">
          <summary>Units</summary>
          <div>
            <UnitSystemToggle />
          </div>
        </details>
      </header>
      <Workshop />
    </UnitSystemProvider>
  )
}
