import type { Metadata } from "next";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { MetricCatalog } from "./metric-catalog";

export const metadata: Metadata = { title: "Metrics" };

export default async function MetricsPage() {
	await requireSession();
	const trpc = getServerTrpc();
	await Promise.all([
		getServerQueryClient().prefetchQuery(
			trpc.metricCatalog.summary.queryOptions(),
		),
		getServerQueryClient().prefetchQuery(
			trpc.metricCatalog.list.queryOptions(),
		),
	]);

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Metric catalog</PageShellTitle>
					<PageShellDescription>
						Every KPI and measurement candidate, from source definition to
						verified answer.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<HydrateClient>
					<MetricCatalog />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
