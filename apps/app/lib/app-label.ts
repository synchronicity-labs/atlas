export function workspaceLabel(name: string | undefined): string {
	const trimmed = name?.trim();

	if (!trimmed || trimmed.toLowerCase() === "crm") return "Atlas";

	return /\batlas$/i.test(trimmed) ? trimmed : `${trimmed} · Atlas`;
}
