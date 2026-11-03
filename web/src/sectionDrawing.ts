/** A section envelope based only on two dimensions explicitly supplied by the user. */
export type SectionUnit = 'mm' | 'cm' | 'm' | 'in'
export type RectangularSection = { span: string; thickness: string; unit: SectionUnit; spanMm: number; thicknessMm: number }

export function parseRectangularSection(span: string, thickness: string, unit: SectionUnit): RectangularSection | null {
  const factor = { mm: 1, cm: 10, m: 1000, in: 25.4 }[unit]
  const validNumber = (v: string) => /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(v.trim())
  if (!factor || !validNumber(span) || !validNumber(thickness)) return null
  const spanMm = Number(span) * factor, thicknessMm = Number(thickness) * factor
  if (!Number.isFinite(spanMm) || !Number.isFinite(thicknessMm) || spanMm <= 0 || thicknessMm <= 0 || spanMm > 1e9 || thicknessMm > 1e9) return null
  return { span: span.trim(), thickness: thickness.trim(), unit, spanMm, thicknessMm }
}

/** A proportional outer rectangle; no layers or physical properties are inferred. */
export function appendRectangularSection(doc: Document, parent: HTMLElement, section: RectangularSection): void {
  const checked = parseRectangularSection(section.span, section.thickness, section.unit)
  if (!checked) return
  const ns = 'http://www.w3.org/2000/svg'
  const svg = doc.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 640 250')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', `Rectangular section: span ${checked.span} ${checked.unit}, thickness ${checked.thickness} ${checked.unit}`)
  svg.setAttribute('style', 'display:block;width:100%;max-width:640px;height:auto')
  const scale = Math.min(480 / checked.spanMm, 130 / checked.thicknessMm)
  const width = checked.spanMm * scale, height = checked.thicknessMm * scale
  const x = 110 + (480 - width) / 2, y = 35 + (130 - height) / 2
  const add = (name: string, attrs: Record<string, string | number>, value?: string) => {
    const node = doc.createElementNS(ns, name)
    Object.entries(attrs).forEach(([key, val]) => node.setAttribute(key, String(val)))
    if (value !== undefined) node.textContent = value
    svg.appendChild(node)
  }
  add('rect', { x, y, width, height, fill: '#d7ece4', stroke: '#164f40', 'stroke-width': 1.5 })
  add('line', { x1: x, y1: 188, x2: x + width, y2: 188, stroke: '#164f40', 'stroke-width': 1 })
  for (const edge of [x, x + width]) add('line', { x1: edge, y1: 181, x2: edge, y2: 195, stroke: '#164f40' })
  add('text', { x: x + width / 2, y: 216, 'text-anchor': 'middle', fill: '#164f40', 'font-size': 21 }, `Span ${checked.span} ${checked.unit}`)
  add('line', { x1: 70, y1: y, x2: 70, y2: y + height, stroke: '#164f40', 'stroke-width': 1 })
  for (const edge of [y, y + height]) add('line', { x1: 63, y1: edge, x2: 77, y2: edge, stroke: '#164f40' })
  add('text', { x: 18, y: 25, fill: '#164f40', 'font-size': 21 }, `Thickness ${checked.thickness} ${checked.unit}`)
  parent.appendChild(svg)
}
