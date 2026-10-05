"use client";

import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@crm/ui/components/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTRPC } from "@/lib/trpc/client";
import type { QbrMetric } from "../qbr-review-logic";
import { NorthStarAgentAccess } from "./north-star-agent-access";
import {
	AVERAGE_TEAM_METRIC_IDS,
	formatNorthStarValue,
	groupMissingNorthStarMetrics,
	metricRowLabel,
} from "./north-star-display";

type Metric = QbrMetric;

const MONTHS = [
	{ period: "2026-07", label: "July" },
	{ period: "2026-08", label: "August" },
	{ period: "2026-09", label: "September" },
] as const;
const PERIODS = [...MONTHS, { period: "2026-Q3", label: "Q3" }] as const;
const PLANNING_SHEET =
	"https://docs.google.com/spreadsheets/d/17oWmJqYGxWwHEbdVhvo1OCHLAUEv03bljDuPHaqGHwU/edit";
const DOORS = [
	{ id: "plg_teams", label: "PLG" },
	{ id: "enterprise_teams", label: "Enterprise" },
	{ id: "channel_teams", label: "Channel" },
	{ id: "productions_teams", label: "Productions" },
] as const;

const SECTIONS = [
	{
		title: "Professional teams",
		rows: [
			...AVERAGE_TEAM_METRIC_IDS,
			"company_teams_period_end",
			"company_teams_adds",
			"company_teams_losses",
			"company_teams_net",
			"plg_teams_period_end",
			"plg_teams_adds",
			"plg_teams_losses",
			"plg_teams_net",
			"enterprise_teams_period_end",
			"enterprise_teams_adds",
			"enterprise_teams_losses",
			"enterprise_teams_net",
			"channel_teams_period_end",
			"channel_teams_adds",
			"channel_teams_losses",
			"channel_teams_net",
			"productions_teams_period_end",
			"productions_teams_adds",
			"productions_teams_losses",
			"productions_teams_net",
		],
	},
	{
		title: "Revenue",
		rows: [
			"company_revenue",
			"plg_revenue",
			"enterprise_revenue",
			"channel_revenue",
			"productions_revenue",
			"company_revenue_subscriptions",
			"company_revenue_usage",
			"company_revenue_services",
		],
	},
	{
		title: "Booked revenue",
		rows: [
			"company_booked_revenue",
			"plg_booked_revenue",
			"enterprise_booked_revenue",
			"channel_booked_revenue",
			"productions_booked_revenue",
		],
	},
	{
		title: "Estimated annual revenue",
		rows: [
			"company_annual_revenue_estimate",
			"plg_annual_revenue_estimate",
			"enterprise_annual_revenue_estimate",
			"channel_annual_revenue_estimate",
			"productions_annual_revenue_estimate",
		],
	},
	{
		title: "Gross margin",
		rows: [
			"finance_gross_margin",
			"finance_product_margin",
			"finance_services_margin",
		],
	},
	{
		title: "Cash",
		rows: ["finance_net_burn", "finance_runway"],
	},
	{
		title: "Retention measures",
		rows: [
			"plg_usage_retention",
			"plg_contract_retention",
			"enterprise_usage_retention",
			"enterprise_contract_retention",
			"channel_usage_retention",
			"channel_contract_retention",
			"productions_repeat_revenue_share",
			"productions_contract_retention",
		],
	},
	{
		title: "Customer concentration",
		rows: [
			"company_top1",
			"company_top3",
			"company_top10",
			"plg_top1",
			"plg_top3",
			"plg_top10",
			"enterprise_top1",
			"enterprise_top3",
			"enterprise_top10",
			"channel_top1",
			"channel_top3",
			"channel_top10",
			"productions_top1",
			"productions_top3",
			"productions_top10",
		],
	},
	{
		title: "Professional customer active rate",
		rows: ["plg_active_rate", "enterprise_active_rate", "channel_active_rate"],
	},
] as const satisfies { title: string; rows: string[] }[];

function MetricQuestion({ metric }: { metric: Metric }) {
	if (!metric.question)
		return (
			<span className="text-xs text-muted-foreground">
				Question not registered
			</span>
		);
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Link
					href={metric.question.url}
					target="_blank"
					rel="noreferrer"
					className="text-xs text-muted-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
				>
					Q{metric.question.number} ↗
				</Link>
			</TooltipTrigger>
			<TooltipContent variant="surface" className="grid gap-1">
				<strong>{metric.label}</strong>
				<span>{metric.definition}</span>
				<span>
					Unit: {metric.unit}. Open Atlas question {metric.question.number}.
				</span>
			</TooltipContent>
		</Tooltip>
	);
}

function PlanningScope({ metrics }: { metrics: Record<string, Metric> }) {
	return (
		<details className="rounded-lg border p-4">
			<summary className="cursor-pointer font-medium">
				North Star definition and planning references
			</summary>
			<section className="mt-4 grid gap-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h2 className="font-medium">North Star definition</h2>
					<a
						className="text-sm underline underline-offset-4"
						href={`${PLANNING_SHEET}#gid=295651257&range=A1:C17`}
						target="_blank"
						rel="noreferrer"
					>
						Planning overview A1:C17 ↗
					</a>
				</div>
				<p className="text-sm text-muted-foreground">
					Monthly active professional teams. The unit is a team, not a title or
					studio logo. A team that appears through two doors counts once in the
					company total.
				</p>
				<p className="text-sm text-muted-foreground">
					Quarter movement counts each team once across the quarter. Gross adds
					are new plus reactivated teams; gross losses include teams that
					qualified during the quarter but fell below the activity criteria by
					quarter-end. A team can appear in both categories. First observed is
					labelled new until complete history is verified.
				</p>
				<p className="text-sm text-muted-foreground">
					Monthly values retain their authored definitions. Booked revenue
					follows each door’s authored basis. Actualized revenue, booked
					revenue, and estimated annual revenue remain separate; no YTD totals
					are derived here.
				</p>
				<p className="text-sm text-muted-foreground">
					YTD revenue by subscription, usage, and services is not available in
					the saved Q3 report and is not estimated from monthly values or the
					separate authored annual estimate. Productions usage NDR is not
					defined; repeat-revenue share and signed-value retention remain
					separate measures.
				</p>
				<dl className="grid gap-3 md:grid-cols-2">
					{DOORS.map((door) => {
						const metric = metrics[door.id];
						if (!metric) return null;
						return (
							<div key={door.id} className="grid content-start gap-1">
								<dt className="flex items-center justify-between gap-2 text-sm font-medium">
									{door.label}
									<MetricQuestion metric={metric} />
								</dt>
								<dd className="text-sm text-muted-foreground">
									{metric.definition}
								</dd>
							</div>
						);
					})}
				</dl>
				<p className="text-xs text-muted-foreground">
					Definition gap pending review: Atlas currently requires at least 3 PLG
					billable generations; the planning overview says more than 3. The
					Atlas PLG count is not marked as sheet-conformant.
				</p>
				<p className="text-xs text-muted-foreground">
					Atlas Channel qualification uses the approved $1,000 monthly
					threshold. The planning overview still shows its older TBD threshold.
				</p>
				<a
					className="text-sm underline underline-offset-4"
					href={`${PLANNING_SHEET}#gid=1969699588&range=A3:K15`}
					target="_blank"
					rel="noreferrer"
				>
					KPI definitions A3:K15 ↗
				</a>
			</section>
		</details>
	);
}

function EvidenceCell({ metric, period }: { metric: Metric; period: string }) {
	const observation = metric.observations[period];
	const value = observation
		? formatNorthStarValue(observation.value, metric.unit, true)
		: "Not reported";
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					className="w-full text-left tabular-nums focus-visible:outline-2 focus-visible:outline-ring"
					aria-label={`${metric.label}, ${period}: ${observation ? formatNorthStarValue(observation.value, metric.unit, false, true) : "not reported"}`}
				>
					{value}
				</button>
			</TooltipTrigger>
			<TooltipContent
				variant="surface"
				className="grid max-w-sm gap-1 whitespace-normal"
			>
				<strong>
					{metric.label} · {period}
				</strong>
				{observation ? (
					<>
						<span>
							Exact value:{" "}
							{formatNorthStarValue(
								observation.value,
								metric.unit,
								false,
								true,
							)}
						</span>
						<span>
							Status: {observation.status} · as of {observation.asOf}
						</span>
						<span>
							Data through: {observation.dataThrough ?? "not supplied"}
						</span>
						{observation.numerator !== null &&
						observation.denominator !== null ? (
							<span>
								Coverage: {observation.numerator} / {observation.denominator}
							</span>
						) : null}
						<span>Source: {observation.source.label}</span>
						<span>Evidence: {observation.evidenceSource.label}</span>
						{observation.verification?.coverage ? (
							<span>
								Coverage evidence: {observation.verification.coverage.label}
							</span>
						) : null}
					</>
				) : (
					<>
						<span>
							No saved observation exists for this month. This is distinct from
							zero.
						</span>
						<span>Collection location: {metric.preparation.dataLocation}</span>
						<span>{metric.preparation.gap}</span>
					</>
				)}
			</TooltipContent>
		</Tooltip>
	);
}

function SupportingResults({ metrics }: { metrics: [string, Metric][] }) {
	const results = metrics
		.filter(
			([id]) =>
				id === "plg_teams" ||
				/(^|_)(usage|top1|top3|top10|active_rate|annual_revenue_estimate)(_|$)/.test(
					id,
				),
		)
		.filter(([id]) => !id.startsWith("productions_"))
		.flatMap(([id, metric]) =>
			(metric.preparation.supportingResults ?? []).map((result) => ({
				id,
				result,
			})),
		)
		.filter(({ result }) => {
			try {
				const source = new URL(result.source.url);
				return (
					source.protocol === "https:" &&
					!source.hostname.endsWith(".local") &&
					!result.source.label.toLowerCase().includes("private") &&
					!result.source.url.startsWith("file:")
				);
			} catch {
				return false;
			}
		});
	if (!results.length) return null;
	return (
		<details className="grid gap-3">
			<summary
				id="north-star-supporting-data"
				className="cursor-pointer font-semibold"
			>
				Supporting measured data · {results.length} tables
			</summary>
			<div className="mt-3 grid gap-3">
				{results.map(({ id, result }) => (
					<article key={`${id}-${result.label}`} className="min-w-0 text-sm">
						<details className="rounded-lg border px-3 py-2">
							<summary className="cursor-pointer font-medium">
								{result.label} · {id.replaceAll("_", " ")}
							</summary>
							<div className="mt-3 grid gap-3">
								<p>
									As of {result.asOf} ·{" "}
									<a
										className="underline underline-offset-4"
										href={result.source.url}
										target="_blank"
										rel="noreferrer"
									>
										{result.source.label}
									</a>
								</p>
								<div className="max-w-full overflow-x-auto">
									<Table className="w-max min-w-full text-left">
										<TableHeader>
											<TableRow>
												{result.columns.map((column) => (
													<TableHead key={column} scope="col">
														{column}
													</TableHead>
												))}
											</TableRow>
										</TableHeader>
										<TableBody>
											{result.rows.map((row) => (
												<TableRow key={JSON.stringify(row)}>
													{result.columns.map((column, cellIndex) => (
														<TableCell key={column}>
															{row[cellIndex] === null ||
															row[cellIndex] === undefined
																? "Not reported"
																: String(row[cellIndex])}
														</TableCell>
													))}
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
								<details>
									<summary className="cursor-pointer font-medium">
										Coverage and limitations
									</summary>
									<p className="mt-2">{result.limitations}</p>
								</details>
								<details>
									<summary className="cursor-pointer font-medium">
										Source query
									</summary>
									<pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words">
										{result.queryText}
									</pre>
								</details>
							</div>
						</details>
					</article>
				))}
			</div>
		</details>
	);
}

export function NorthStarDashboard() {
	const trpc = useTRPC();
	const { data, isPending, error } = useQuery(trpc.qbr.report.queryOptions());
	if (isPending) return <p role="status">Loading Q3 North Star…</p>;
	if (error)
		return (
			<p role="alert">North Star data could not be loaded: {error.message}</p>
		);
	if (!data) return <p role="alert">The Q3 report is unavailable.</p>;

	const rowIds = [...new Set(SECTIONS.flatMap((section) => section.rows))];
	const tracked = rowIds
		.map((id) => data.metrics[id])
		.filter(
			(metric): metric is Metric =>
				metric !== undefined && !metric.notApplicable,
		);
	const observations = tracked.flatMap((metric) =>
		PERIODS.map(({ period }) => metric.observations[period]).filter(
			(observation): observation is NonNullable<typeof observation> =>
				observation !== undefined,
		),
	);
	const verified = observations.filter(
		(observation) => observation.status === "verified",
	).length;
	const reported = observations.filter(
		(observation) => observation.status === "reported",
	).length;
	const provisional = observations.filter(
		(observation) => observation.status === "provisional",
	).length;
	const missingBySection = SECTIONS.map((section) => ({
		...section,
		metrics: section.rows.flatMap((id) => {
			const metric = data.metrics[id];
			return metric &&
				!metric.notApplicable &&
				!PERIODS.some(({ period }) => metric.observations[period])
				? [{ ...metric, id }]
				: [];
		}),
	})).filter((section) => section.metrics.length);
	const observedMetrics = SECTIONS.flatMap((section) =>
		section.rows.flatMap((id) => {
			const metric = data.metrics[id];
			return metric &&
				!metric.notApplicable &&
				PERIODS.some(({ period }) => metric.observations[period])
				? [{ id, section: section.title, metric }]
				: [];
		}),
	);
	const missing = missingBySection.flatMap((section) => section.metrics);
	const missingByDependency = groupMissingNorthStarMetrics(missing);

	return (
		<TooltipProvider>
			<div className="grid grid-cols-1 gap-6">
				<NorthStarAgentAccess />
				<section className="grid gap-1" aria-labelledby="q3-summary">
					<h2 id="q3-summary" className="font-medium">
						July–September 2026 · Q3
					</h2>
					<p className="text-sm text-muted-foreground">
						{observations.length} saved period values · {verified} verified ·{" "}
						{reported} reported · {provisional} provisional. Missing values are
						not zero.
					</p>
				</section>
				<details open className="rounded-lg border p-4">
					<summary className="cursor-pointer font-semibold">
						Available results · {observedMetrics.length} measures
					</summary>
					<p className="mt-2 text-sm text-muted-foreground">
						PLG counts use 3+ billable generations; the sheet says 4+ and that
						definition is awaiting confirmation. Channel uses Prady’s approved
						$1,000 net-revenue threshold rather than the sheet’s older
						threshold.
					</p>
					<div className="mt-4 max-w-full overflow-x-auto">
						<Table className="w-full min-w-[48rem]">
							<TableHeader>
								<TableRow>
									<TableHead scope="col" className="min-w-64">
										Measure
									</TableHead>
									{PERIODS.map((period) => (
										<TableHead
											scope="col"
											key={period.period}
											className="min-w-24"
										>
											{period.label}
										</TableHead>
									))}
								</TableRow>
							</TableHeader>
							<TableBody>
								{observedMetrics.map(({ id, section, metric }) => (
									<TableRow key={id}>
										<TableHead
											scope="row"
											className="whitespace-normal text-foreground"
										>
											<span className="block text-xs font-normal text-muted-foreground">
												{section}
											</span>
											<span>
												{metricRowLabel(id, metric.label)}
												{id === "plg_booked_revenue"
													? " (invoice revenue; includes unclassified)"
													: ""}
											</span>
											<MetricQuestion metric={metric} />
										</TableHead>
										{PERIODS.map((period) => (
											<TableCell key={period.period}>
												<EvidenceCell metric={metric} period={period.period} />
											</TableCell>
										))}
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</details>
				{missingByDependency.length ? (
					<details className="rounded-lg border p-4">
						<summary className="cursor-pointer font-medium">
							What we still need · {missingByDependency.length} shared inputs
						</summary>
						<p className="mt-2 text-sm text-muted-foreground">
							Affects {missing.length} measures with no saved values in the
							displayed periods.
						</p>
						<div className="mt-4 grid gap-3">
							{missingByDependency.map((group) => (
								<details
									key={group.title}
									className="rounded-lg border px-3 py-2"
								>
									<summary className="cursor-pointer font-medium">
										<span>
											{group.title} · {group.metrics.length}
										</span>
										<span className="mt-1 block text-sm font-normal text-muted-foreground">
											{group.description} Owners:{" "}
											{[
												...new Set(
													group.metrics
														.map((metric) => metric.preparation.owner)
														.filter(Boolean),
												),
											].join(", ") || "Not identified"}
											.
										</span>
									</summary>
									<ul className="mt-3 grid gap-3 text-sm">
										{group.metrics.map((metric) => (
											<li key={metric.id} className="grid gap-1">
												<div className="flex items-center justify-between gap-2">
													<span>{metric.label}</span>
													<MetricQuestion metric={metric} />
												</div>
												<span className="text-muted-foreground">
													Owner: {metric.preparation.owner}.{" "}
													{metric.preparation.manualAsk}
												</span>
												<span className="text-muted-foreground">
													Source: {metric.preparation.dataLocation}
												</span>
											</li>
										))}
									</ul>
								</details>
							))}
						</div>
					</details>
				) : null}
				<PlanningScope metrics={data.metrics} />
				<SupportingResults metrics={Object.entries(data.metrics)} />
				<details className="text-xs text-muted-foreground">
					<summary className="cursor-pointer">
						YTD revenue collection owners and source requests
					</summary>
					<ul className="mt-2 grid gap-2">
						{[
							"company_revenue_subscriptions",
							"company_revenue_usage",
							"company_revenue_services",
						].map((id) => {
							const metric = data.metrics[id];
							if (!metric) return null;
							return (
								<li key={id}>
									{metric.label} · Owner: {metric.preparation.owner} ·{" "}
									{metric.preparation.dataLocation} ·{" "}
									{metric.preparation.manualAsk}{" "}
									<MetricQuestion metric={metric} />
								</li>
							);
						})}
					</ul>
				</details>
			</div>
		</TooltipProvider>
	);
}
