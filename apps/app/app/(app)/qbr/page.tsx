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
import { QbrReview } from "./qbr-review";

export const metadata: Metadata = { title: "QBR team review" };

export default async function QbrPage() {
	await requireSession();
	const trpc = getServerTrpc();
	await getServerQueryClient().prefetchQuery(trpc.qbr.report.queryOptions());

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>QBR team review</PageShellTitle>
					<PageShellDescription>
						Review supplied Q3 results and collect the exact inputs still
						missing.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<HydrateClient>
					<QbrReview />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
