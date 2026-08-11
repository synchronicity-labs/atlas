export const PRODUCT_USER_ELIGIBILITY_TOKEN = "{{atlas_product_user_eligible}}";

function sqlLiteral(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

export function productUserEligibilityPredicate(
	bannedExternalIds: string[],
): string {
	const externalIds = [...new Set(bannedExternalIds.filter(Boolean))].sort();
	if (externalIds.length === 0) return "1 = 1";
	return `person_id not in (select person_id from events where distinct_id in (${externalIds.map(sqlLiteral).join(", ")}))`;
}

export function applyProductUserEligibility(
	query: string,
	predicate: string,
): string {
	if (!query.includes(PRODUCT_USER_ELIGIBILITY_TOKEN)) {
		throw new Error(
			`PostHog questions must include ${PRODUCT_USER_ELIGIBILITY_TOKEN}.`,
		);
	}
	return query.replaceAll(PRODUCT_USER_ELIGIBILITY_TOKEN, predicate);
}

export function applyPosthogPersonPolicy(
	query: string,
	policy: "exclude_banned_product_users" | "all_events",
	predicate: string,
): string {
	if (policy === "all_events") {
		if (query.includes(PRODUCT_USER_ELIGIBILITY_TOKEN)) {
			throw new Error(
				`PostHog all-events questions must omit ${PRODUCT_USER_ELIGIBILITY_TOKEN}.`,
			);
		}
		return query;
	}
	return applyProductUserEligibility(query, predicate);
}
