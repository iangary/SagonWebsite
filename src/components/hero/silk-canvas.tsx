'use client'

import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { SilkScene } from './silk-scene'

/*
 * R3F 畫布。default export 是 hero-visual 動態載入的分割點 ——
 * three.js 這一大包只有走到這裡才會下載。
 */
export default function SilkCanvas({ onFirstFrame }: { onFirstFrame?: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [running, setRunning] = useState(true)

  // 分頁隱藏或 Hero 捲出視窗時停掉 render loop，不白燒 GPU
  useEffect(() => {
    let pageVisible = !document.hidden
    let heroVisible = true
    const update = () => setRunning(pageVisible && heroVisible)

    const onVisibility = () => {
      pageVisible = !document.hidden
      update()
    }
    document.addEventListener('visibilitychange', onVisibility)

    const io = new IntersectionObserver((entries) => {
      heroVisible = entries[0]?.isIntersecting ?? true
      update()
    })
    if (wrapRef.current) io.observe(wrapRef.current)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      io.disconnect()
    }
  }, [])

  return (
    <div ref={wrapRef} className="h-full w-full">
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: false, alpha: true, powerPreference: 'low-power' }}
        camera={{ position: [0, 0, 1.2], fov: 45 }}
        frameloop={running ? 'always' : 'never'}
      >
        <SilkScene onFirstFrame={onFirstFrame} />
      </Canvas>
    </div>
  )
}
