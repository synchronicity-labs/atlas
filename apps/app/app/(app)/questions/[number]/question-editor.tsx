"use client";

import ArrowLeft from "@carbon/icons-react/es/ArrowLeft";
import Launch from "@carbon/icons-react/es/Launch";
import Play from "@carbon/icons-react/es/Play";
import Save from "@carbon/icons-react/es/Save";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Line } from "@crm/ui/components/dither-kit/area";
import { LineChart } from "@crm/ui/components/dither-kit/area-chart";
import { Bar } from "@crm/ui/components/dither-kit/bar";
import { BarChart } from "@crm/ui/components/dither-kit/bar-chart";
import type { ChartConfig } from "@crm/ui/components/dither-kit/chart-context";
import { Grid } from "@crm/ui/components/dither-kit/grid";
import { Legend } from "@crm/ui/components/dither-kit/legend";
import { Tooltip } from "@crm/ui/components/dither-kit/tooltip";
import { XAxis } from "@crm/ui/components/dither-kit/x-axis";
import { YAxis } from "@crm/ui/components/dither-kit/y-axis";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import {
	MetricTrustIndicator,
	type MetricTrustSummary,
} from "@crm/ui/components/metric-trust-indicator";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { Textarea } from "@crm/ui/components/textarea";
import { formatMonthPeriod } from "@crm/ui/lib/format";
import { cn } from "@crm/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { QuestionExplanationPanel } from "@/components/question-explanation";
import {
	filterReportingRows,
	ReportingPeriodControl,
	reportingDateColumnIndex,
	reportingHistoryBounds,
	useReportingPeriod,
} from "@/components/reporting-period";
import { RudyChatTrigger } from "@/components/rudy-chat";
import {
	buildChartData,
	columnVisualization,
	isPercentMetric,
	visualizationRecord,
} from "@/lib/chart-visualization";
import { useTRPC } from "@/lib/trpc/client";

type QueryLanguage = "SQL" | "MBQL" | "API";
type PreviewData = {
	columns: Array<{
		name: string;
		displayName: string | null;
		baseType: string | null;
	}>;
	rows: unknown[][];
	rowCount: number;
	durationMs?: number;
	truncated?: boolean;
};
type SnapshotData = {
	columns: unknown;
	rows: unknown;
	rowCount: number;
} | null;
type QuestionVersion = {
	id: string;
	version: number;
	queryLanguage: QueryLanguage;
	queryText: string;
	display: string;
	visualization: unknown;
	createdAt: string;
};
type QuestionData = {
	id: string;
	number: number;
	name: string;
	description: string | null;
	explanation: string;
	connector: "METABASE" | "STRIPE" | "HUBSPOT" | "POSTHOG" | "ATLAS";
	sourceKey: string | null;
	sourceExternalId: string | null;
	sourceUrl: string | null;
	verification: MetricTrustSummary | null;
	metric: {
		contract: { businessDefinition: unknown };
	} | null;
	versions: QuestionVersion[];
	snapshots: Array<{
		columns: unknown;
		rows: unknown;
		rowCount: number;
	}>;
	dashboardCards: Array<{
		dashboard: { number: number; name: string };
		tab: { number: number; name: string } | null;
	}>;
};
type QuestionProposalData = {
	id: string;
	summary: string;
	name: string;
	description: string | null;
	queryLanguage: QueryLanguage;
	queryText: string;
	display: string;
	status: string;
	questionNumber: number;
};

function cleanColumns(value: unknown): PreviewData["columns"] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((column) => {
		if (!column || typeof column !== "object" || Array.isArray(column))
			return [];
		const name =
			"name" in column && typeof column.name === "string" ? column.name : null;
		if (!name) return [];
		return [
			{
				name,
				displayName:
					"displayName" in column && typeof column.displayName === "string"
						? column.displayName
						: null,
				baseType:
					"baseType" in column && typeof column.baseType === "string"
						? column.baseType
						: null,
			},
		];
	});
}

function cleanRows(value: unknown): unknown[][] {
	return Array.isArray(value)
		? (value.filter(Array.isArray) as unknown[][])
		: [];
}

function snapshotPreview(snapshot: SnapshotData): PreviewData | null {
	if (!snapshot) return null;
	return {
		columns: cleanColumns(snapshot.columns),
		rows: cleanRows(snapshot.rows),
		rowCount: snapshot.rowCount,
	};
}

function humanize(value: string): string {
	return value
		.replaceAll("_", " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const PREVIEW_NUMBER_FORMAT = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 2,
});

function formatPreviewMetric(
	value: number,
	name: string,
	visualization: unknown,
): string {
	const setting = columnVisualization(visualization, name);
	if (setting.numberStyle === "percent") {
		return value.toLocaleString("en-US", {
			style: "percent",
			minimumFractionDigits: setting.decimals ?? 0,
			maximumFractionDigits: setting.decimals ?? 2,
		});
	}
	const formatted =
		setting.decimals === null
			? PREVIEW_NUMBER_FORMAT.format(value)
			: value.toLocaleString("en-US", {
					minimumFractionDigits: setting.decimals,
					maximumFractionDigits: setting.decimals,
				});
	if (setting.suffix !== null) return `${formatted}${setting.suffix}`;
	return isPercentMetric(name) ? `${formatted}%` : formatted;
}

function QuestionPreview({
	data,
	display,
	name,
	visualization,
}: {
	data: PreviewData | null;
	display: string;
	name: string;
	visualization: unknown;
}) {
	if (!data || data.columns.length === 0) {
		return (
			<div className="flex min-h-64 items-center justify-center p-8 text-center text-muted-foreground text-sm">
				Run the query to preview its result.
			</div>
		);
	}
	if (data.rows.length === 0) {
		return (
			<div className="flex min-h-64 items-center justify-center p-8 text-center text-muted-foreground text-sm">
				No rows match the selected reporting period.
			</div>
		);
	}
	const scalar = ["scalar", "smartscalar", "number"].includes(
		display.toLowerCase(),
	);
	const numericIndex = data.columns.findIndex(
		(_, index) =>
			index > 0 && data.rows.some((row) => typeof row[index] === "number"),
	);
	if (scalar && numericIndex >= 0) {
		const value = data.rows.at(-1)?.[numericIndex];
		const metricName = data.columns[numericIndex]?.name ?? name;
		return (
			<div className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
				<p className="font-medium text-5xl tracking-tight tabular-nums">
					{typeof value === "number"
						? formatPreviewMetric(value, metricName, visualization)
						: String(value ?? "—")}
				</p>
				<p className="mt-2 text-muted-foreground text-sm">{name}</p>
			</div>
		);
	}
	const chartDisplay = display.toLowerCase();
	const source = buildChartData(data.columns, data.rows, visualization);
	const chart =
		["line", "area", "bar"].includes(chartDisplay) && source.series.length > 0;
	if (chart) {
		const series = source.series;
		const seriesByKey = new Map(series.map((item) => [item.key, item]));
		const colors = ["green", "blue", "orange", "purple"] as const;
		const config = Object.fromEntries(
			series.map((item, index) => [
				item.key,
				{
					label: item.label,
					color: colors[index % colors.length] ?? "grey",
				},
			]),
		) as ChartConfig;
		const contents = (
			<>
				<Grid strokeDasharray="2 4" />
				<XAxis
					dataKey={source.xKey}
					tickFormatter={(value) =>
						formatMonthPeriod(value, { includeMtd: true, compact: true })
					}
					maxTicks={7}
				/>
				<YAxis
					tickFormatter={(value) =>
						formatPreviewMetric(value, series[0]?.metric ?? "", visualization)
					}
				/>
				<Legend isClickable align="left" />
				<Tooltip
					labelKey={source.xKey}
					valueFormatter={(value, seriesKey) =>
						formatPreviewMetric(
							value,
							seriesByKey.get(seriesKey)?.metric ?? seriesKey,
							visualization,
						)
					}
				/>
				{series.map((item, index) =>
					chartDisplay === "bar" ? (
						<Bar
							key={item.key}
							dataKey={item.key}
							variant={index % 2 === 0 ? "gradient" : "hatched"}
							isClickable
						/>
					) : (
						<Line
							key={item.key}
							dataKey={item.key}
							variant={index % 2 === 0 ? "gradient" : "hatched"}
							isClickable
						/>
					),
				)}
			</>
		);
		return (
			<div className="h-80 p-4">
				{chartDisplay === "bar" ? (
					<BarChart
						data={source.data}
						config={config}
						bloom="low"
						bloomOnHover
						margins={{ left: 50, right: 20, top: 8, bottom: 24 }}
					>
						{contents}
					</BarChart>
				) : (
					<LineChart
						data={source.data}
						config={config}
						bloom="low"
						bloomOnHover
						margins={{ left: 50, right: 20, top: 8, bottom: 24 }}
					>
						{contents}
					</LineChart>
				)}
			</div>
		);
	}

	return (
		<div className="max-h-80 overflow-auto">
			<table className="w-full text-left text-xs">
				<thead className="sticky top-0 bg-muted">
					<tr>
						{data.columns.map((column) => (
							<th
								key={column.name}
								className="border-b px-3 py-2 font-normal text-muted-foreground"
							>
								{columnVisualization(visualization, column.name).title ??
									humanize(column.displayName ?? column.name)}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{data.rows.slice(0, 100).map((row) => (
						<tr key={JSON.stringify(row)} className="border-b last:border-0">
							{data.columns.map((column, columnIndex) => (
								<td key={column.name} className="max-w-72 truncate px-3 py-2">
									{typeof row[columnIndex] === "number"
										? formatPreviewMetric(
												row[columnIndex],
												column.name,
												visualization,
											)
										: String(row[columnIndex] ?? "—")}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function QuestionEditor({ number }: { number: number }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [proposalId, setProposalId] = useQueryState("proposal", parseAsString);
	const question = useQuery(trpc.questions.byNumber.queryOptions({ number }));
	const proposal = useQuery({
		...trpc.questions.proposal.queryOptions({ id: proposalId ?? "" }),
		enabled: Boolean(proposalId),
	});
	const data = question.data as unknown as QuestionData | undefined;
	const proposed = proposal.data as unknown as QuestionProposalData | undefined;
	const latest = data?.versions[0];
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [language, setLanguage] = useState<QueryLanguage>("SQL");
	const [queryText, setQueryText] = useState("");
	const [display, setDisplay] = useState("table");
	const [visualization, setVisualization] = useState<unknown>({});
	const [preview, setPreview] = useState<PreviewData | null>(null);
	const reportingPeriod = useReportingPeriod();
	const [lastPreviewedQuery, setLastPreviewedQuery] = useState<string | null>(
		null,
	);

	useEffect(() => {
		if (!data || !latest) return;
		if (
			proposed &&
			proposed.questionNumber === number &&
			proposed.status === "PENDING"
		) {
			setName(proposed.name);
			setDescription(proposed.description ?? "");
			setLanguage(proposed.queryLanguage);
			setQueryText(proposed.queryText);
			setDisplay(proposed.display);
			setVisualization(latest.visualization);
			setPreview(null);
			setLastPreviewedQuery(null);
			return;
		}
		setName(data.name);
		setDescription(data.description ?? "");
		setLanguage(latest.queryLanguage);
		setQueryText(latest.queryText);
		setDisplay(latest.display);
		setVisualization(latest.visualization);
		setPreview(snapshotPreview(data.snapshots[0] ?? null));
	}, [data, latest, number, proposed]);

	const run = useMutation(
		trpc.questions.preview.mutationOptions({
			onSuccess: (result) => {
				setPreview(result);
				setLastPreviewedQuery(queryText);
				toast.success(`Previewed ${result.rowCount.toLocaleString()} rows`);
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const save = useMutation(
		trpc.questions.saveVersion.mutationOptions({
			onSuccess: async (version) => {
				await queryClient.invalidateQueries(
					trpc.questions.byNumber.queryFilter({ number }),
				);
				await setProposalId(null);
				toast.success(`Saved version ${version.version}`);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const changed = useMemo(
		() =>
			Boolean(
				latest &&
					data &&
					(name !== data.name ||
						description !== (data.description ?? "") ||
						language !== latest.queryLanguage ||
						queryText !== latest.queryText ||
						display !== latest.display),
			),
		[data, description, display, language, latest, name, queryText],
	);
	const periodBounds = useMemo(
		() =>
			reportingHistoryBounds(
				preview ? [{ columns: preview.columns, rows: preview.rows }] : [],
			),
		[preview],
	);
	const supportsPeriod =
		preview == null || reportingDateColumnIndex(preview.columns) != null;
	const visiblePreview = useMemo(() => {
		if (!preview) return null;
		const filtered = filterReportingRows(
			preview.columns,
			preview.rows,
			reportingPeriod.filters,
		);
		return {
			...preview,
			rows: filtered.rows,
			rowCount: filtered.rows.length,
		};
	}, [preview, reportingPeriod.filters]);

	if (!data || !latest)
		return <div className="h-96 animate-pulse rounded-lg bg-muted" />;

	function loadVersion(version: QuestionVersion) {
		setLanguage(version.queryLanguage);
		setQueryText(version.queryText);
		setDisplay(version.display);
		setVisualization(version.visualization);
	}
	const sourceTypeLabel =
		data.connector === "METABASE"
			? "Source question"
			: data.sourceKey === "atlas:billing-experiment"
				? "Experiment assignment"
				: "Source dashboard";
	const sourceLinkLabel =
		data.connector === "METABASE"
			? `Metabase #${data.sourceExternalId}`
			: data.sourceKey === "atlas:billing-experiment"
				? "PostHog billing_v3_experiment"
				: "HubSpot sales dashboard";

	return (
		<div className="flex flex-col gap-5">
			<Button asChild variant="ghost" size="sm" className="w-fit">
				<Link href="/questions">
					<Icon icon={ArrowLeft} />
					Questions
				</Link>
			</Button>
			<header className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
				<div>
					<p className="font-mono text-muted-foreground text-xs">
						Atlas question {data.number}
					</p>
					<h1 className="mt-1 font-medium text-3xl tracking-tight">
						{data.name}
					</h1>
					<div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
						{data.sourceUrl ? (
							<span>
								<span className="text-muted-foreground">{sourceTypeLabel}</span>{" "}
								<Link
									href={data.sourceUrl}
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-1 font-medium hover:underline"
								>
									{sourceLinkLabel}
									<Icon icon={Launch} />
								</Link>
							</span>
						) : (
							<span className="text-muted-foreground">
								Atlas-native question
							</span>
						)}
						<StatusIndicator
							tone="neutral"
							label={`Version ${latest.version}`}
							size="sm"
						/>
						<MetricTrustIndicator summary={data.verification} />
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2 lg:justify-end">
					<ReportingPeriodControl
						filters={reportingPeriod.filters}
						bounds={periodBounds}
						supported={supportsPeriod}
						onPreset={(range) => void reportingPeriod.setPreset(range)}
						onCustom={(from, to) => void reportingPeriod.setCustom(from, to)}
					/>
					<RudyChatTrigger
						record={{ kind: "question", id: String(data.number) }}
					/>
					<Button
						variant="outline"
						size="sm"
						disabled={run.isPending || !queryText.trim()}
						onClick={() =>
							run.mutate({
								number,
								queryLanguage: language,
								queryText,
								reportingPeriod: reportingPeriod.filters,
							})
						}
					>
						<Icon icon={Play} />
						{run.isPending ? "Running" : "Preview"}
					</Button>
					<Button
						size="sm"
						disabled={
							save.isPending ||
							!changed ||
							!name.trim() ||
							!queryText.trim() ||
							(Boolean(proposalId) && lastPreviewedQuery !== queryText)
						}
						onClick={() =>
							save.mutate({
								number,
								name,
								description: description.trim() || null,
								queryLanguage: language,
								queryText,
								display,
								visualization: visualizationRecord(visualization),
								...(proposalId ? { proposalId } : {}),
							})
						}
					>
						<Icon icon={Save} />
						{save.isPending ? "Saving" : "Save new version"}
					</Button>
				</div>
			</header>

			{proposed && proposed.questionNumber === number ? (
				<div className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p className="font-medium text-sm">Rudy proposed this edit</p>
						<p className="mt-0.5 text-muted-foreground text-xs">
							{proposed.summary}
						</p>
					</div>
					<p className="shrink-0 text-muted-foreground text-xs">
						Preview the result, then save a new immutable version.
					</p>
				</div>
			) : null}

			<QuestionExplanationPanel
				questionName={data.name}
				explanation={data.explanation}
				definition={data.metric?.contract.businessDefinition}
			/>

			<div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
				<div className="flex min-w-0 flex-col gap-5">
					<Card>
						<CardHeader>
							<CardTitle>Question definition</CardTitle>
							<CardDescription>
								Name the result people use, then inspect and modify the real
								query behind it.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="grid gap-4">
								<label htmlFor="question-name" className="grid gap-1.5 text-xs">
									<span className="text-muted-foreground">Name</span>
									<Input
										id="question-name"
										value={name}
										onChange={(event) => setName(event.target.value)}
									/>
								</label>
								<label
									htmlFor="question-description"
									className="grid gap-1.5 text-xs"
								>
									<span className="text-muted-foreground">Description</span>
									<Input
										id="question-description"
										value={description}
										onChange={(event) => setDescription(event.target.value)}
										placeholder="What this question determines"
									/>
								</label>
								<div className="flex flex-wrap gap-2">
									<Select
										value={language}
										onValueChange={(value) =>
											setLanguage(value as QueryLanguage)
										}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="SQL">SQL</SelectItem>
											<SelectItem value="MBQL">MBQL</SelectItem>
											<SelectItem value="API">API request</SelectItem>
										</SelectContent>
									</Select>
									<Select value={display} onValueChange={setDisplay}>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="scalar">Number</SelectItem>
											<SelectItem value="line">Line</SelectItem>
											<SelectItem value="area">Area</SelectItem>
											<SelectItem value="bar">Bar</SelectItem>
											<SelectItem value="table">Table</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<Textarea
									value={queryText}
									onChange={(event) => setQueryText(event.target.value)}
									spellCheck={false}
									className="min-h-80 resize-y font-mono text-[12px] leading-5"
								/>
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>Preview</CardTitle>
							<CardDescription>
								{preview && visiblePreview
									? `${preview.rowCount.toLocaleString()} rows in the selected period${preview.truncated ? ` · showing first ${visiblePreview.rowCount.toLocaleString()}` : ""}${preview.durationMs ? ` · ${preview.durationMs} ms` : ""}`
									: "Run the query before saving a new version."}
							</CardDescription>
						</CardHeader>
						<CardContent className="p-0">
							<QuestionPreview
								data={visiblePreview}
								display={display}
								name={name}
								visualization={visualization}
							/>
						</CardContent>
					</Card>
				</div>

				<aside className="flex flex-col gap-5">
					<Card>
						<CardHeader>
							<CardTitle>Version history</CardTitle>
							<CardDescription>Each save is immutable.</CardDescription>
						</CardHeader>
						<CardContent className="p-0">
							<div className="divide-y">
								{data.versions.map((version) => (
									<button
										key={version.id}
										type="button"
										onClick={() => loadVersion(version)}
										className={cn(
											"flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-muted/60",
											version.id === latest.id && "bg-muted/40",
										)}
									>
										<span>
											<span className="font-medium">
												Version {version.version}
											</span>
											<span className="mt-0.5 block text-muted-foreground text-xs">
												{version.queryLanguage} · {version.display}
											</span>
										</span>
										<span className="text-muted-foreground text-xs">
											{new Date(version.createdAt).toLocaleDateString()}
										</span>
									</button>
								))}
							</div>
						</CardContent>
					</Card>
					{data.dashboardCards.length > 0 ? (
						<Card>
							<CardHeader>
								<CardTitle>Used on</CardTitle>
							</CardHeader>
							<CardContent className="gap-2">
								{data.dashboardCards.map((placement) => (
									<Button
										key={`${placement.dashboard.number}:${placement.tab?.number ?? 1}`}
										asChild
										variant="outline"
										size="sm"
										className="justify-start"
									>
										<Link
											href={`/dashboards/${placement.dashboard.number}?tab=${placement.tab?.number ?? 1}`}
										>
											{placement.dashboard.name}
											{placement.tab ? ` · ${placement.tab.name}` : ""}
										</Link>
									</Button>
								))}
							</CardContent>
						</Card>
					) : null}
				</aside>
			</div>
		</div>
	);
}
