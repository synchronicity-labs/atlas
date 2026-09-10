export function boundRevenueUsage(number: number, sql: string): string {
	if (![1101, 1102, 1110, 1112, 1118, 1119].includes(number)) return sql;
	return sql.replace(
		/, usage as \(\n([\s\S]*?)\n\)(?=,|\nselect)/i,
		(original, body: string) => {
			const source =
				/from sync_prod\.sync_usage3\s+cross join (bounds|periods)(?=\s*(?:group by|$))/i;
			const match = source.exec(body);
			if (!match) return original;
			const period = match[1]?.toLowerCase();
			const start =
				period === "periods"
					? "(select min(period_start) from periods)"
					: number === 1101
						? "addMonths(bounds.month_start, -1)"
						: "bounds.month_start";
			const end =
				period === "periods"
					? "(select max(period_end) from periods)"
					: "bounds.data_through";
			const bounded = body.replace(
				source,
				(from) =>
					`${from}\n  where "generationEndedAt" >= ${start}\n    and "generationEndedAt" < ${end}`,
			);
			if (period === "bounds") return `, usage as (\n${bounded}\n)`;
			if (
				!body.includes("as usage_actual") ||
				!body.includes(
					"group by periods.period_start, periods.period_end, periods.is_current",
				)
			)
				return original;
			return `, usage_totals as (
${bounded}
), usage as (
  select periods.period_start, periods.period_end, periods.is_current,
    coalesce(usage_totals.usage_actual, 0) as usage_actual
  from periods
  left join usage_totals using (period_start, period_end, is_current)
)`;
		},
	);
}
