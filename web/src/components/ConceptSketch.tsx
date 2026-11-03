import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { configurationKey, currentConfigurations, type ProjectWorkspace } from '../projectWorkspace'
import { appendRectangularSection, parseRectangularSection, type RectangularSection, type SectionUnit } from '../sectionDrawing'
import { sketchFingerprint, sketchPrompt } from '../sketchContext'

type Props = {
  workspace: ProjectWorkspace; includeIdeas: boolean; canGenerate: boolean
  image: string | null; section: RectangularSection | null
  onImage: (image: string | null, fingerprint: string) => void
  onSection: (section: RectangularSection | null, fingerprint: string) => void
  onConfigureProvider?: () => void
}

/** The image is a concept; the optional rectangular section uses entered dimensions. */
export function ConceptSketch({ workspace, includeIdeas, canGenerate, image, section, onImage, onSection, onConfigureProvider }: Props) {
  const [planKey, setPlanKey] = useState('')
  const [extra, setExtra] = useState('')
  const [span, setSpan] = useState('')
  const [thickness, setThickness] = useState('')
  const [unit, setUnit] = useState<SectionUnit>('mm')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const drawing = useRef<HTMLDivElement>(null)
  const fingerprint = sketchFingerprint(workspace, includeIdeas)
  const plans = includeIdeas ? currentConfigurations(workspace) : []
  const prompt = sketchPrompt(workspace, planKey, includeIdeas, section, extra)
  const parsed = parseRectangularSection(span, thickness, unit)
  useEffect(() => {
    if (!drawing.current) return
    drawing.current.replaceChildren()
    if (section) appendRectangularSection(document, drawing.current, section)
  }, [section])
  async function create() {
    if (busy || !canGenerate || !prompt.trim() || prompt.length > 30000) return
    const requestedFingerprint = fingerprint
    const requestedPrompt = prompt
    setBusy(true); setError('')
    try {
      const result = await api<{ kind: string; image_data_url: string }>('/api/project/concept-sketch', { prompt: requestedPrompt })
      if (result.kind !== 'concept_sketch' || typeof result.image_data_url !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(result.image_data_url)) throw new Error('Could not read the generated image. Try again.')
      onImage(result.image_data_url, requestedFingerprint)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  function changeDimension(update: () => void) {
    update(); onSection(null, fingerprint); onImage(null, fingerprint)
  }
  return <details className="pw-card pw-spaced">
    <summary>Picture your idea</summary>
    <p>Make an illustration from your project details. For a rectangular product, you can also draw its outer section from your own dimensions.</p>
    <p>Illustrations and sections stay in this session; include them in your PDF before you leave.</p>
    {plans.length > 0 && <label>Plan to picture
      <select value={plans.some((plan) => configurationKey(plan) === planKey) ? planKey : ''} disabled={busy} onChange={(e) => { setPlanKey(e.target.value); onSection(null, fingerprint); onImage(null, fingerprint) }}>
        <option value="">Project details only</option>{plans.map((plan) => <option key={configurationKey(plan)} value={configurationKey(plan)}>{plan.name}</option>)}
      </select>
    </label>}
    <details className="pw-spaced"><summary>Add a rectangular section</summary>
      <p>Enter the distance across the cut and its thickness. The drawing shows the outer shape only.</p>
      <label>Span across the cut<input inputMode="decimal" value={span} disabled={busy} onChange={(e) => changeDimension(() => setSpan(e.target.value))} /></label>
      <label>Thickness<input inputMode="decimal" value={thickness} disabled={busy} onChange={(e) => changeDimension(() => setThickness(e.target.value))} /></label>
      <label>Unit<select value={unit} disabled={busy} onChange={(e) => changeDimension(() => setUnit(e.target.value as SectionUnit))}><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option><option value="in">in</option></select></label>
      <button type="button" disabled={!parsed || busy} onClick={() => { onSection(parsed, fingerprint); onImage(null, fingerprint) }}>Draw section</button>
      {section && <figure><div ref={drawing} /><figcaption>Outer section drawn from the dimensions you entered.</figcaption></figure>}
    </details>
    <label>Additional picture details (optional)<textarea value={extra} maxLength={1200} disabled={busy} onChange={(e) => { setExtra(e.target.value); onImage(null, fingerprint) }} placeholder="For example: a textured surface" /></label>
    <details><summary>Review the description sent to Meta</summary><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{prompt || 'Add your project details first.'}</p></details>
    <p>Your description is sent to Meta when you create an illustration. Image charges may apply.</p>
    {!canGenerate && <p>Connect Meta in AI settings to create an illustration. The section drawing works without it. {onConfigureProvider && <button type="button" onClick={onConfigureProvider}>AI settings</button>}</p>}
    {prompt.length > 30000 && <p className="pw-error" role="alert">The description is too long. Shorten your project details before creating an illustration.</p>}
    <button type="button" disabled={busy || !canGenerate || !prompt.trim() || prompt.length > 30000} onClick={create}>{busy ? 'Creating…' : 'Create illustration'}</button>
    {error && <p className="pw-error" role="alert">{error}</p>}
    {image && <figure><img src={image} alt="AI illustration of the product concept" style={{ maxWidth: '100%', maxHeight: 480, objectFit: 'contain' }} /><figcaption>AI illustration. Dimensions and internal details are not verified.</figcaption><button type="button" onClick={() => onImage(null, fingerprint)}>Remove image</button></figure>}
  </details>
}
