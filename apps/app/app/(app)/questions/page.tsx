import type { Metadata } from "next";
import type { SearchParams } from "nuqs/server";
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
import { questionsSearchParams } from "./questions-search-params";
import { QuestionsTable } from "./questions-table";

export const metadata: Metadata = { title: "Questions" };

export default async function QuestionsPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	await requireSession();
	const values = await questionsSearchParams.load(searchParams);
	const trpc = getServerTrpc();
	await getServerQueryClient().prefetchQuery(
		trpc.questions.list.queryOptions(questionsSearchParams.toInput(values)),
	);

	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Questions</PageShellTitle>
					<PageShellDescription>
						Reusable, versioned queries that can live on any Atlas dashboard.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent className="min-h-0">
				<HydrateClient>
					<QuestionsTable />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
