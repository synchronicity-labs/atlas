"use client";

import Renew from "@carbon/icons-react/es/Renew";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type Entry = RouterOutputs["metricCatalog"]["list"][number];
type Summary = RouterOutputs["metricCatalog"]["summary"];
type SourceCandidate = Entry["sourceCandidates"][number];

const READINESS_LABELS: Record<Entry["readiness"], string> = {
	CATALOGED: "Cataloged",
	NEEDS_DEFINITION: "Needs definition",
	NEEDS_SOURCE: "Needs source",
	NEEDS_EVIDENCE: "Needs evidence",
	READY_TO_IMPLEMENT: "Ready to build",
	IMPLEMENTING: "Implementing",
	RECONCILING: "Reconciling",
	VERIFIED: "Verified",
	BLOCKED: "Blocked",
};

const READINESS_DESCRIPTIONS: Record<Entry["readiness"], string> = {
	CATALOGED:
		"The workbook row is saved in Atlas. Its definition and source have not been checked yet.",
	NEEDS_DEFINITION:
		"The business owner still needs to confirm exactly what this measure means.",
	NEEDS_SOURCE:
		"The intended measure is known, but Atlas does not yet have a usable source or access path.",
	NEEDS_EVIDENCE:
		"This is a roadmap outcome. Atlas needs proof that the milestone happened, rather than a new KPI data connector.",
	READY_TO_IMPLEMENT:
		"The definition and source are clear enough to build a deterministic Atlas metric.",
	IMPLEMENTING:
		"The Atlas question and metric contract are being wired into the governed data layer.",
	RECONCILING:
		"Atlas returns data, but it is still being compared with an approved source or report.",
	VERIFIED: "The definition, source, query, and required checks have passed.",
	BLOCKED:
		"A specific external decision or dependency currently prevents progress.",
};

const KIND_LABELS: Record<Entry["kind"], string> = {
	KPI: "KPI",
	VIEW: "View",
	DIAGNOSTIC: "Diagnostic",
	ROADMAP_MEASURE: "Roadmap",
	UNCLASSIFIED: "Review",
};

function count(summary: Summary, readiness: Entry["readiness"]): number {
	return summary.byReadiness[readiness] ?? 0;
}

function percent(value: number, total: number): number {
	return total > 0 ? Math.round((value / total) * 100) : 0;
}

function ambiguityCount(entry: { ambiguities: unknown }): number {
	return Array.isArray(entry.ambiguities) ? entry.ambiguities.length : 0;
}

function readinessTone(readiness: Entry["readiness"]): string {
	if (readiness === "VERIFIED") return "text-success";
	if (readiness === "BLOCKED") return "text-destructive";
	if (readiness === "RECONCILING" || readiness === "IMPLEMENTING") {
		return "text-info";
	}
	return "text-warning";
}

function displayTeam(value: string | null): string {
	if (!value) return "—";
	const normalized = value.trim().toLowerCase();
	const labels: Record<string, string> = {
		cs: "Customer Success",
		css: "Customer Success",
		gtm: "GTM",
		gtme: "GTM",
		marketing: "Marketing",
		"marketing new": "Marketing",
		ops: "Operations",
		product: "Product",
		productions: "Productions",
		research: "Research",
		sales: "Sales",
		engineering: "Engineering",
		"sync.": "Sync",
	};
	return (
		labels[normalized] ??
		normalized.replace(/\b\w/g, (letter) => letter.toUpperCase())
	);
}
function ReadinessTooltip({
	readiness,
	candidates = [],
	children,
}: {
	readiness: Entry["readiness"];
	candidates?: SourceCandidate[];
	children: ReactNode;
}) {
	const next = nextSourceCandidate(readiness, candidates);
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent
				variant="surface"
				className="max-w-80 space-y-2 text-pretty"
			>
				<p>{READINESS_DESCRIPTIONS[readiness]}</p>
				{next ? (
					<div>
						<p className="font-medium">Next: {sourceAction(next)}</p>
						<p className="mt-0.5 text-muted-foreground text-xs">
							{next.reason}
						</p>
					</div>
				) : null}
			</TooltipContent>
		</Tooltip>
	);
}

function HeaderTooltip({
	label,
	description,
}: {
	label: string;
	description: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					className="cursor-help border-b border-dotted border-current"
				>
					{label}
				</button>
			</TooltipTrigger>
			<TooltipContent variant="surface" className="max-w-72 text-pretty">
				{description}
			</TooltipContent>
		</Tooltip>
	);
}

function sourceTone(state: SourceCandidate["state"]): string {
	if (state === "CONNECTED") return "text-success";
	if (state === "ATTENTION") return "text-warning";
	return "text-muted-foreground";
}

function sourceStateLabel(state: SourceCandidate["state"]): string {
	if (state === "CONNECTED") return "Connected";
	if (state === "ATTENTION") return "Needs attention";
	return "Not connected";
}

function nextSourceCandidate(
	readiness: Entry["readiness"],
	candidates: SourceCandidate[],
): SourceCandidate | null {
	if (readiness === "NEEDS_EVIDENCE") {
		return (
			candidates.find((candidate) => candidate.key === "linear:projects") ??
			candidates.find((candidate) => candidate.state !== "CONNECTED") ??
			null
		);
	}

	const unresolved = candidates.filter(
		(candidate) => candidate.state !== "CONNECTED",
	);
	return (
		unresolved.find((candidate) => candidate.confidence === "EXPLICIT") ??
		unresolved[0] ??
		null
	);
}

function sourceAction(candidate: SourceCandidate): string {
	if (candidate.state === "ATTENTION") {
		return `Fix access to ${candidate.label}`;
	}
	if (candidate.state === "MISSING") return `Connect ${candidate.label}`;
	return `Use ${candidate.label}`;
}

function SourcePath({ candidates }: { candidates: SourceCandidate[] }) {
	const primary = candidates[0];
	if (!primary) return <span className="text-muted-foreground">—</span>;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					className="flex max-w-52 cursor-help items-start gap-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
				>
					<span className={`${sourceTone(primary.state)} mt-0.5`}>●</span>
					<span>
						<span className="line-clamp-2 text-foreground text-xs">
							{primary.label}
						</span>
						{candidates.length > 1 ? (
							<span className="text-muted-foreground text-xs">
								+{candidates.length - 1} candidate
								{candidates.length === 2 ? "" : "s"}
							</span>
						) : null}
					</span>
				</button>
			</TooltipTrigger>
			<TooltipContent
				variant="surface"
				className="max-w-80 space-y-3 text-pretty"
			>
				{candidates.slice(0, 4).map((candidate) => (
					<div key={candidate.key}>
						<p className="font-medium">
							<span className={sourceTone(candidate.state)}>●</span>{" "}
							{candidate.label} · {sourceStateLabel(candidate.state)}
						</p>
						<p className="mt-0.5 text-muted-foreground text-xs">
							{candidate.reason}
						</p>
					</div>
				))}
			</TooltipContent>
		</Tooltip>
	);
}

function Stat({
	label,
	value,
	detail,
}: {
	label: string;
	value: number;
	detail: string;
}) {
	return (
		<div className="rounded-lg border bg-card p-4">
			<p className="text-muted-foreground text-xs uppercase tracking-[0.12em]">
				{label}
			</p>
			<p className="mt-2 font-medium text-3xl tabular-nums">{value}</p>
			<p className="mt-1 text-muted-foreground text-xs">{detail}</p>
		</div>
	);
}

export function MetricCatalog() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const summary = useQuery(trpc.metricCatalog.summary.queryOptions());
	const entries = useQuery(trpc.metricCatalog.list.queryOptions());
	const [query, setQuery] = useState("");
	const sync = useMutation(
		trpc.metricCatalog.sync.mutationOptions({
			onSuccess: async (result) => {
				await Promise.all([
					queryClient.invalidateQueries(
						trpc.metricCatalog.summary.queryFilter(),
					),
					queryClient.invalidateQueries(trpc.metricCatalog.list.queryFilter()),
				]);
				toast.success(
					`Cataloged ${result.entries} measurements from ${result.tabs} tabs.`,
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return entries.data ?? [];
		return (entries.data ?? []).filter((entry) =>
			[
				entry.title,
				entry.description,
				entry.ownerTeam,
				entry.sourceTabName,
				entry.metric?.name,
				...entry.sourceCandidates.map((candidate) => candidate.label),
			]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(needle)),
		);
	}, [entries.data, query]);
	const accessNeeded = useMemo(
		() =>
			(entries.data ?? []).flatMap((entry) => {
				if (entry.readiness !== "NEEDS_SOURCE") return [];
				const candidate = nextSourceCandidate(
					entry.readiness,
					entry.sourceCandidates,
				);
				return candidate ? [{ entry, candidate }] : [];
			}),
		[entries.data],
	);

	if (!summary.data || !entries.data) {
		return <div className="h-72 animate-pulse rounded-lg bg-muted" />;
	}

	return (
		<div className="space-y-5">
			<div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p className="font-medium">Q3 metrics and planning</p>
					<p className="mt-1 text-muted-foreground text-sm">
						{summary.data.source?.lastSyncAt ? (
							<>
								Read-only workbook import updated{" "}
								<span suppressHydrationWarning>
									{relativeTimeFromIso(summary.data.source.lastSyncAt)}
								</span>
							</>
						) : (
							"The workbook has not been imported yet."
						)}
					</p>
				</div>
				<Button
					variant="outline"
					disabled={sync.isPending}
					onClick={() => sync.mutate()}
				>
					<Icon icon={Renew} />
					{sync.isPending ? "Importing" : "Refresh catalog"}
				</Button>
			</div>

			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
				<Stat
					label="Cataloged"
					value={summary.data.total}
					detail={`${summary.data.tabs} workbook tabs represented`}
				/>
				<Stat
					label="KPIs mapped"
					value={summary.data.kpiMapped}
					detail={`${percent(summary.data.kpiMapped, summary.data.kpiTotal)}% of ${summary.data.kpiTotal} KPI definitions`}
				/>
				<Stat
					label="KPIs verified"
					value={summary.data.kpiVerified}
					detail={`${percent(summary.data.kpiVerified, summary.data.kpiTotal)}% fully trusted`}
				/>
				<Stat
					label="Open decisions"
					value={summary.data.ambiguous}
					detail="Potential ambiguity needs owner review"
				/>
				<Stat
					label="KPI source gaps"
					value={summary.data.kpiNeedsSource}
					detail={`${summary.data.roadmapNeedsEvidence} roadmap evidence gaps tracked separately`}
				/>
			</div>

			<p className="text-muted-foreground text-xs">
				Source map: {summary.data.sourceConnected} connected ·{" "}
				{summary.data.sourceAttention} need connector attention ·{" "}
				{summary.data.sourceMissing} need a new connection ·{" "}
				{summary.data.sourceUnclassified} still unclassified
			</p>

			{accessNeeded.length > 0 ? (
				<div className="rounded-lg border bg-card p-4">
					<p className="font-medium">Data access needed</p>
					<p className="mt-1 text-muted-foreground text-sm">
						These are the permissions or connections you can provide to unblock
						KPI work.
					</p>
					<div className="mt-3 divide-y">
						{accessNeeded.map(({ entry, candidate }) => (
							<div
								key={entry.id}
								className="grid gap-1 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-4"
							>
								<p className="font-medium text-sm">{entry.title}</p>
								<div>
									<p className="text-sm">{sourceAction(candidate)}</p>
									<p className="mt-0.5 text-muted-foreground text-xs">
										{candidate.reason}
									</p>
								</div>
							</div>
						))}
					</div>
				</div>
			) : null}

			<div className="flex flex-wrap gap-2">
				{Object.entries(READINESS_LABELS).map(([key, label]) => {
					const readiness = key as Entry["readiness"];
					return (
						<ReadinessTooltip key={key} readiness={readiness}>
							<button
								type="button"
								className="inline-flex cursor-help items-center gap-1.5 rounded-full border bg-muted/25 px-2.5 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
							>
								<span className={readinessTone(readiness)}>●</span>
								{label}
								<span className="text-muted-foreground tabular-nums">
									{count(summary.data, readiness)}
								</span>
							</button>
						</ReadinessTooltip>
					);
				})}
			</div>

			<Input
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="Search measures, teams, tabs, or canonical metrics"
				aria-label="Search metric catalog"
			/>

			<div className="overflow-hidden rounded-lg border bg-card">
				<div className="overflow-x-auto">
					<table className="w-full min-w-[1160px] text-sm">
						<thead className="border-b bg-muted/30 text-left text-muted-foreground text-xs">
							<tr>
								<th className="px-4 py-3 font-medium">Planning row</th>
								<th className="px-4 py-3 font-medium">Measure</th>
								<th className="px-4 py-3 font-medium">Kind</th>
								<th className="px-4 py-3 font-medium">Team</th>
								<th className="px-4 py-3 font-medium">
									<HeaderTooltip
										label="Likely data source"
										description="The strongest source Atlas can identify from the metric text and existing connectors. Hover a row to see alternatives and connection status."
									/>
								</th>
								<th className="px-4 py-3 font-medium">
									<HeaderTooltip
										label="Readiness"
										description="How far this workbook measure has moved from an idea to a trusted, repeatable Atlas metric."
									/>
								</th>
								<th className="px-4 py-3 font-medium">
									<HeaderTooltip
										label="Atlas metric"
										description="The canonical Atlas metric mapped to this workbook row. Select its name to open the live question."
									/>
								</th>
							</tr>
						</thead>
						<tbody>
							{filtered.map((entry) => {
								const decisions = ambiguityCount(entry);
								return (
									<tr key={entry.id} className="border-b last:border-0">
										<td className="whitespace-nowrap px-4 py-3 align-top font-mono text-muted-foreground text-xs">
											<Link
												href={`https://docs.google.com/spreadsheets/d/17oWmJqYGxWwHEbdVhvo1OCHLAUEv03bljDuPHaqGHwU/edit#gid=${entry.sourceTabId}&range=${entry.sourceRange}`}
												target="_blank"
												rel="noreferrer"
												className="underline decoration-border underline-offset-4 hover:text-foreground"
											>
												{entry.sourceTabName} · {entry.sourceRow}
											</Link>
											{entry.sourceHint ? (
												<p className="mt-1 max-w-40 whitespace-normal text-foreground/75">
													{entry.sourceHint}
												</p>
											) : null}
										</td>
										<td className="max-w-xl px-4 py-3 align-top">
											<p className="font-medium">{entry.title}</p>
											{entry.description ? (
												<p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
													{entry.description}
												</p>
											) : null}
											{decisions > 0 ? (
												<p className="mt-1 text-warning text-xs">
													{decisions} potential{" "}
													{decisions === 1 ? "decision" : "decisions"}
												</p>
											) : null}
										</td>
										<td className="px-4 py-3 align-top">
											<span className="inline-flex rounded-md border px-2 py-0.5 text-xs">
												{KIND_LABELS[entry.kind]}
											</span>
										</td>
										<td className="px-4 py-3 align-top text-muted-foreground">
											{displayTeam(entry.ownerTeam)}
										</td>
										<td className="px-4 py-3 align-top">
											<SourcePath candidates={entry.sourceCandidates} />
										</td>
										<td className="px-4 py-3 align-top">
											<ReadinessTooltip
												readiness={entry.readiness}
												candidates={entry.sourceCandidates}
											>
												<button
													type="button"
													className={`${readinessTone(entry.readiness)} cursor-help border-b border-dotted border-current`}
												>
													{READINESS_LABELS[entry.readiness]}
												</button>
											</ReadinessTooltip>
										</td>
										<td className="px-4 py-3 align-top text-muted-foreground">
											{entry.metric?.questionNumber ? (
												<Link
													href={`/questions/${entry.metric.questionNumber}`}
													className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
												>
													{entry.metric.name}
												</Link>
											) : (
												(entry.metric?.name ?? "—")
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}
