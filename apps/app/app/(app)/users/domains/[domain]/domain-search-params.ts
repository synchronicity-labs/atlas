import { createListSearchParams } from "@/components/data-table/list-search-params";

export const domainSearchParams = createListSearchParams({
	defaultSort: "name",
	defaultDir: "asc",
	pageSize: 50,
});
