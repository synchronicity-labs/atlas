import { describe, expect, it } from "bun:test";
import { linkifyMarkdownUrls } from "../src/lib/markdown";

describe("linkifyMarkdownUrls", () => {
	it("turns a standalone URL code block into an autolink", () => {
		expect(
			linkifyMarkdownUrls("```text\nhttps://example.com/questions/697\n```"),
		).toBe("<https://example.com/questions/697>");
	});

	it("turns an inline URL code span into an autolink", () => {
		expect(linkifyMarkdownUrls("See `https://example.com/source`.")).toBe(
			"See <https://example.com/source>.",
		);
	});

	it("preserves code blocks that contain more than a URL", () => {
		const markdown = "```sql\nselect 'https://example.com' as source\n```";
		expect(linkifyMarkdownUrls(markdown)).toBe(markdown);
	});

	it("does not linkify non-http schemes", () => {
		const markdown = "```\nslack/rudy-product/1785777745.013879\n```";
		expect(linkifyMarkdownUrls(markdown)).toBe(markdown);
	});
});
