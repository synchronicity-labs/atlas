"use client";

import Renew from "@carbon/icons-react/es/Renew";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type Entry = RouterOutputs["metricCatalog"]["list"][number];
type Summary = RouterOutputs["metricCatalog"]["summary"];

const READINESS_LABELS: Record<Entry["readiness"], string> = {
	CATALOGED: "Cataloged",
	NEEDS_DEFINITION: "Needs definition",
	NEEDS_SOURCE: "Needs source",
	READY_TO_IMPLEMENT: "Ready to build",
	IMPLEMENTING: "Implementing",
	RECONCILING: "Reconciling",
	VERIFIED: "Verified",
	BLOCKED: "Blocked",
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
			]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(needle)),
		);
	}, [entries.data, query]);

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

			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
			</div>

			<div className="flex flex-wrap gap-2">
				{Object.entries(READINESS_LABELS).map(([key, label]) => (
					<span
						key={key}
						className="inline-flex items-center gap-1.5 rounded-full border bg-muted/25 px-2.5 py-1 text-xs"
					>
						<span className={readinessTone(key as Entry["readiness"])}>●</span>
						{label}
						<span className="text-muted-foreground tabular-nums">
							{count(summary.data, key as Entry["readiness"])}
						</span>
					</span>
				))}
			</div>

			<Input
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="Search measures, teams, tabs, or canonical metrics"
				aria-label="Search metric catalog"
			/>

			<div className="overflow-hidden rounded-lg border bg-card">
				<div className="overflow-x-auto">
					<table className="w-full min-w-[920px] text-sm">
						<thead className="border-b bg-muted/30 text-left text-muted-foreground text-xs">
							<tr>
								<th className="px-4 py-3 font-medium">Source</th>
								<th className="px-4 py-3 font-medium">Measure</th>
								<th className="px-4 py-3 font-medium">Kind</th>
								<th className="px-4 py-3 font-medium">Team</th>
								<th className="px-4 py-3 font-medium">Readiness</th>
								<th className="px-4 py-3 font-medium">Atlas metric</th>
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
											{entry.ownerTeam ?? "—"}
										</td>
										<td className="px-4 py-3 align-top">
											<span className={readinessTone(entry.readiness)}>
												{READINESS_LABELS[entry.readiness]}
											</span>
										</td>
										<td className="px-4 py-3 align-top text-muted-foreground">
											{entry.metric?.name ?? "—"}
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
