export function jsonDate(value: Date | null): string | null {
	return value?.toISOString() ?? null;
}
