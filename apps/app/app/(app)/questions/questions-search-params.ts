import { createListSearchParams } from "@/components/data-table/list-search-params";

export const questionsSearchParams = createListSearchParams({
	defaultSort: "updatedAt",
	defaultDir: "desc",
});
