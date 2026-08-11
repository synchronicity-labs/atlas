import { createListSearchParams } from "@/components/data-table/list-search-params";

export const usersSearchParams = createListSearchParams({
	defaultSort: "syncedAt",
	defaultDir: "desc",
});
