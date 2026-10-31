import { Workshop } from './components/Workshop'

export default function App() {
  return (
    <>
      <header className="workshop-header">
        <a href="/" className="workshop-wordmark">
          ReMatter
        </a>
        <span>Practical paths for changing materials</span>
      </header>
      <Workshop />
    </>
  )
}
