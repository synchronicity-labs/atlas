export function assertReadOnlyQuery(
	language: "SQL" | "MBQL" | "API",
	queryText: string,
): void {
	if (language === "MBQL" || language === "API") return;
	const normalized = queryText
		.trim()
		.replace(/^(?:(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/)|\s)+/, "")
		.replace(/^\(+/, "")
		.trimStart()
		.toLowerCase();
	if (!/^(select|with|show|explain)\b/.test(normalized)) {
		throw new Error("Atlas questions only allow read-only SQL.");
	}
}

const PRODUCT_POSTGRES_DATABASE_ID = "34";
const MAX_SENSITIVE_IDENTITY_ROWS = 2000;

export function bindDefaultMetabaseTemplateVariables(
	language: "SQL" | "MBQL",
	queryText: string,
): string {
	if (language !== "SQL") return queryText;

	return queryText.replace(/\{\{\s*bucket\s*\}\}/gi, "'month'");
}

export function boundSensitiveIdentityResult(
	language: "SQL" | "MBQL",
	queryText: string,
	databaseExternalId: string | null,
): string {
	if (
		language !== "SQL" ||
		databaseExternalId !== PRODUCT_POSTGRES_DATABASE_ID ||
		!/(?:\bauth\s*\.\s*users\b|\buser_organizations\b)/i.test(queryText)
	) {
		return queryText;
	}

	const queryWithoutTrailingSemicolon = queryText.trim().replace(/;+\s*$/, "");
	return `select * from (${queryWithoutTrailingSemicolon}) as atlas_bounded_identity_result limit ${MAX_SENSITIVE_IDENTITY_ROWS}`;
}
