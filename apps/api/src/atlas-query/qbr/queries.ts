import { productCollectionQueries } from "./product-collection";

export const qbrPlgMetricIds = [
	"plg_teams",
	"plg_teams_period_end",
	"plg_teams_adds",
	"plg_teams_losses",
	"plg_teams_net",
	"product_m3_requalification",
	"product_m3_ndr",
	"product_reactivation",
];

export function isQbrPlgQuestion(externalId: string | null) {
	return qbrPlgMetricIds.some((id) => externalId === `qbr:${id}`);
}

export function qbrQuarterValue(
	metricId: string,
	monthlyValues: {
		period: string;
		value: number;
		numerator: number | null;
		denominator: number | null;
		quarterValue?: number | null;
	}[],
	now = new Date(),
) {
	if (now.getTime() < Date.UTC(2026, 9, 1)) return null;
	if (metricId === "product_return_lift") {
		if (now.getTime() < Date.UTC(2026, 9, 15)) return null;
		const quarterValues = monthlyValues
			.map((item) => item.quarterValue)
			.filter((value): value is number => value != null);
		const quarterValue = quarterValues[0];
		if (
			quarterValue === undefined ||
			quarterValues.some((value) => !Number.isFinite(value)) ||
			new Set(quarterValues).size !== 1
		)
			return null;
		return {
			period: "2026-Q3" as const,
			value: quarterValue,
			numerator: null,
			denominator: null,
		};
	}
	const endpointMovements = [
		"plg_teams_adds",
		"plg_teams_losses",
		"plg_teams_net",
	];
	if (
		![
			"plg_teams",
			"plg_teams_period_end",
			"platform_completion",
			"product_feedback_coverage",
			"product_attribution",
			...endpointMovements,
		].includes(metricId)
	)
		return null;
	const quarterMonths = ["2026-07", "2026-08", "2026-09"];
	const values = monthlyValues.filter((item) =>
		quarterMonths.includes(item.period),
	);
	if (
		values.length !== quarterMonths.length ||
		quarterMonths.some(
			(month) => values.filter((item) => item.period === month).length !== 1,
		)
	)
		return null;
	if (endpointMovements.includes(metricId)) {
		const september = values.find((item) => item.period === "2026-09");
		if (
			september?.quarterValue == null ||
			!Number.isFinite(september.quarterValue)
		)
			return null;
		return {
			period: "2026-Q3" as const,
			value: september.quarterValue,
			numerator: september.numerator,
			denominator: september.denominator,
		};
	}
	if (metricId === "plg_teams")
		return {
			period: "2026-Q3" as const,
			value: values.reduce((sum, item) => sum + item.value, 0) / 3,
			numerator: null,
			denominator: null,
		};
	if (metricId === "plg_teams_period_end") {
		const september = values.find((item) => item.period === "2026-09");
		return september
			? {
					period: "2026-Q3" as const,
					value: september.value,
					numerator: september.numerator,
					denominator: september.denominator,
				}
			: null;
	}
	if (
		values.some(
			(item) =>
				item.numerator === null ||
				item.denominator === null ||
				!Number.isFinite(item.numerator) ||
				!Number.isFinite(item.denominator),
		)
	)
		return null;
	const numerator = values.reduce(
		(sum, item) => sum + (item.numerator ?? 0),
		0,
	);
	const denominator = values.reduce(
		(sum, item) => sum + (item.denominator ?? 0),
		0,
	);
	if (denominator <= 0 || numerator < 0) return null;
	return {
		period: "2026-Q3" as const,
		value: Math.round((10000 * numerator) / denominator) / 100,
		numerator,
		denominator,
	};
}

function monthlyProfessionalSource(through: string) {
	return `select toStartOfMonth(toTimeZone(generationEndedAt, 'UTC')) as month, organizationId,
  uniqExact(generationId) as billable_generations,
  uniqExact(toDate(generationEndedAt, 'UTC')) as active_days,
  sum(generationCostMillicents) / 100000.0 as accrued_value
from sync_prod.sync_usage3
where generationEndedAt >= toDateTime('2026-05-01 00:00:00', 'UTC')
  and generationEndedAt < toDateTime('${through} 00:00:00', 'UTC')
  and organizationId != ''
  and organizationPlanType in ('hobbyist','creator','growth','scale','starter','pro','team')
group by month, organizationId`;
}

export function qbrQueries(now = new Date()) {
	const through = new Date(
		Math.min(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
			Date.UTC(2026, 9, 1),
		),
	)
		.toISOString()
		.slice(0, 10);
	if (through <= "2026-07-01")
		throw new Error("No complete Q3 month is available.");
	const monthlyOrgs = monthlyProfessionalSource(through);
	const movement = `with monthly_orgs as (${monthlyOrgs}), professional as (
  select month, organizationId, 1 as qualified from monthly_orgs
  where billable_generations >= 3 and active_days >= 2 and accrued_value >= 100
), spine as (
  select month, organizationId from professional
  union distinct
  select addMonths(month, 1) as month, organizationId from professional
)
select s.month as period_start,
  countIf(c.qualified = 1) as professional_teams,
  countIf(c.qualified = 1 and coalesce(p.qualified, 0) != 1) as gross_adds,
  countIf(p.qualified = 1 and coalesce(c.qualified, 0) != 1) as gross_losses,
  countIf(c.qualified = 1) - countIf(p.qualified = 1) as net_change
from spine s
left join professional c on c.month = s.month and c.organizationId = s.organizationId
left join professional p on p.month = addMonths(s.month, -1) and p.organizationId = s.organizationId
where s.month >= toDate('2026-06-01') and s.month < toDate('${through}')
group by s.month`;
	const quarterMovement = `with monthly_orgs as (${monthlyOrgs}), professional as (
  select month, organizationId from monthly_orgs
  where billable_generations >= 3 and active_days >= 2 and accrued_value >= 100
)
select
  countIf(september = 1 and june = 0) as gross_adds,
  countIf(june = 1 and september = 0) as gross_losses,
  countIf(september = 1) - countIf(june = 1) as net_change
from (
  select organizationId,
    maxIf(1, month = toDate('2026-06-01')) as june,
    maxIf(1, month = toDate('2026-09-01')) as september
  from professional
  where month in (toDate('2026-06-01'), toDate('2026-09-01'))
  group by organizationId
)`;
	const cohorts = `with monthly_orgs as (${monthlyOrgs}), starting as (
  select * from monthly_orgs where billable_generations >= 3 and active_days >= 2 and accrued_value >= 100
)
select addMonths(p.month, 2) as period_start, p.month as cohort_month,
  count() as starting_teams,
  countIf(c.billable_generations >= 3 and c.active_days >= 2 and c.accrued_value >= 100) as requalified_teams,
  sum(p.accrued_value) as starting_accrued_usd,
  sum(coalesce(c.accrued_value,0)) as retained_accrued_usd,
  countIf(coalesce(m2.billable_generations,0) < 3 or coalesce(m2.active_days,0) < 2 or coalesce(m2.accrued_value,0) < 100) as dropped_m2_teams,
  countIf((coalesce(m2.billable_generations,0) < 3 or coalesce(m2.active_days,0) < 2 or coalesce(m2.accrued_value,0) < 100) and c.billable_generations >= 3 and c.active_days >= 2 and c.accrued_value >= 100) as reactivated_m3_teams
from starting p
left join monthly_orgs c on c.organizationId = p.organizationId and c.month = addMonths(p.month, 2)
left join monthly_orgs m2 on m2.organizationId = p.organizationId and m2.month = addMonths(p.month, 1)
where p.month >= toDate('2026-05-01') and addMonths(p.month, 2) < toDate('${through}')
group by p.month`;
	const queries: Record<
		string,
		{ queryText: string; databaseExternalId: string }
	> = {};
	for (const [id, column] of Object.entries({
		plg_teams: "professional_teams",
		plg_teams_period_end: "professional_teams",
		plg_teams_adds: "gross_adds",
		plg_teams_losses: "gross_losses",
		plg_teams_net: "net_change",
	})) {
		const quarterColumn =
			id === "plg_teams_adds"
				? "gross_adds"
				: id === "plg_teams_losses"
					? "gross_losses"
					: id === "plg_teams_net"
						? "net_change"
						: null;
		queries[id] = {
			databaseExternalId: "166",
			queryText: quarterColumn
				? `with monthly as (${movement}), quarter as (${quarterMovement})
select period_start, ${column} as value,
  if(period_start = toDate('2026-09-01'), quarter.${quarterColumn}, null) as quarter_value
from monthly cross join quarter order by period_start`
				: `select period_start, ${column} as value from (${movement}) order by period_start`,
		};
	}
	for (const [id, [numerator, denominator]] of Object.entries({
		product_m3_requalification: ["requalified_teams", "starting_teams"],
		product_m3_ndr: ["retained_accrued_usd", "starting_accrued_usd"],
		product_reactivation: ["reactivated_m3_teams", "dropped_m2_teams"],
	})) {
		queries[id] = {
			databaseExternalId: "166",
			queryText: `select period_start, cohort_month, ${numerator} as numerator, ${denominator} as denominator,
  round(100.0 * ${numerator} / nullIf(${denominator}, 0), 2) as value
from (${cohorts}) order by period_start`,
		};
	}
	queries.platform_completion = {
		databaseExternalId: "34",
		queryText: `select date_trunc('month', g.created_at at time zone 'UTC') as period_start,
  count(*) filter (where g.status::text = 'COMPLETED')::int as numerator,
  count(*) filter (where g.status::text in ('COMPLETED','FAILED','REJECTED','CANCELED','CANCELLED'))::int as denominator,
  round(100.0 * count(*) filter (where g.status::text = 'COMPLETED') / nullif(count(*) filter (where g.status::text in ('COMPLETED','FAILED','REJECTED','CANCELED','CANCELLED')), 0), 2)::float as value,
  count(*) filter (where g.status::text not in ('COMPLETED','FAILED','REJECTED','CANCELED','CANCELLED','PENDING','PROCESSING'))::int as unknown_status_count
from public.generations g
where g.created_at >= timestamptz '2026-07-01 00:00:00+00'
  and g.created_at < timestamptz '${through} 00:00:00+00'
  and g.deleted_at is null
group by 1 order by 1`,
	};
	return { ...queries, ...productCollectionQueries(through, now) };
}
