export function googleClientIds(
	primary: string,
	miniRudy?: string,
): string | string[] {
	const additional = miniRudy?.trim();
	return additional && additional !== primary ? [primary, additional] : primary;
}
