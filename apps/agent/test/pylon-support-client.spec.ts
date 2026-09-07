import { describe, expect, mock, test } from "bun:test";
import {
	collectPylonPages,
	createPylonPageReader,
} from "../agent/lib/pylon-support-client";

function reader(responses: Response[]) {
	let clock = 0;
	const starts: number[] = [];
	const request = mock(async () => {
		starts.push(clock);
		const response = responses.shift();
		if (!response) throw new Error("Unexpected request");
		return response;
	});
	return {
		request,
		starts,
		read: createPylonPageReader({
			token: () => "test-token",
			fetch: request,
			now: () => clock,
			wait: async (ms) => {
				clock += ms;
			},
		}),
	};
}

describe("Pylon support reads", () => {
	test("paces concurrent reads instead of bursting through the provider limit", async () => {
		const client = reader([
			Response.json({ data: [] }),
			Response.json({ data: [] }),
		]);
		await Promise.all([client.read("/issues"), client.read("/surveys")]);
		expect(client.starts).toEqual([0, 2_100]);
	});

	test("retries the same page after the provider retry header", async () => {
		const client = reader([
			new Response(null, { status: 429, headers: { "X-Retry-After": "12" } }),
			Response.json({ data: [{ id: "one" }] }),
		]);
		expect(await client.read("/issues")).toEqual({ data: [{ id: "one" }] });
		expect(client.starts).toEqual([0, 12_000]);
	});

	test("bounds rate limit retries and does not retry permission failures", async () => {
		const throttled = reader(
			Array.from({ length: 3 }, () => new Response(null, { status: 429 })),
		);
		await expect(throttled.read("/issues")).rejects.toThrow("status 429");
		expect(throttled.request).toHaveBeenCalledTimes(3);
		const denied = reader([new Response(null, { status: 403 })]);
		await expect(denied.read("/issues")).rejects.toThrow("status 403");
		expect(denied.request).toHaveBeenCalledTimes(1);
	});

	test("rejects malformed and incomplete pages instead of reporting healthy totals", async () => {
		await expect(reader([Response.json({})]).read("/issues")).rejects.toThrow(
			"invalid page",
		);
		const client = reader([
			Response.json({ data: [], pagination: { has_next_page: true } }),
		]);
		await expect(collectPylonPages("/issues", client.read)).rejects.toThrow(
			"did not advance",
		);
	});

	test("collects each cursor once and refuses a repeating cursor", async () => {
		const page = {
			data: [{ id: "one" }],
			pagination: { has_next_page: true, cursor: "next" },
		};
		const client = reader([Response.json(page), Response.json(page)]);
		await expect(collectPylonPages("/issues", client.read)).rejects.toThrow(
			"did not advance",
		);
	});
});
