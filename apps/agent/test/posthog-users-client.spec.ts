import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { PosthogClient } from "../agent/lib/posthog-users";

afterEach(() => mock.restore());

function client(responses: Array<Response | Error>) {
	const request = spyOn(globalThis, "fetch").mockImplementation(async () => {
		const next = responses.shift();
		if (next instanceof Error) throw next;
		if (!next) throw new Error("Unexpected request");
		return next;
	});
	return {
		request,
		read: () =>
			new PosthogClient({
				host: "https://posthog.example",
				apiKey: "fixture",
				projectId: "1",
			}).byDistinctId("fixture-id"),
	};
}

describe("PostHog read recovery", () => {
	test("retries a non-JSON upstream 503 before parsing its body", async () => {
		const probe = client([
			new Response("upstream connection error", { status: 503 }),
			Response.json({ results: {} }),
		]);
		expect(await probe.read()).toBeNull();
		expect(probe.request).toHaveBeenCalledTimes(2);
		expect(probe.request.mock.calls[0]).toEqual(probe.request.mock.calls[1]);
	});
	test("retries a transport failure once", async () => {
		const probe = client([
			new TypeError("private upstream details"),
			Response.json({ results: {} }),
		]);
		expect(await probe.read()).toBeNull();
		expect(probe.request).toHaveBeenCalledTimes(2);
	});
	test("persistent 503 keeps the HTTP status and stops after one retry", async () => {
		const probe = client([
			new Response("private upstream details", { status: 503 }),
			new Response("private upstream details", { status: 503 }),
		]);
		await expect(probe.read()).rejects.toThrow(
			"PostHog request failed (HTTP 503).",
		);
		expect(probe.request).toHaveBeenCalledTimes(2);
	});
	test.each([401, 403, 429])("does not retry HTTP %i", async (status) => {
		const probe = client([new Response("private body", { status })]);
		await expect(probe.read()).rejects.toThrow(
			`PostHog request failed (HTTP ${status}).`,
		);
		expect(probe.request).toHaveBeenCalledTimes(1);
	});
	test("persistent invalid JSON never becomes an empty successful result", async () => {
		const probe = client([
			new Response("private body"),
			new Response("private body"),
		]);
		await expect(probe.read()).rejects.toThrow(
			"PostHog returned invalid JSON.",
		);
		expect(probe.request).toHaveBeenCalledTimes(2);
	});
});
