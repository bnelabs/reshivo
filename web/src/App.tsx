import { ProjectWorkbench } from './components/ProjectWorkbench'
import { UnitSystemProvider } from './units'

export default function App() {
  return (
    <UnitSystemProvider>
      <ProjectWorkbench />
    </UnitSystemProvider>
  )
}
