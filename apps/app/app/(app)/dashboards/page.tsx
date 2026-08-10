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
import { DashboardsList } from "./dashboards-list";

export const metadata: Metadata = { title: "Dashboards" };

export default async function DashboardsPage() {
	await requireSession();
	const trpc = getServerTrpc();
	await getServerQueryClient().prefetchQuery(
		trpc.atlasDashboards.list.queryOptions(),
	);

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Dashboards</PageShellTitle>
					<PageShellDescription>
						Shared operating views assembled from reusable Atlas questions.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<HydrateClient>
					<DashboardsList />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
