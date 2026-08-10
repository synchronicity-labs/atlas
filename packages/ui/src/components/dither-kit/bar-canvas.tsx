"use client"

import { useEffect, useMemo, useRef } from "react"
import { useChart } from "./chart-context"
import {
  backingSize,
  bloomLayerStyle,
  clamp01,
  easeOutCubic,
  paintColumn,
  prefersReducedMotion,
} from "./dither-paint"

type Bars = { top: number[]; base: number[] }

const STAGGER = 0.55

export function BarCanvas() {
  const ctx = useChart()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bloomRef = useRef<HTMLCanvasElement>(null)
  const { width, height } = ctx.plot
  const { cols, rows } = backingSize(width, height)
  const { ready, configKeys, bands, y } = ctx

  const targets = useMemo(() => {
    const out: Record<string, Bars> = {}
    if (!ready) return out
    const h = height || 1
    for (const key of configKeys) {
      const band = bands[key]
      if (!band) continue
      out[key] = {
        top: band.map((b) => (y(b[1]) / h) * (rows - 1)),
        base: band.map((b) => (y(b[0]) / h) * (rows - 1)),
      }
    }
    return out
  }, [ready, configKeys, bands, y, height, rows])

  const state = useRef(ctx)
  const targetsRef = useRef(targets)
  useEffect(() => {
    state.current = ctx
    targetsRef.current = targets
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const c = canvas?.getContext("2d")
    if (!(canvas && c) || cols <= 0 || rows <= 0) return
    canvas.width = cols
    canvas.height = rows

    const bloomCanvas = bloomRef.current
    const bloomCtx = bloomCanvas?.getContext("2d") ?? null
    if (bloomCanvas) {
      bloomCanvas.width = cols
      bloomCanvas.height = rows
    }

    const reduce = prefersReducedMotion()
    const animate = state.current.animate && !reduce
    const duration = state.current.animationDuration
    const fx = cols / Math.max(width, 1)
    const barProgress = (i: number, len: number, progress: number) => {
      if (!animate) return 1
      const start = len > 1 ? (i / (len - 1)) * STAGGER : 0
      return easeOutCubic(clamp01((progress - start) / (1 - STAGGER)))
    }

    let intensity = 0
    const paint = (progress: number) => {
      const current = state.current
      c.clearRect(0, 0, cols, rows)
      const stacked =
        current.stackType === "stacked" || current.stackType === "percent"
      const keys = current.configKeys
      keys.forEach((key, seriesIndex) => {
        const target = targetsRef.current[key]
        if (!target) return
        const seed = current.seedOf(key)
        const variant = current.seriesSpecs[key]?.variant ?? "gradient"
        const emphasis = current.selectedDataKey ?? current.focusDataKey
        const selectedOpacity = emphasis !== null && emphasis !== key ? 0.3 : 1
        for (let index = 0; index < current.dataLength; index += 1) {
          const progressForBar = barProgress(
            index,
            current.dataLength,
            progress,
          )
          const base = target.base[index] ?? rows - 1
          const grown =
            base + ((target.top[index] ?? base) - base) * progressForBar
          const top = Math.min(grown, base)
          const bottom = Math.max(grown, base)
          const active = current.hoverIndex === index
          const hoverOpacity =
            current.hoverIndex != null && !active && current.isMouseInChart
              ? 0.5
              : 1
          const slot = current.barSlot(index, seriesIndex, keys.length)
          const startColumn = Math.round(slot.x * fx)
          const endColumn = Math.round((slot.x + slot.width) * fx)
          for (let x = startColumn; x < endColumn; x += 1) {
            paintColumn(c, x, top, bottom, seed, {
              variant,
              intensity: intensity + (active ? 0.4 : 0),
              dim: selectedOpacity * hoverOpacity,
              stacked,
            })
          }
        }
      })
    }

    let frame = 0
    let animationStart = 0
    let lastProgress = -1
    let lastRevision = state.current.revision
    let needsPaint = true
    let lastPaintSignature = ""
    let lastSelected: string | null | undefined = Symbol() as never
    let lastHover: number | null | undefined = Symbol() as never

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      const current = state.current
      if (!current.ready) return
      if (bloomCtx) {
        const bloomOn =
          current.bloom !== "off" &&
          (!current.bloomOnHover || current.isMouseInChart || current.hovered)
        if (bloomOn) {
          bloomCtx.clearRect(0, 0, cols, rows)
          bloomCtx.drawImage(canvas, 0, 0)
        }
      }
      if (current.revision !== lastRevision) {
        lastRevision = current.revision
        animationStart = 0
        lastProgress = -1
      }
      if (!animationStart) animationStart = now
      const progress = animate
        ? Math.min(1, (now - animationStart) / duration)
        : 1

      if (progress !== lastProgress) {
        lastProgress = progress
        needsPaint = true
      }
      const emphasis = current.selectedDataKey ?? current.focusDataKey
      if (emphasis !== lastSelected) {
        lastSelected = emphasis
        needsPaint = true
      }
      if (current.hoverIndex !== lastHover) {
        lastHover = current.hoverIndex
        needsPaint = true
      }
      const intensityTarget =
        current.isMouseInChart || current.hovered ? 1 : 0
      if (Math.abs(intensity - intensityTarget) > 0.001) {
        intensity += (intensityTarget - intensity) * (reduce ? 1 : 0.16)
        needsPaint = true
      } else {
        intensity = intensityTarget
      }

      const paintSignature = `${current.stackType}|${current.configKeys
        .map((key) => current.seriesSpecs[key]?.variant ?? "")
        .join(",")}`
      if (paintSignature !== lastPaintSignature) {
        lastPaintSignature = paintSignature
        needsPaint = true
      }
      if (!needsPaint) return
      paint(progress)
      needsPaint = false
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [cols, rows, width])

  const bloomActive = ctx.bloomOnHover
    ? ctx.isMouseInChart || ctx.hovered
    : true
  const bloom = bloomLayerStyle(ctx.bloom, bloomActive)
  const position = {
    left: ctx.margins.left,
    top: ctx.margins.top,
    width,
    height,
  } as const

  return (
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute"
        style={{ ...position, imageRendering: "pixelated" }}
      />
      <canvas
        ref={bloomRef}
        className="pointer-events-none absolute"
        style={{
          ...position,
          transition: "opacity 220ms ease",
          ...(bloom ?? { opacity: 0 }),
        }}
      />
    </>
  )
}
