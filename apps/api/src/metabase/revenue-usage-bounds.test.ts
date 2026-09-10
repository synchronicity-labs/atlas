import { describe, expect, test } from "bun:test";
import { boundRevenueUsage } from "./revenue-usage-bounds";

export function usageFixture(number: number) {
	const periods = ![1101, 1102].includes(number);
	const start = periods ? "periods.period_start" : "bounds.month_start";
	const end = periods ? "periods.period_end" : "bounds.data_through";
	return `with bounds as (
  select toDateTime('2026-09-01', 'UTC') as month_start,
    toDateTime('2026-09-11', 'UTC') as data_through
), periods as (
  select addMonths(month_start, -1) as period_start, month_start as period_end, 0 as is_current from bounds
  union all
  select month_start, data_through, 1 from bounds
), usage as (
  select
    ${periods ? "periods.period_start, periods.period_end, periods.is_current," : ""}
    sumIf("generationCostMillicents", "generationEndedAt" >= ${start} and "generationEndedAt" < ${end}) / 100000.0 as ${periods ? "usage_actual" : "current_usage"}${
			number === 1101
				? `,
    sumIf("generationCostMillicents", "generationEndedAt" >= addMonths(bounds.month_start, -1) and "generationEndedAt" < bounds.month_start) / 100000.0 as previous_usage`
				: ""
		}
  from sync_prod.sync_usage3
  cross join ${periods ? "periods" : "bounds"}
  ${periods ? "group by periods.period_start, periods.period_end, periods.is_current" : ""}
)
select * from usage${periods ? " order by period_start" : ""}`;
}

describe("revenue source date bounds", () => {
	test.each([1101, 1102, 1110, 1112, 1118, 1119])(
		"bounds Q%i without changing its source or sums",
		(number) => {
			const before = usageFixture(number);
			const after = boundRevenueUsage(number, before);
			expect(after).toContain('where "generationEndedAt" >=');
			expect(after).toContain("from sync_prod.sync_usage3");
			expect(after.match(/sumIf\([^\n]+/g)).toEqual(
				before.match(/sumIf\([^\n]+/g),
			);
			expect(boundRevenueUsage(number, after)).toBe(after);
			if ([1101, 1102].includes(number)) {
				expect(after).toContain(
					number === 1101
						? 'where "generationEndedAt" >= addMonths(bounds.month_start, -1)'
						: 'where "generationEndedAt" >= bounds.month_start',
				);
			} else {
				expect(after).toContain(
					'where "generationEndedAt" >= (select min(period_start) from periods)',
				);
				expect(after).toContain(
					"left join usage_totals using (period_start, period_end, is_current)",
				);
			}
		},
	);

	test("does not reinterpret unknown questions, changed shapes or an operator source cutover", () => {
		const query = usageFixture(1112);
		expect(boundRevenueUsage(999, query)).toBe(query);
		const changed = query.replace("as usage_actual", "as changed_metric");
		expect(boundRevenueUsage(1112, changed)).toBe(changed);
		const cutover = query.replaceAll("sync_usage3", "sync_usage_by_completion");
		expect(boundRevenueUsage(1112, cutover)).toBe(cutover);
	});
});

const clickhouse = process.env.ATLAS_TEST_CLICKHOUSE_URL;
test.skipIf(!clickhouse)(
	"ClickHouse preserves half-open totals and zero periods for all six queries",
	async () => {
		const run = async (query: string) => {
			const response = await fetch(clickhouse as string, {
				method: "POST",
				body: `${query} FORMAT JSON`,
				headers: { "Content-Type": "text/plain" },
			});
			if (!response.ok) throw new Error(await response.text());
			return ((await response.json()) as { data: Record<string, unknown>[] })
				.data;
		};
		const cases = [
			"('2026-07-31 23:59:59', 100), ('2026-08-01 00:00:00', 200), ('2026-08-31 23:59:59', 300), ('2026-09-01 00:00:00', 400), ('2026-09-10 23:59:59', 500), ('2026-09-11 00:00:00', 600)",
			"('2026-07-01 00:00:00', 900)",
			"('2026-08-15 00:00:00', 200)",
			"('2026-09-05 00:00:00', 400)",
		];
		for (const number of [1101, 1102, 1110, 1112, 1118, 1119]) {
			for (const rows of cases) {
				const source = `values('generationEndedAt DateTime, generationCostMillicents Int64', ${rows}) as fixture_usage`;
				const original = usageFixture(number);
				const bounded = boundRevenueUsage(number, original);
				expect(
					await run(bounded.replace("sync_prod.sync_usage3", source)),
				).toEqual(await run(original.replace("sync_prod.sync_usage3", source)));
			}
			const emptySource =
				"(select toDateTime('2026-07-01') as generationEndedAt, toInt64(0) as generationCostMillicents where 0) as fixture_usage";
			const empty = await run(
				boundRevenueUsage(number, usageFixture(number)).replace(
					"sync_prod.sync_usage3",
					emptySource,
				),
			);
			expect(empty).toHaveLength([1101, 1102].includes(number) ? 1 : 2);
			for (const row of empty)
				expect(Number(row.usage_actual ?? row.current_usage)).toBe(0);
		}
	},
);
