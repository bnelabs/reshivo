import { useState } from 'react'
import type { ProjectWorkspace, SavedMixAdjustmentDraft, TrialConfiguration } from '../projectWorkspace'
import { recordedRecipeFraction } from '../referenceComposition'

export function RecordedRecipeReference({ workspace, destination, component, setupName, targetOccupied, appliedReference, disabled, onUse }: {
  workspace: ProjectWorkspace
  destination: TrialConfiguration
  component: { id: string; name: string }
  setupName: (setup: TrialConfiguration) => string
  targetOccupied: boolean
  appliedReference?: SavedMixAdjustmentDraft['reference']
  disabled: boolean
  onUse: (source: TrialConfiguration, sourceComponent: { id: string; name: string }, latestRevision: number) => void
}) {
  const [sourceKey, setSourceKey] = useState('')
  const [sourceComponentId, setSourceComponentId] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const key = (setup: TrialConfiguration) => JSON.stringify([setup.id, setup.revision])
  const source = workspace.configurations.find((item) => key(item) === sourceKey)
  const sourceComponent = source?.materials.find((item) => item.id === sourceComponentId)
  const point = source && sourceComponent ? recordedRecipeFraction(source, sourceComponent.id) : null
  const alreadyApplied = Boolean(source && sourceComponent && point?.ok && appliedReference?.setup_id === source.id && appliedReference.setup_revision === source.revision && appliedReference.component_id === sourceComponent.id && appliedReference.fraction === point.value)
  const latestRevision = source ? Math.max(...workspace.configurations.filter((item) => item.id === source.id).map((item) => item.revision)) : -1
  return <details className="pw-spaced">
    <summary>Use a recorded recipe as a starting point</summary>
    <p>Choose a recorded setup and the ingredient that corresponds to {component.name}. The fraction uses its whole recipe, including binder and any other ingredients.</p>
    <label>Recorded setup
      <select value={sourceKey} onChange={(event) => { setSourceKey(event.target.value); setSourceComponentId(''); setConfirmed(false) }}>
        <option value="">Choose a recorded setup</option>
        {workspace.configurations.map((item) => <option value={key(item)} key={key(item)}>{setupName(item)} · version {item.revision}</option>)}
      </select>
    </label>
    {source && <>
      <p>{setupName(source)} · version {source.revision}{latestRevision > source.revision ? ' (earlier version)' : ''}</p>
      <label>Matching ingredient in this recipe
        <select value={sourceComponentId} onChange={(event) => { setSourceComponentId(event.target.value); setConfirmed(false) }}>
          <option value="">Choose the matching ingredient</option>
          {source.materials.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </label>
      <p><strong>Recorded recipe</strong></p>
      <ul>{source.materials.map((item) => <li key={item.id}>{item.name}: {item.amount || 'unknown'} {item.unit === 'mass_percent' ? 'mass %' : item.unit === 'volume_percent' ? 'volume %' : item.unit}</li>)}</ul>
      <p>This selects a recipe composition. Review its product checks in Checks.</p>
      {point && (point.ok ? <>
        <p><strong>{point.value}% {sourceComponent?.name}</strong> by mass of the entire recorded recipe.</p>
        <label className="pw-checkbox"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          I want to use this whole-recipe fraction for {component.name}; my portion and added-stock percentages use that same basis.
        </label>
        {targetOccupied && !alreadyApplied && <p>To use this point, first clear both trial composition fields below.</p>}
        {alreadyApplied ? <p>This point is in your trial composition below.</p> : <button type="button" disabled={!confirmed || targetOccupied || disabled} onClick={() => sourceComponent && onUse(source, sourceComponent, latestRevision)}>Use {point.value}% as my trial point</button>}
      </> : <p>{point.reason}</p>)}
    </>}
    <p>For a feed-only fraction or another basis, enter your own trial range below.</p>
    <small>The target is saved with {setupName(destination)} · version {destination.revision}.</small>
  </details>
}
