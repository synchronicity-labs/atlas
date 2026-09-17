const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 8_000;

export type TypeSafeChoice = {
	choice: string;
	probabilities: Record<string, number>;
	confidence: number | null;
};

export async function askTypeSafeChoice(input: {
	state: unknown;
	instructions: string;
	criteria: Record<string, string>;
}): Promise<TypeSafeChoice | null> {
	const apiKey = process.env.TYPESAFE_API_KEY?.trim();
	if (!apiKey || Object.keys(input.criteria).length === 0) return null;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const response = await fetch(ENDPOINT, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "jev-latest",
				state: input.state,
				questions: {
					choice: {
						type: "choice",
						instructions: input.instructions,
						criteria: input.criteria,
					},
				},
			}),
			signal: controller.signal,
		});

		if (!response.ok) return null;

		const body = (await response.json()) as {
			answers?: {
				choice?: {
					choice?: unknown;
					probabilities?: unknown;
					confidence?: unknown;
				};
			};
		};
		const answer = body.answers?.choice;
		if (
			typeof answer?.choice !== "string" ||
			typeof answer.probabilities !== "object" ||
			answer.probabilities === null
		) {
			return null;
		}

		const probabilities = Object.fromEntries(
			Object.entries(answer.probabilities).flatMap(([key, value]) =>
				typeof value === "number" && Number.isFinite(value)
					? [[key, value]]
					: [],
			),
		);

		return {
			choice: answer.choice,
			probabilities,
			confidence:
				typeof answer.confidence === "number" &&
				Number.isFinite(answer.confidence)
					? answer.confidence
					: null,
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
