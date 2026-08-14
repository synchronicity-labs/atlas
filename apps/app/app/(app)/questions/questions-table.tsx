"use client";

import { DataTable, type DataTableColumn } from "@crm/ui/components/data-table";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { MetricTrustIndicator } from "@crm/ui/components/metric-trust-indicator";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ListSearch } from "@/components/data-table/list-search";
import { useTableQuery } from "@/components/data-table/use-table-query";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { questionsSearchParams } from "./questions-search-params";

type QuestionRow = RouterOutputs["questions"]["list"]["rows"][number];

const COLUMNS: DataTableColumn<QuestionRow>[] = [
	{
		id: "number",
		header: "Question",
		sortable: true,
		hideable: false,
		width: "w-[34%]",
		cell: (question) => (
			<span className="flex min-w-0 items-center gap-3">
				<span className="w-8 shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
					{question.number}
				</span>
				<span className="truncate font-medium">{question.name}</span>
			</span>
		),
	},
	{
		id: "source",
		header: "Source question",
		width: "w-[18%]",
		cell: (question) =>
			question.sourceExternalId ? (
				<span className="font-mono text-muted-foreground text-xs">
					{question.connector === "METABASE" ? "Metabase" : question.connector}{" "}
					#{question.sourceExternalId}
				</span>
			) : (
				<EmptyCellValue />
			),
	},
	{
		id: "query",
		header: "Query",
		width: "w-[12%]",
		hideBelow: "md",
		cell: (question) => (
			<span className="text-muted-foreground text-xs">
				{question.latestVersion
					? `${question.latestVersion.queryLanguage} · v${question.latestVersion.version}`
					: "—"}
			</span>
		),
	},
	{
		id: "verification",
		header: "Trust",
		width: "w-[16%]",
		cell: (question) => (
			<MetricTrustIndicator summary={question.verification} />
		),
	},
	{
		id: "dashboards",
		header: "Dashboards",
		align: "right",
		width: "w-[8%]",
		hideBelow: "lg",
		cell: (question) => (
			<span className="tabular-nums">{question.dashboardCount}</span>
		),
	},
	{
		id: "updatedAt",
		header: "Updated",
		sortable: true,
		align: "right",
		width: "w-[12%]",
		cell: (question) => (
			<span className="text-muted-foreground" suppressHydrationWarning>
				{relativeTimeFromIso(question.updatedAt)}
			</span>
		),
	},
];

export function QuestionsTable() {
	const router = useRouter();
	const trpc = useTRPC();
	const { query, input } = useTableQuery(questionsSearchParams);
	const questions = useQuery({
		...trpc.questions.list.queryOptions(input),
		placeholderData: (previous) => previous,
	});

	return (
		<DataTable
			query={query}
			search={<ListSearch placeholder="Search Atlas or source question…" />}
			columns={COLUMNS}
			rows={questions.data?.rows ?? []}
			total={questions.data?.total ?? 0}
			getRowId={(question) => question.id}
			loading={questions.isFetching}
			onRowClick={(question) => router.push(`/questions/${question.number}`)}
			empty="No questions match this search."
		/>
	);
}
