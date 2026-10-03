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
import { NorthStarDashboard } from "./north-star-dashboard";

export const metadata: Metadata = { title: "Q3 North Star" };

export default async function NorthStarPage() {
	await requireSession();
	const trpc = getServerTrpc();
	await getServerQueryClient().prefetchQuery(trpc.qbr.report.queryOptions());

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Q3 North Star</PageShellTitle>
					<PageShellDescription>
						July–September 2026 · quarter ended September 30
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<HydrateClient>
					<NorthStarDashboard />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
