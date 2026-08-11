import type { Metadata } from "next";
import { PageShell, PageShellContent } from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { AtlasDashboard } from "./atlas-dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({
	params,
}: {
	params: Promise<{ number: string }>;
}) {
	await requireSession();
	const number = Number((await params).number);
	const trpc = getServerTrpc();
	await getServerQueryClient().prefetchQuery(
		trpc.atlasDashboards.byNumber.queryOptions({ number }),
	);

	return (
		<PageShell className="max-w-[1600px]">
			<PageShellContent>
				<HydrateClient>
					<AtlasDashboard number={number} />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
