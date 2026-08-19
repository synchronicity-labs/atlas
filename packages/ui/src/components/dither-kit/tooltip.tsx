"use client"

import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"
import { formatMonthPeriod } from "../../lib/format"
import { useCommonChart } from "./common-context"
import { cn } from "./lib"
import { rgb } from "./palette"

export type TooltipVariant = "default" | "frosted-glass"

const VARIANT: Record<TooltipVariant, string> = {
  default: "bg-popover",
  "frosted-glass": "bg-popover/70 backdrop-blur-sm",
}

/**
 * Floating hover tooltip. Reads the shared common context so it works in every
 * chart family. It glides between points and fades in/out (instead of snapping),
 * and dims unselected series/slices.
 */
export function Tooltip({
  labelKey,
  labelFormatter,
  valueFormatter,
  variant = "default",
}: {
  labelKey?: string
  labelFormatter?: (value: string) => string
  valueFormatter?: (value: number, name: string) => string
  variant?: TooltipVariant
}) {
  const chart = useCommonChart()
  const show = chart.ready && chart.hoverIndex != null

  // Retain the last hovered index so the card keeps its content while fading
  // out — adjust-state-during-render (no refs in render).
  const [lastIndex, setLastIndex] = useState(0)
  if (chart.hoverIndex != null && chart.hoverIndex !== lastIndex) {
    setLastIndex(chart.hoverIndex)
  }
  const index = chart.hoverIndex ?? lastIndex

  const heading = chart.heading(index, labelKey)
  const horizontalOffset =
    chart.tooltipLeft < chart.surfaceWidth * 0.3
      ? "0%"
      : chart.tooltipLeft > chart.surfaceWidth * 0.7
        ? "-100%"
        : "-50%"
  const formattedHeading = heading
    ? labelFormatter?.(heading) ??
      formatMonthPeriod(heading, { includeMtd: true })
    : null
  const items = chart.itemsAt(index)

  return (
    <AnimatePresence>
      {show && items.length > 0 && (
        <motion.div
          key="dither-tooltip"
          initial={{
            opacity: 0,
            x: horizontalOffset,
            y: "-115%",
            top: chart.tooltipTop,
            left: chart.tooltipLeft,
          }}
          animate={{
            opacity: 1,
            x: horizontalOffset,
            y: "-115%",
            top: chart.tooltipTop,
            left: chart.tooltipLeft,
          }}
          exit={{ opacity: 0 }}
          transition={{
            type: "spring",
            stiffness: 520,
            damping: 38,
            mass: 0.6,
          }}
          className={cn(
            "pointer-events-none absolute z-50 min-w-48 max-w-80 rounded-md border px-2 py-1 shadow-sm",
            VARIANT[variant]
          )}
        >
          {formattedHeading && (
            <div className="mb-0.5 whitespace-nowrap font-mono text-[10px] text-muted-foreground">
              {formattedHeading}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {items.map((item) => (
              <div
                key={item.name}
                className="flex items-center gap-1.5 font-mono text-[11px] text-popover-foreground tabular-nums"
                style={{ opacity: item.dimmed ? 0.4 : 1 }}
              >
                <span
                  className="size-2 rounded-[1px]"
                  style={{ backgroundColor: rgb(item.seed.fill) }}
                />
                <span className="whitespace-nowrap text-muted-foreground">
                  {item.label}
                </span>
                <span className="ml-auto whitespace-nowrap pl-2 text-foreground">
                  {item.value === null
                    ? "—"
                    : valueFormatter
                      ? valueFormatter(item.value, item.name)
                      : item.value.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

Tooltip.chartLayer = "dom" as const
