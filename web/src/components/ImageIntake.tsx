import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { AdvisorBrief } from '../types'
import './ImageIntake.css'

type VisualResult = {
  observations: string[]
  questions: string[]
  limits: string[]
  live: boolean
}

async function preparePhoto(file: File): Promise<{ data: string; preview: string }> {
  if (!['image/jpeg', 'image/png'].includes(file.type)) throw new Error('Choose a JPEG or PNG image.')
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB.')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16_000_000)
      throw new Error('Choose an image no larger than 16 megapixels.')
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Your browser could not prepare this image.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const preview = canvas.toDataURL('image/jpeg', 0.82)
    const data = preview.split(',')[1]
    if (!data || data.length > 2_000_000) throw new Error('This image could not be reduced enough. Choose a smaller image.')
    return { data, preview }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function ImageIntake({ brief, onApply, mayClearCaseData = false }: { brief: AdvisorBrief; onApply: (note: string) => void; mayClearCaseData?: boolean }) {
  const [photo, setPhoto] = useState<{ data: string; preview: string } | null>(null)
  const [result, setResult] = useState<VisualResult | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [understandsClear, setUnderstandsClear] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const serial = useRef(0)
  const signature = JSON.stringify(brief)
  const currentSignature = useRef(signature)
  currentSignature.current = signature

  useEffect(() => () => { serial.current += 1; controller.current?.abort() }, [])
  useEffect(() => {
    serial.current += 1
    controller.current?.abort()
    setBusy(false)
    setResult(null)
    setNote('')
    setUnderstandsClear(false)
  }, [signature])

  async function choose(file?: File) {
    serial.current += 1
    const current = serial.current
    controller.current?.abort()
    setBusy(false)
    setPhoto(null)
    setResult(null)
    setNote('')
    setUnderstandsClear(false)
    setError('')
    if (!file) return
    try {
      const prepared = await preparePhoto(file)
      if (current === serial.current) setPhoto(prepared)
    } catch (caught) {
      if (current === serial.current) setError(caught instanceof Error ? caught.message : 'Could not open this photo.')
    }
  }

  async function inspect() {
    if (!photo || busy) return
    const current = ++serial.current
    const expected = currentSignature.current
    const request = new AbortController()
    controller.current = request
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const reply = await api<VisualResult>('/api/advisor/inspect-image', {
        image: { media_type: 'image/jpeg', data_base64: photo.data },
        brief,
      }, request.signal)
      if (current !== serial.current || currentSignature.current !== expected) return
      setResult(reply)
      setNote(reply.observations.join('\n'))
    } catch (caught) {
      if (current === serial.current && !request.signal.aborted)
        setError(caught instanceof Error ? caught.message : 'Could not analyze the photo.')
    } finally {
      if (current === serial.current) setBusy(false)
    }
  }

  return (
    <details className="visual-intake">
      <summary>Start with a photo <span>Optional</span></summary>
      <div className="visual-intake-body">
        <p>Show the material you have. Meta will suggest visible details for you to review.</p>
        <label className="visual-intake-file">Choose a photo <input type="file" accept="image/jpeg,image/png" onChange={(event) => void choose(event.target.files?.[0])} /></label>
        {photo && <img className="visual-intake-preview" src={photo.preview} alt="Selected material for review" />}
        <p className="visual-intake-privacy">Your photo and current case are sent to Meta when you choose Analyze photo.</p>
        <button type="button" onClick={() => void inspect()} disabled={!photo || busy}>{busy ? 'Looking at your photo…' : 'Analyze photo'}</button>
        {error && <p role="alert">{error}</p>}
        {result && <div className="visual-intake-result">
          <h3>What the photo may show</h3>
          <p>Review and edit these suggestions. A photo cannot confirm the plastic type, composition or performance.</p>
          <label>Notes to add to your material description<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} /></label>
          {result.questions.length > 0 && <><h4>Useful questions</h4><ul>{result.questions.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
          {result.limits.length > 0 && <p>{result.limits.join(' ')}</p>}
          {mayClearCaseData && <label className="visual-intake-confirm"><input type="checkbox" checked={understandsClear} onChange={(event) => setUnderstandsClear(event.target.checked)} /> Updating the material description clears saved mix details and assembly readings.</label>}
          <button type="button" disabled={!note.trim() || (mayClearCaseData && !understandsClear)} onClick={() => { onApply(note.trim()); setResult(null); setNote(''); setUnderstandsClear(false) }}>Add reviewed notes to my case</button>
        </div>}
      </div>
    </details>
  )
}
