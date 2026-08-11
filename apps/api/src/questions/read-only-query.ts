export function assertReadOnlyQuery(
	language: "SQL" | "MBQL" | "API",
	queryText: string,
): void {
	if (language === "MBQL" || language === "API") return;
	const normalized = queryText.trim().replace(/^\(+/, "").toLowerCase();
	if (!/^(select|with|show|explain)\b/.test(normalized)) {
		throw new Error("Atlas questions only allow read-only SQL.");
	}
}
