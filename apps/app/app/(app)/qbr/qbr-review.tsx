"use client";

import { Button } from "@crm/ui/components/button";
import {
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc/client";
import {
	buildTeamRequest,
	isAtlasFollowup,
	isManualMissing,
	type QbrMetric,
	sortedObservations,
	teamForOwner,
	teamId,
} from "./qbr-review-logic";

type Metric = QbrMetric;

function observationLabel(period: string) {
	return period === "2026-Q3" ? "Q3 2026" : period;
}

function MetricItem({
	id,
	metric,
	mode,
}: {
	id: string;
	metric: Metric;
	mode: "supplied" | "manual" | "atlas";
}) {
	const observations = sortedObservations(metric);
	const quarter = metric.observations["2026-Q3"];
	const hasCohort = observations.some(
		([, observation]) => observation.cohortMonth,
	);
	return (
		<CardContent>
			<CardHeader>
				<div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
					<div className="min-w-0">
						<CardTitle>{metric.label}</CardTitle>
						<CardDescription>
							{id} · {metric.preparation.owner} ·{" "}
							{metric.preparation.workstream.replaceAll("_", " ")}
						</CardDescription>
					</div>
					<span className="text-xs text-muted-foreground">
						{quarter
							? `${quarter.status === "provisional" ? "Provisional · verify" : "Reported · verify"}`
							: hasCohort
								? "Cohort observation · review"
								: metric.automated
									? "Quarter calculation pending in Atlas"
									: observations.length
										? "Monthly only · Q3 result missing"
										: "No observations"}
					</span>
				</div>
			</CardHeader>
			{metric.question ? (
				<a
					className="text-sm underline underline-offset-4"
					href={metric.question.url}
					target="_blank"
					rel="noreferrer"
				>
					Atlas question {metric.question.number}
				</a>
			) : (
				<p className="text-sm text-muted-foreground">
					Atlas question is not registered.
				</p>
			)}
			<p className="text-sm">{metric.definition}</p>
			{observations.length ? (
				<dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
					{observations.map(([period, observation]) => (
						<div key={period} className="rounded-md border p-3">
							<dt className="font-medium">
								{observationLabel(period)} · {observation.status}
							</dt>
							<dd>
								{observation.value} {metric.unit}
							</dd>
							<dd className="text-muted-foreground">
								Source:{" "}
								<a
									className="underline underline-offset-4"
									href={observation.evidenceSource.url}
									target="_blank"
									rel="noreferrer"
								>
									{observation.evidenceSource.label}
								</a>
							</dd>
							<dd className="text-muted-foreground">
								{observation.cohortMonth
									? `Cohort ${observation.cohortMonth}; `
									: ""}
								As of {observation.asOf}; data through{" "}
								{observation.dataThrough ?? "unknown"}
							</dd>
						</div>
					))}
				</dl>
			) : (
				<p className="text-sm text-muted-foreground">
					No saved observations for this quarter.
				</p>
			)}
			<p className="text-sm text-muted-foreground">
				{metric.preparation.ownerStatus}. Collection location:{" "}
				{metric.preparation.dataLocation}
			</p>
			{mode === "manual" ? (
				<details className="text-sm">
					<summary className="cursor-pointer font-medium">
						Manual ask and Q4 automation
					</summary>
					<div className="mt-3 grid gap-3">
						<p>
							<span className="font-medium">Manual ask: </span>
							{metric.preparation.manualAsk}
						</p>
						<p>
							<span className="font-medium">Q4 automation: </span>
							{metric.preparation.q4Build}
						</p>
						<p>
							<span className="font-medium">Preparation gap: </span>
							{metric.preparation.gap}
						</p>
					</div>
				</details>
			) : mode === "atlas" ? (
				<details className="text-sm">
					<summary className="cursor-pointer font-medium">
						Atlas follow-up and Q4 automation
					</summary>
					<div className="mt-3 grid gap-3">
						<p>
							Nacho will refresh source-complete data and calculate the Q3
							result in Atlas.
						</p>
						<p>
							<span className="font-medium">Q4 automation: </span>
							{metric.preparation.q4Build}
						</p>
					</div>
				</details>
			) : (
				<details className="text-sm">
					<summary className="cursor-pointer font-medium">
						Definition and Q4 automation
					</summary>
					<div className="mt-3 grid gap-3">
						<p>
							<span className="font-medium">Q4 automation: </span>
							{metric.preparation.q4Build}
						</p>
					</div>
				</details>
			)}
		</CardContent>
	);
}

export function QbrReview() {
	const trpc = useTRPC();
	const { data, isPending, error } = useQuery(trpc.qbr.report.queryOptions());
	const [teamParam, setTeamParam] = useQueryState("team", parseAsString);
	const [copyStatus, setCopyStatus] = useState("");
	if (isPending) return <p role="status">Loading QBR review…</p>;
	if (error)
		return <p role="alert">QBR review could not be loaded: {error.message}</p>;
	if (!data || !Object.keys(data.metrics).length)
		return <p>No QBR metrics are registered for this quarter.</p>;

	const grouped: Record<string, [string, Metric][]> = {};
	for (const entry of Object.entries(data.metrics)) {
		const group = teamForOwner(entry[1].preparation.owner);
		if (!grouped[group]) grouped[group] = [];
		grouped[group].push(entry);
	}
	const teams = Object.keys(grouped).sort();
	const selected = teams.find((team) => teamId(team) === teamParam) ?? teams[0];
	if (!selected) return <p>No team groups are available in the QBR report.</p>;
	const metrics = grouped[selected] ?? [];
	const active = metrics.filter(([, metric]) => !metric.notApplicable);
	const supplied = active.filter(
		([, metric]) => Object.keys(metric.observations).length > 0,
	);
	const missing = active.filter(([, metric]) => isManualMissing(metric));
	const atlasFollowups = active.filter(([, metric]) => isAtlasFollowup(metric));
	const notApplicable = metrics.filter(([, metric]) => metric.notApplicable);
	const reviewUrl = () => {
		const origin = metrics.find(([, metric]) => metric.question)?.[1].question
			?.url;
		const atlasOrigin = origin
			? new URL(origin).origin
			: "https://atlas.pr.sync.so";
		return `${atlasOrigin}/qbr?team=${encodeURIComponent(teamId(selected))}`;
	};
	const copy = async (text: string, label: string) => {
		try {
			await navigator.clipboard.writeText(text);
			const localPreview = ["localhost", "127.0.0.1"].includes(
				window.location.hostname,
			);
			setCopyStatus(
				`${label} copied.${localPreview ? " This is a local preview; deploy this page before sharing the Atlas link." : ""}`,
			);
		} catch {
			setCopyStatus(
				`Could not copy ${label.toLowerCase()}. Check browser clipboard permissions.`,
			);
		}
	};

	return (
		<div className="grid gap-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<fieldset className="flex flex-wrap gap-2">
					<legend className="sr-only">QBR teams</legend>
					{teams.map((team) => (
						<Button
							key={team}
							variant={team === selected ? "secondary" : "outline"}
							onClick={() => void setTeamParam(teamId(team))}
							aria-pressed={team === selected}
						>
							{team}
						</Button>
					))}
				</fieldset>
				<div className="flex gap-2">
					<Button
						variant="outline"
						onClick={() => void copy(reviewUrl(), "Team review link")}
					>
						Copy team link
					</Button>
					<Button
						onClick={() =>
							void copy(
								buildTeamRequest(selected, metrics, reviewUrl()),
								"team review request",
							)
						}
					>
						Copy team request
					</Button>
				</div>
			</div>
			<p className="text-sm text-muted-foreground" aria-live="polite">
				{copyStatus}
			</p>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<div className="rounded-lg border p-4">
					<p className="text-sm text-muted-foreground">
						Metrics with results to verify
					</p>
					<p className="text-2xl font-semibold">{supplied.length}</p>
				</div>
				<div className="rounded-lg border p-4">
					<p className="text-sm text-muted-foreground">Manual inputs missing</p>
					<p className="text-2xl font-semibold">{missing.length}</p>
				</div>
				<div className="rounded-lg border p-4">
					<p className="text-sm text-muted-foreground">Atlas follow-ups</p>
					<p className="text-2xl font-semibold">{atlasFollowups.length}</p>
				</div>
				<div className="rounded-lg border p-4">
					<p className="text-sm text-muted-foreground">Not applicable</p>
					<p className="text-2xl font-semibold">{notApplicable.length}</p>
				</div>
			</div>
			<section className="grid gap-3" aria-labelledby="supplied-heading">
				<h2 id="supplied-heading" className="text-lg font-semibold">
					Supplied results to verify
				</h2>
				{supplied.length ? (
					supplied.map(([id, metric]) => (
						<article key={id} className="grid gap-3">
							<MetricItem id={id} metric={metric} mode="supplied" />
						</article>
					))
				) : (
					<p className="text-sm text-muted-foreground">
						No observations are saved for this team.
					</p>
				)}
			</section>
			{notApplicable.length ? (
				<section className="grid gap-3" aria-labelledby="na-heading">
					<h2 id="na-heading" className="text-lg font-semibold">
						Not applicable
					</h2>
					{notApplicable.map(([id, metric]) => (
						<article key={id} className="rounded-lg border p-4">
							<p className="font-medium">{metric.label}</p>
							<p className="text-sm text-muted-foreground">
								{metric.definition}
							</p>
						</article>
					))}
				</section>
			) : null}
			<section className="grid gap-3" aria-labelledby="missing-heading">
				<h2 id="missing-heading" className="text-lg font-semibold">
					Missing manual inputs
				</h2>
				{missing.length ? (
					missing.map(([id, metric]) => (
						<article key={id} className="grid gap-3">
							<MetricItem id={id} metric={metric} mode="manual" />
						</article>
					))
				) : (
					<p className="text-sm text-muted-foreground">
						No missing Q3 results for this team.
					</p>
				)}
			</section>
			<section className="grid gap-3" aria-labelledby="atlas-followup-heading">
				<h2 id="atlas-followup-heading" className="text-lg font-semibold">
					Atlas follow-up
				</h2>
				{atlasFollowups.length ? (
					atlasFollowups.map(([id, metric]) => (
						<article key={id} className="grid gap-3">
							<MetricItem id={id} metric={metric} mode="atlas" />
						</article>
					))
				) : (
					<p className="text-sm text-muted-foreground">
						No pending Atlas calculations for this team.
					</p>
				)}
			</section>
			<p className="text-xs text-muted-foreground">
				Generated {data.generatedAt}. Reported and provisional values remain
				unverified until a lead reviews them.
			</p>
		</div>
	);
}
