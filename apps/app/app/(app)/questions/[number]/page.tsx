import type { Metadata } from "next";
import { PageShell, PageShellContent } from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { QuestionEditor } from "./question-editor";

export const metadata: Metadata = { title: "Question" };

export default async function QuestionPage({
	params,
}: {
	params: Promise<{ number: string }>;
}) {
	await requireSession();
	const number = Number((await params).number);
	const trpc = getServerTrpc();
	await getServerQueryClient().prefetchQuery(
		trpc.questions.byNumber.queryOptions({ number }),
	);

	return (
		<PageShell className="max-w-[1500px]">
			<PageShellContent>
				<HydrateClient>
					<QuestionEditor number={number} />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
