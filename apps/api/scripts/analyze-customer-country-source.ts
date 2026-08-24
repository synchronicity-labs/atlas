import { db } from "@crm/db";
import { MarketingClient } from "../src/marketing/marketing.client";
import { marketingConfig } from "../src/marketing/marketing.config";
import { MetabaseClient } from "../src/metabase/metabase.client";
import { metabaseConfig } from "../src/metabase/metabase.config";

const metabase = metabaseConfig();
if (!metabase) throw new Error("Metabase is not configured.");

const metabaseClient = new MetabaseClient(metabase);
const customerRows: unknown[][] = [];
const customerPageSize = 2_000;
for (let offset = 0; ; offset += customerPageSize) {
	const customerResult = await metabaseClient.preview({
		language: "SQL",
		databaseExternalId: "166",
		queryText: `select
  customer_id,
  round(sumIf(revenue_usd, toDate(concat(month, '-01')) >= toStartOfYear(toTimeZone(now(), 'UTC'))), 2) as ytd_revenue_usd,
  round(sum(revenue_usd), 2) as observed_revenue_usd,
  max(toDate(concat(month, '-01')) = addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -1)) as active_latest_complete_month
from sync_prod.paid_customer_monthly_revenue
where lower(plan) in ('hobbyist', 'creator', 'growth', 'scale')
  and toDate(concat(month, '-01')) < toStartOfMonth(toTimeZone(now(), 'UTC'))
group by customer_id
having ytd_revenue_usd > 0
order by customer_id
limit ${customerPageSize} offset ${offset}`,
	});
	customerRows.push(...customerResult.rows);
	if (customerResult.rows.length < customerPageSize) break;
}

const customers = customerRows.map((row) => ({
	id: String(row[0] ?? ""),
	ytdRevenue: Number(row[1] ?? 0),
	observedRevenue: Number(row[2] ?? 0),
	activeLatestCompleteMonth: Boolean(row[3]),
}));
const customerIds = customers.map((customer) => customer.id).filter(Boolean);

const organizations = await db.productOrganization.findMany({
	where: { stripeCustomerId: { in: customerIds } },
	select: {
		stripeCustomerId: true,
		memberships: {
			select: {
				role: true,
				productUser: { select: { externalId: true } },
			},
		},
	},
});

const candidateUsersByCustomer = new Map<
	string,
	Array<{ userId: string; role: string }>
>();
for (const organization of organizations) {
	if (!organization.stripeCustomerId) continue;
	const candidates = candidateUsersByCustomer.get(organization.stripeCustomerId) ?? [];
	for (const membership of organization.memberships) {
		candidates.push({
			userId: membership.productUser.externalId,
			role: membership.role?.toLowerCase() ?? "",
		});
	}
	candidateUsersByCustomer.set(organization.stripeCustomerId, candidates);
}

const userIds = [
	...new Set(
		[...candidateUsersByCustomer.values()]
			.flat()
			.map((candidate) => candidate.userId),
	),
];
const countryByUser = new Map<string, string>();
const marketing = new MarketingClient(marketingConfig(), 30_000);
for (const ids of chunks(userIds, 2_000)) {
	const result = await marketing.execute({
		source: "posthog",
		personPolicy: "all_events",
		query: `select
  distinct_id,
  argMax(person.properties.$geoip_country_code, timestamp) as country_code
from events
where distinct_id in (${ids.map(sqlString).join(", ")})
  and person.properties.$geoip_country_code is not null
  and person.properties.$geoip_country_code != ''
group by distinct_id`,
	});
	for (const row of result.rows) {
		const userId = String(row[0] ?? "");
		const country = String(row[1] ?? "").toUpperCase();
		if (userId && country) countryByUser.set(userId, country);
	}
}

const countryByCustomer = new Map<string, string>();
for (const [customerId, candidates] of candidateUsersByCustomer) {
	const ranked = [...candidates].sort((left, right) => {
		const leftOwner = left.role === "owner" ? 1 : 0;
		const rightOwner = right.role === "owner" ? 1 : 0;
		return rightOwner - leftOwner || left.userId.localeCompare(right.userId);
	});
	const matched = ranked.find((candidate) => countryByUser.has(candidate.userId));
	if (matched) countryByCustomer.set(customerId, countryByUser.get(matched.userId)!);
}

const byCountry = new Map<
	string,
	{
		ytdRevenue: number;
		activeLatestCompleteMonth: number;
		cohortCustomers: number;
		totalRevenue: number;
	}
>();
for (const customer of customers) {
	const country = countryByCustomer.get(customer.id) ?? "UNKNOWN";
	const aggregate = byCountry.get(country) ?? {
		ytdRevenue: 0,
		activeLatestCompleteMonth: 0,
		cohortCustomers: 0,
		totalRevenue: 0,
	};
	aggregate.ytdRevenue += customer.ytdRevenue;
	aggregate.totalRevenue += customer.observedRevenue;
	aggregate.activeLatestCompleteMonth += customer.activeLatestCompleteMonth ? 1 : 0;
	aggregate.cohortCustomers += 1;
	byCountry.set(country, aggregate);
}

const totalYtdRevenue = customers.reduce(
	(total, customer) => total + customer.ytdRevenue,
	0,
);
const rankedCountries = [...byCountry.entries()]
	.map(([country, aggregate]) => ({
		country,
		ytdRevenue: Math.round(aggregate.ytdRevenue),
		sharePct: round(100 * aggregate.ytdRevenue / totalYtdRevenue),
		activeLatestCompleteMonth: aggregate.activeLatestCompleteMonth,
		realizedLtv: Math.round(
			aggregate.totalRevenue / Math.max(aggregate.cohortCustomers, 1),
		),
		cohortCustomers: aggregate.cohortCustomers,
	}))
	.sort((left, right) => right.ytdRevenue - left.ytdRevenue)
	.slice(0, 20);

console.log(
	JSON.stringify(
		{
			paidCustomers: customers.length,
			customersMappedToProduct: [...candidateUsersByCustomer.keys()].length,
			productUsersChecked: userIds.length,
			productUsersWithPosthogCountry: countryByUser.size,
			customersWithPosthogCountry: countryByCustomer.size,
			countryCoveragePct: round(100 * countryByCustomer.size / customers.length),
			rankedCountries,
		},
		null,
		2,
	),
);

await db.$disconnect();

function chunks<T>(values: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size));
	}
	return result;
}

function sqlString(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
