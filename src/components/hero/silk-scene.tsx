'use client'

import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { silkFragmentShader, silkVertexShader } from './silk-shaders'

/*
 * 絲綢平面本體。顏色取自 globals.css 的品牌 token：
 * cream-100 / cream-300 為底，taupe-400 做緞面高光，rose-accent 只混 6% 提暖。
 */
const COLOR_A = new THREE.Color('#f4f0ea')
const COLOR_B = new THREE.Color('#d9cec0')
const COLOR_C = new THREE.Color('#b8a695')
const ACCENT = new THREE.Color('#c98b7f')

function createUniforms() {
  return {
    uTime: { value: 0 },
    uPointer: { value: new THREE.Vector2() },
    uColorA: { value: COLOR_A },
    uColorB: { value: COLOR_B },
    uColorC: { value: COLOR_C },
    uAccent: { value: ACCENT },
    uAlpha: { value: 1 },
  }
}

export function SilkScene({ onFirstFrame }: { onFirstFrame?: () => void }) {
  const { viewport } = useThree()
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const firedRef = useRef(false)
  const targetRef = useRef(new THREE.Vector2())

  // 分段數只在掛載時決定一次；行動裝置減半，避免低階 GPU 掉幀
  const segments = useMemo<[number, number]>(
    () => (window.innerWidth < 640 ? [48, 32] : [96, 64]),
    [],
  )

  const uniforms = useMemo(() => createUniforms(), [])

  useEffect(() => {
    // 滑鼠掛在 window 上，canvas 本身 pointer-events-none，Hero 的 CTA 才點得到
    const onMove = (e: PointerEvent) => {
      targetRef.current.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -((e.clientY / window.innerHeight) * 2 - 1),
      )
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  useFrame((_, delta) => {
    // 每幀更新走 material ref，不直接改傳給 JSX 的 uniforms 物件
    const u = materialRef.current?.uniforms
    if (!u) return
    // 0.25 倍速：慵懶的呼吸感，不是躁動的液體；0.05 lerp 讓視差柔和延遲
    u.uTime.value += Math.min(delta, 0.05) * 0.25
    u.uPointer.value.lerp(targetRef.current, 0.05)
    if (!firedRef.current) {
      firedRef.current = true
      onFirstFrame?.()
    }
  })

  return (
    // 1.2 倍撐滿視口，頂點位移後邊緣也不會露出底
    <mesh scale={[viewport.width * 1.2, viewport.height * 1.2, 1]}>
      <planeGeometry args={[1, 1, segments[0], segments[1]]} />
      <shaderMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        vertexShader={silkVertexShader}
        fragmentShader={silkFragmentShader}
        uniforms={uniforms}
      />
    </mesh>
  )
}
