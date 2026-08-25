import { describe, expect, it } from "bun:test";
import {
	canonicalContractName,
	contractCustomerAliases,
	contractDomainMatch,
	contractNameMatch,
} from "../agent/lib/contracts-mapping-names";

describe("contract customer mapping", () => {
	it("derives brand and legal aliases from folder names", () => {
		expect(
			contractCustomerAliases(
				"Visma (Accountants Academy BV)",
				"Accountants Academy B.V.",
			),
		).toEqual(["Visma", "Accountants Academy"]);
	});

	it("suggests exact normalized matches without accepting substrings", () => {
		const aliases = contractCustomerAliases("Chai Shots AI");
		expect(contractNameMatch(aliases, "Chai Shots")?.confidence).toBe(0.98);
		expect(contractNameMatch(aliases, "Chai Shots (old)")).toBeNull();
		expect(contractNameMatch(["USC"], "Facial muscle simulation")).toBeNull();
	});

	it("allows a descriptive product organization suffix as a suggestion", () => {
		const match = contractNameMatch(["CreatorKit"], "CreatorKit Production");
		expect(match).toEqual({ confidence: 0.88, matchedAlias: "CreatorKit" });
		expect(canonicalContractName("CAMB.AI")).toBe("camb ai");
	});

	it("matches a customer alias to a member email domain", () => {
		expect(contractDomainMatch(["Chai Shots"], "chaishots.in")).toEqual({
			confidence: 0.995,
			matchedAlias: "Chai Shots",
		});
		expect(contractDomainMatch(["Netflix Studios"], "netflix.com")).toEqual({
			confidence: 0.995,
			matchedAlias: "Netflix Studios",
		});
		expect(contractDomainMatch(["Sendr"], "gmail.com")).toBeNull();
	});
});
