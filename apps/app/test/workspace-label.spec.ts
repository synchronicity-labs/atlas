import { describe, expect, it } from "bun:test";
import { DEFAULT_WORKSPACE_NAME } from "@crm/auth";
import { workspaceLabel } from "../lib/app-label";

describe("what the header calls this install", () => {
	it("shows Atlas before anybody has named the workspace", () => {
		expect(workspaceLabel(DEFAULT_WORKSPACE_NAME)).toBe("Atlas");
	});

	it("falls back to Atlas while the workspace is still loading", () => {
		expect(workspaceLabel(undefined)).toBe("Atlas");
		expect(workspaceLabel("")).toBe("Atlas");
		expect(workspaceLabel("   ")).toBe("Atlas");
	});

	it("combines the company with Atlas once it has one", () => {
		expect(workspaceLabel("Acme")).toBe("Acme · Atlas");
		expect(workspaceLabel("  Acme  ")).toBe("Acme · Atlas");
	});

	it("does not repeat a company that already ends in Atlas", () => {
		expect(workspaceLabel("Acme Atlas")).toBe("Acme Atlas");
		expect(workspaceLabel("Acme atlas")).toBe("Acme atlas");
	});
});
