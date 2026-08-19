"use client"

import { type ReactNode, useEffect } from "react"
import {
  type AreaVariant,
  type StrokeVariant,
  useChartPart,
} from "./chart-context"
import { SeriesContext } from "./series-context"

export type BarProps = {
  dataKey: string
  variant?: AreaVariant
  strokeVariant?: StrokeVariant
  isClickable?: boolean
  children?: ReactNode
}

export function Bar({
  dataKey,
  variant = "gradient",
  strokeVariant = "solid",
  isClickable = false,
  children,
}: BarProps) {
  const ctx = useChartPart("Bar", "bar")
  const { registerSeries, unregisterSeries } = ctx

  if (process.env.NODE_ENV !== "production" && !ctx.config[dataKey]) {
    console.warn(
      `<Bar dataKey="${dataKey}" />: "${dataKey}" is not in the chart \`config\`. Add it so the series has a colour and label.`,
    )
  }

  useEffect(() => {
    registerSeries({ dataKey, kind: "bar", variant, strokeVariant })
    return () => unregisterSeries(dataKey)
  }, [dataKey, variant, strokeVariant, registerSeries, unregisterSeries])

  const band = ctx.bands[dataKey]
  if (!ctx.ready || !band) return null

  const seed = ctx.seedOf(dataKey)
  const dimmed = ctx.selectedDataKey !== null && ctx.selectedDataKey !== dataKey
  const seriesIndex = ctx.configKeys.indexOf(dataKey)
  const seriesCount = ctx.configKeys.length
  const onClick = () =>
    ctx.selectDataKey(ctx.selectedDataKey === dataKey ? null : dataKey)

  return (
    <>
      {isClickable &&
        band.map((bounds, index) => {
          const value = ctx.data[index]?.[dataKey]
          if (!(typeof value === "number" && Number.isFinite(value))) return null
          const slot = ctx.barSlot(index, seriesIndex, seriesCount)
          const top = ctx.y(bounds[1])
          const base = ctx.y(bounds[0])
          return (
            <rect
              key={`${dataKey}:${index}`}
              x={slot.x}
              y={Math.min(top, base)}
              width={slot.width}
              height={Math.abs(base - top)}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onClick={onClick}
            />
          )
        })}
      <SeriesContext value={{ dataKey, seed, dimmed }}>
        {children}
      </SeriesContext>
    </>
  )
}
