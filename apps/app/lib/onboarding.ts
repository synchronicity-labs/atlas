import type { NextRequest } from "next/server";
import { API_URL } from "@/lib/env";

export const ONBOARDING_PATH = "/onboarding";

const GATE_TIMEOUT_MS = 2_000;

export type Gate = "settled" | "required" | "unknown";

async function read<T>(
	request: NextRequest,
	procedure: string,
): Promise<T | null> {
	const cookie = request.headers.get("cookie");

	if (!cookie) return null;

	try {
		const response = await fetch(`${API_URL}/api/trpc/${procedure}`, {
			headers: { cookie },
			cache: "no-store",
			signal: AbortSignal.timeout(GATE_TIMEOUT_MS),
		});

		if (!response.ok) return null;

		const body = (await response.json()) as { result?: { data?: T } };

		return body.result?.data ?? null;
	} catch {
		return null;
	}
}

export async function readOnboardingGate(request: NextRequest): Promise<Gate> {
	const workspace = await read<{ onboarded?: boolean; canRename?: boolean }>(
		request,
		"workspace.get",
	);

	if (typeof workspace?.onboarded !== "boolean") return "unknown";

	return workspace.onboarded || !workspace.canRename ? "settled" : "required";
}
