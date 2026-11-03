import { useState } from 'react'
import { api } from '../api'

/** An explicit paid request; generated images remain in the current page only. */
export function ConceptSketch({ image, onImage }: { image: string | null; onImage: (image: string | null) => void }) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function create() {
    if (busy || !prompt.trim()) return
    setBusy(true); setError('')
    try {
      const result = await api<{ kind: string; image_data_url: string }>('/api/project/concept-sketch', { prompt: prompt.trim() })
      if (result.kind !== 'concept_sketch' || typeof result.image_data_url !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(result.image_data_url)) throw new Error('Could not read the generated image. Try again.')
      onImage(result.image_data_url)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <details className="pw-card pw-spaced">
    <summary>Picture your idea</summary>
    <p>Describe the product you want to picture. Your description is sent to Meta. Meta currently lists each image at $0.01, charged to your account.</p>
    <label>What should the image show?
      <textarea value={prompt} maxLength={1200} onChange={(e) => setPrompt(e.target.value)} placeholder="For example: a simple floor mat made from recycled rubber pieces" />
    </label>
    <button type="button" disabled={busy || !prompt.trim()} onClick={create}>{busy ? 'Creating…' : 'Create concept sketch'}</button>
    {error && <p className="pw-error" role="alert">{error}</p>}
    {image && <figure><img src={image} alt="Generated product concept" style={{ maxWidth: '100%', maxHeight: 480, objectFit: 'contain' }} /><figcaption>Concept image, not a technical drawing.</figcaption><button type="button" onClick={() => onImage(null)}>Remove image</button></figure>}
  </details>
}
