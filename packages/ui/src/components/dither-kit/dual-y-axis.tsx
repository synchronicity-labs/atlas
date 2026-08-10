"use client"

import { useChartPart } from "./chart-context"

export function RightYAxis({
	tickFormatter,
	tickCount = 4,
	tickMargin = 8,
}: {
	tickFormatter?: (value: number) => string
	tickCount?: number
	tickMargin?: number
}) {
	const chart = useChartPart("RightYAxis")
	if (!chart.ready) return null

	return (
		<g className="fill-current font-mono text-[10px] text-muted-foreground">
			{chart.y.ticks(tickCount).map((tick) => (
				<text
					key={tick}
					x={chart.plot.width + tickMargin}
					y={chart.y(tick)}
					textAnchor="start"
					dominantBaseline="central"
					fill="currentColor"
				>
					{tickFormatter ? tickFormatter(tick) : tick}
				</text>
			))}
		</g>
	)
}
