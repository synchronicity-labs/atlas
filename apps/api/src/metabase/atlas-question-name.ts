const SOURCE_ORDER_PREFIX = /^\d{2}\s+/;
const API_SPLIT_PREFIX = /^api split\s*[-–—:]\s*/i;

export function atlasQuestionName(sourceName: string): string {
	const trimmed = sourceName.trim();
	const normalized = trimmed
		.replace(SOURCE_ORDER_PREFIX, "")
		.replace(API_SPLIT_PREFIX, "")
		.trim();

	return normalized || trimmed;
}
