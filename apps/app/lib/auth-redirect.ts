export const DEFAULT_AUTH_DESTINATION = "/dashboards";

export function getSafeAuthDestination(
	value: string | string[] | undefined,
): string {
	const destination = Array.isArray(value) ? value[0] : value;

	if (
		!destination?.startsWith("/") ||
		destination.startsWith("//") ||
		destination.includes("\\")
	) {
		return DEFAULT_AUTH_DESTINATION;
	}

	const url = new URL(destination, "https://atlas.local");

	if (url.origin !== "https://atlas.local" || url.pathname === "/sign-in") {
		return DEFAULT_AUTH_DESTINATION;
	}

	return `${url.pathname}${url.search}${url.hash}`;
}

export function getSignInPath(destination: string, method?: "google") {
	const search = new URLSearchParams({ next: destination });

	if (method) {
		search.set("method", method);
	}

	return `/sign-in?${search.toString()}`;
}
