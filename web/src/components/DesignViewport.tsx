import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Design } from '../types'

function fitGeometry(camera: THREE.PerspectiveCamera, controls: OrbitControls, box: THREE.Box3) {
  const corners = []
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z))
  for (let iteration = 0; iteration < 6; iteration++) {
    camera.updateMatrixWorld()
    const projected = corners.map((point) => point.clone().project(camera))
    const x = projected.map((point) => point.x)
    const y = projected.map((point) => point.y)
    const bounds = [Math.min(...x), Math.max(...x), Math.min(...y), Math.max(...y)]
    const distance = camera.position.distanceTo(controls.target)
    const halfHeight = distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const shift = new THREE.Vector3()
      .setFromMatrixColumn(camera.matrixWorld, 0)
      .multiplyScalar(((bounds[0] + bounds[1]) / 2) * halfHeight * camera.aspect)
    shift.add(
      new THREE.Vector3()
        .setFromMatrixColumn(camera.matrixWorld, 1)
        .multiplyScalar(((bounds[2] + bounds[3]) / 2) * halfHeight),
    )
    controls.target.add(shift)
    camera.position.add(shift)
    const scale = Math.max((bounds[1] - bounds[0]) / 1.62, (bounds[3] - bounds[2]) / 1.62)
    camera.position
      .sub(controls.target)
      .multiplyScalar(Math.max(0.85, Math.min(1.25, scale)))
      .add(controls.target)
    controls.update()
  }
}

export default function DesignViewport({
  design,
  span,
  dirty,
  emptyMessage,
}: {
  design: Design | null
  span: number
  dirty: boolean
  emptyMessage: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const runtime = useRef<{
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    renderer: THREE.WebGLRenderer
    controls: OrbitControls
    mesh?: THREE.Mesh
    edges?: THREE.LineSegments
    render: () => void
    fit?: () => void
  } | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    const host = container.current!
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setUnavailable(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0xf0f5f7, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 10000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false
    controls.minDistance = 50
    controls.maxDistance = 3000
    scene.add(new THREE.HemisphereLight(0xffffff, 0x869da6, 2.7))
    const light = new THREE.DirectionalLight(0xffffff, 3.3)
    light.position.set(100, 300, 200)
    scene.add(light)
    const grid = new THREE.GridHelper(900, 30, 0xd3dfe5, 0xe1e9ed)
    grid.position.y = -25
    scene.add(grid)
    const render = () => renderer.render(scene, camera)
    runtime.current = { scene, camera, renderer, controls, render }
    controls.addEventListener('change', render)
    const observer = new ResizeObserver(() => {
      camera.aspect = host.clientWidth / Math.max(host.clientHeight, 1)
      camera.updateProjectionMatrix()
      renderer.setSize(host.clientWidth, host.clientHeight)
      runtime.current?.fit?.()
      render()
    })
    observer.observe(host)
    return () => {
      observer.disconnect()
      controls.dispose()
      scene.traverse((o) => {
        const item = o as THREE.Mesh
        item.geometry?.dispose()
        const m = item.material
        if (Array.isArray(m)) m.forEach((x) => x.dispose())
        else m?.dispose()
      })
      renderer.dispose()
      renderer.domElement.remove()
      runtime.current = null
    }
  }, [])
  useEffect(() => {
    const r = runtime.current
    if (!r) return
    if (r.mesh) {
      r.scene.remove(r.mesh)
      r.mesh.geometry.dispose()
      ;(r.mesh.material as THREE.Material).dispose()
      r.mesh = undefined
    }
    if (r.edges) {
      r.scene.remove(r.edges)
      r.edges.geometry.dispose()
      ;(r.edges.material as THREE.Material).dispose()
      r.edges = undefined
    }
    if (design && design.outline.length >= 3) {
      const shape = new THREE.Shape(design.outline.map((p) => new THREE.Vector2(p[0], p[1])))
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: span,
        bevelEnabled: false,
        steps: 1,
      })
      geometry.translate(0, 0, -span / 2)
      geometry.computeVertexNormals()
      const material = new THREE.MeshStandardMaterial({
        color: design.family === 'rectangle' ? 0x9aabb7 : 0x088d8d,
        metalness: 0.2,
        roughness: 0.42,
      })
      r.mesh = new THREE.Mesh(geometry, material)
      r.scene.add(r.mesh)
      r.edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x087674, transparent: true, opacity: 0.55 }),
      )
      r.scene.add(r.edges)
      const distance = Math.max(span, design.section.width_mm, design.section.height_mm) * 1.1
      r.camera.position.set(-distance * 0.72, distance * 0.52, distance * 0.85)
      r.camera.near = 0.1
      r.camera.far = Math.max(10000, distance * 10)
      r.camera.updateProjectionMatrix()
      r.controls.target.set(0, 0, 0)
      r.controls.update()
      const bounds = new THREE.Box3().setFromObject(r.mesh)
      r.fit = () => fitGeometry(r.camera, r.controls, bounds)
      r.fit()
    } else {
      r.fit = undefined
    }
    r.render()
  }, [design, span])
  return (
    <div className="viewport" aria-label="Interactive three-dimensional design preview">
      <div className="canvas-host" ref={container} />
      {(!design || design.outline.length < 3 || unavailable) && (
        <div className="viewport-message">
          {unavailable
            ? 'This browser can’t show the 3D preview. You can still download the design.'
            : design
              ? 'These dimensions don’t form a valid shape.'
              : emptyMessage}
        </div>
      )}
      {design && !unavailable && (
        <>
          <span className="span-dimension">{span} mm length</span>
          <span className="section-dimension">
            {design.section.height_mm} mm height
            <br />
            {design.section.width_mm} mm width
          </span>
          <span className="axes" aria-hidden="true">
            <i>Z</i>
            <b>Y</b>
            <em>X</em>
          </span>
          <span className="orbit-hint">Drag to rotate · scroll to zoom</span>
        </>
      )}
      {dirty && <span className="stale-viewport">Previous design</span>}
    </div>
  )
}
