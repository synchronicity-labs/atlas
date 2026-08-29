import { describe, expect, test } from "bun:test";
import {
	buildCompanyEnrichmentPlan,
	chunks,
	companyInvoiceMappingSql,
	csvText,
	finalizeCompanyEnrichment,
	generationEvidenceSql,
	joinEnrichmentResults,
	mappingStatus,
	parseCsv,
	prepareInputs,
	productMembershipSql,
	validateGenerationEvidence,
	validateWindow,
} from "../agent/lib/persona-evidence";

const company = {
	email_domain: "example.com",
	orgs: "2",
	total_lifetime_rev: "100",
};
const person = {
	org_id: "cus_Example1",
	email: "Person@example.com",
	lifetime_rev: "10",
	first_paid: "2026-01",
};
const label = {
	org_id: "cus_Example2",
	email_domain: "example.com",
	lifetime_rev: "20",
	first_paid: "2026-01",
	persona_label: "",
};
const org = "00000000-0000-0000-0000-000000000001";
const start = "2026-07-01T00:00:00Z";
const end = "2026-08-01T00:00:00Z";

describe("persona CSV inputs", () => {
	test("preserves quotes, commas, line breaks, and empty labels", () => {
		const rows = [
			{ org_id: "cus_1", value: 'one, "two"\nthree', persona_label: "" },
		];
		expect(
			parseCsv(csvText(rows, ["org_id", "value", "persona_label"])),
		).toEqual(rows);
		expect(parseCsv("\uFEFFid,label\r\n1,\r\n")).toEqual([
			{ id: "1", label: "" },
		]);
	});
	test("rejects malformed files", () => {
		for (const source of [
			"a,a\n1,2",
			"a,\n1,2",
			'a\n"unclosed',
			"a,b\n1",
			'a\n"one"two',
		]) {
			expect(() => parseCsv(source)).toThrow();
		}
	});
	test("escapes spreadsheet formulas while keeping numeric negatives", () => {
		expect(csvText([{ a: "=1+1", b: "-12.5" }], ["a", "b"])).toBe(
			"a,b\n'=1+1,-12.5\n",
		);
	});
	test("preserves original keys and bridges repeated person emails", () => {
		const second = {
			...person,
			org_id: "cus_Example3",
			email: "person@example.com",
		};
		const result = prepareInputs([company], [person, second], [label]);
		expect(result.personRows).toHaveLength(1);
		expect(result.personBridge).toHaveLength(2);
		expect(result.personBridge[0]).toMatchObject(person);
		expect(result.personBridge[1]?.enrichment_key).toBe(
			result.personBridge[0]?.enrichment_key,
		);
		expect(result.personBridge[0]?.stripe_customer_id).toBe(person.org_id);
		expect(result.labelRows[0]?.persona_label).toBe("");
		expect(result.companyBridge[0]).toMatchObject(company);
	});
	test("keeps distinct addresses distinct, including plus aliases", () => {
		const result = prepareInputs(
			[company],
			[
				person,
				{ ...person, org_id: "cus_Example3", email: "person+work@example.com" },
			],
			[label],
		);
		expect(result.personRows).toHaveLength(2);
	});
	test("does not replace existing human review", () => {
		const reviewed = {
			...label,
			persona_label: "agency",
			reviewed_by: "Reviewer",
			evidence_url: "https://example.com",
			review_notes: "Confirmed",
		};
		expect(
			prepareInputs([company], [person], [reviewed]).labelRows[0],
		).toMatchObject(reviewed);
	});
	test("rejects wrong key shapes, duplicate customers, labels, and missing fields", () => {
		expect(() =>
			prepareInputs([company], [{ ...person, org_id: org }], [label]),
		).toThrow();
		expect(() => prepareInputs([company], [person, person], [label])).toThrow();
		expect(() =>
			prepareInputs(
				[company],
				[person],
				[{ ...label, persona_label: "guess" }],
			),
		).toThrow();
		expect(() =>
			prepareInputs([company], [person], [{ org_id: "cus_1" }]),
		).toThrow();
	});
	test("deduplicates case variants without losing original company rows", () => {
		const companies = [company, { ...company, email_domain: "EXAMPLE.COM" }];
		const result = prepareInputs(companies, [person], [label]);
		expect(result.companyRows).toHaveLength(1);
		expect(result.companyBridge).toHaveLength(2);
		expect(result.companyBridge[1]?.email_domain).toBe("EXAMPLE.COM");
		expect(result.companyBridge[1]?.enrichment_key).toBe("example.com");
	});
});

describe("prior company enrichment reuse", () => {
	const prior = {
		email_domain: "example.com",
		company_name: "Example",
		employee_count: "42",
		industry: "Software",
		company_type: "",
		monthly_traffic: "1000",
		prior_source_generated_at: "2026-06-05T12:42:00Z",
		prior_source_url: "https://docs.google.com/spreadsheets/d/example",
	};
	test("reuses each old field and asks Clay only for missing fields", () => {
		const rows = buildCompanyEnrichmentPlan(
			[
				{ email_domain: "example.com", enrichment_key: "example.com" },
				{ email_domain: "missing.com", enrichment_key: "missing.com" },
			],
			[prior],
		);
		expect(rows[0]).toMatchObject({
			company_domain_url: "https://example.com",
			company_name: "Example",
			employee_count: "42",
			industry: "Software",
			prior_enrichment_present: "true",
			need_company_name: "false",
			need_employee_count: "false",
			need_industry: "false",
			need_company_type: "true",
			missing_company_fields: "company_type",
		});
		expect(rows[1]).toMatchObject({
			prior_enrichment_present: "false",
			missing_company_fields:
				"company_name|employee_count|industry|company_type",
		});
	});
	test("rejects unsafe, repeated, invalid, and untraceable cached data", () => {
		const companies = [
			{ email_domain: "example.com", enrichment_key: "example.com" },
		];
		for (const invalid of [
			{ ...prior, prior_source_url: "" },
			{ ...prior, employee_count: "many" },
			{ ...prior, company_type: "partner" },
			{ ...prior, sample_email: "person@example.com" },
			{ ...prior, clay_result_present: "true" },
		]) {
			expect(() => buildCompanyEnrichmentPlan(companies, [invalid])).toThrow();
		}
		expect(() =>
			buildCompanyEnrichmentPlan(companies, [prior, prior]),
		).toThrow();
		expect(() =>
			buildCompanyEnrichmentPlan([...companies, ...companies], [prior]),
		).toThrow();
	});
});

describe("generation result checks", () => {
	const aggregate = {
		product_organization_id: org,
		completed_generations: "2",
		valid_duration_generations: "1",
		missing_or_invalid_duration_generations: "1",
		generations_with_segments: "1",
		generated_seconds: "30",
		average_output_seconds: "30",
		median_output_seconds: "30",
		p90_output_seconds: "30",
	};
	const rows = [
		{ ...aggregate, breakdown: "organization", dimension: "all" },
		{ ...aggregate, breakdown: "model", dimension: "test-model" },
		{ ...aggregate, breakdown: "surface", dimension: "api" },
	] as const;
	test("accepts reconciled aggregates and genuinely empty observations", () => {
		expect(() => validateGenerationEvidence(rows, [org])).not.toThrow();
		expect(() => validateGenerationEvidence([], [org])).not.toThrow();
	});
	test("rejects out-of-scope organizations and repeated aggregate rows", () => {
		expect(() => validateGenerationEvidence(rows, [])).toThrow();
		expect(() =>
			validateGenerationEvidence([...rows, rows[0]], [org]),
		).toThrow();
	});
	test("rejects mismatched counts and missing breakdowns", () => {
		expect(() =>
			validateGenerationEvidence(
				rows.map((row) => ({ ...row, completed_generations: "3" })),
				[org],
			),
		).toThrow();
		expect(() => validateGenerationEvidence(rows.slice(0, 2), [org])).toThrow();
		expect(() => validateGenerationEvidence(rows.slice(1), [org])).toThrow();
	});
	test("does not convert missing or invalid duration into a made-up measurement", () => {
		for (const value of ["", "NaN", "Infinity", "-30", "0"]) {
			expect(() =>
				validateGenerationEvidence(
					rows.map((row) => ({ ...row, average_output_seconds: value })),
					[org],
				),
			).toThrow();
		}
		const missing = rows.map((row) => ({
			...row,
			valid_duration_generations: "0",
			missing_or_invalid_duration_generations: "2",
			generated_seconds: "",
			average_output_seconds: "",
			median_output_seconds: "",
			p90_output_seconds: "",
		}));
		expect(() => validateGenerationEvidence(missing, [org])).not.toThrow();
	});
	test("requires model and surface sums to equal the organization total", () => {
		expect(() =>
			validateGenerationEvidence(
				rows.map((row) => ({
					...row,
					generated_seconds: row.breakdown === "model" ? "31" : "30",
				})),
				[org],
			),
		).toThrow();
		const wrongModel = {
			...rows[1],
			completed_generations: "3",
			missing_or_invalid_duration_generations: "2",
		};
		expect(() =>
			validateGenerationEvidence([rows[0], wrongModel, rows[2]], [org]),
		).toThrow();
	});
});

describe("Clay result joins", () => {
	test("keeps original company rows, domains and amounts without trusting results", () => {
		const { companyBridge } = prepareInputs(
			[company, { ...company, email_domain: "EXAMPLE.COM" }],
			[person],
			[label],
		);
		const result = joinEnrichmentResults(
			companyBridge,
			[
				{
					enrichment_key: "example.com",
					email_domain: "example.com",
					company_name: "Example",
					total_lifetime_rev: "wrong",
					persona_label: "agency",
				},
			],
			"company",
		);
		expect(result).toHaveLength(2);
		expect(result[1]).toMatchObject({
			email_domain: "EXAMPLE.COM",
			total_lifetime_rev: "100",
			clay_field_company_name: "Example",
			clay_field_total_lifetime_rev: "wrong",
			clay_review_status: "unreviewed",
			clay_result_present: "true",
		});
		expect(result[1]?.persona_label).toBeUndefined();
	});
	test("fans one person lookup out to its original accounts and retains human labels", () => {
		const { personBridge, personRows } = prepareInputs(
			[company],
			[
				{ ...person, persona_label: "studio" },
				{ ...person, org_id: "cus_Another" },
			],
			[label],
		);
		const result = joinEnrichmentResults(
			personBridge,
			[{ ...personRows[0], title: "Producer", persona_label: "agency" }],
			"person",
		);
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			...person,
			persona_label: "studio",
			clay_field_title: "Producer",
			clay_field_persona_label: "agency",
		});
		expect(result[1]?.org_id).toBe("cus_Another");
	});
	test("keeps unmatched accounts instead of dropping them", () => {
		const { personBridge } = prepareInputs([company], [person], [label]);
		expect(joinEnrichmentResults(personBridge, [], "person")[0]).toMatchObject({
			...person,
			clay_result_present: "false",
			clay_review_status: "not_returned",
		});
	});
	test("rejects unknown, repeated and changed join keys", () => {
		const { personBridge, personRows, companyBridge } = prepareInputs(
			[company],
			[person],
			[label],
		);
		const firstPerson = personRows[0];
		if (!firstPerson) throw new Error("Missing fixture person");
		expect(() =>
			joinEnrichmentResults(
				personBridge,
				[{ ...firstPerson, email: "someone-else@example.com" }],
				"person",
			),
		).toThrow();
		expect(() =>
			joinEnrichmentResults(personBridge, [firstPerson, firstPerson], "person"),
		).toThrow();
		expect(() =>
			joinEnrichmentResults(
				personBridge,
				[{ enrichment_key: "unknown" }],
				"person",
			),
		).toThrow();
		expect(() =>
			joinEnrichmentResults(
				companyBridge,
				[{ enrichment_key: "example.com", email_domain: "changed.com" }],
				"company",
			),
		).toThrow();
		expect(() =>
			joinEnrichmentResults(
				[{ ...companyBridge[0], clay_review_status: "unreviewed" }],
				[],
				"company",
			),
		).toThrow();
	});
});

describe("final company enrichment evidence", () => {
	const joined = {
		email_domain: "example.com",
		enrichment_key: "example.com",
		company_name: "Prior Example",
		employee_count: "",
		industry: "",
		company_type: "",
		"clay_field_Enrich company": "Example Inc",
		clay_field_Name: "Clay Example",
		"clay_field_Employee Count": "42",
		clay_field_Industry: "Software",
	};
	test("keeps prior values and lets Clay fill only safe missing fields", () => {
		const result = finalizeCompanyEnrichment([joined]);
		expect(result.rows[0]).toEqual({
			email_domain: "example.com",
			enrichment_key: "example.com",
			company_name: "Prior Example",
			employee_count: "42",
			industry: "Software",
			company_type: "",
			company_name_source: "prior_sheet",
			employee_count_source: "clay",
			industry_source: "clay",
			company_type_status: "not_classified",
			company_match_status: "matched",
			company_match_review_status: "unreviewed",
		});
		expect(result.summary).toMatchObject({
			inputRows: 1,
			uniqueKeys: 1,
			clayMatches: 1,
			clayNotFound: 0,
			fullyEnrichedCore: 1,
			companyTypePending: 1,
			coverage: { company_name: 1, employee_count: 1, industry: 1 },
		});
	});
	test("does not mistake Company Not Found for a successful match", () => {
		const result = finalizeCompanyEnrichment([
			{
				...joined,
				company_name: "",
				"clay_field_Enrich company": "❌ Company Not Found",
				clay_field_Name: "",
				"clay_field_Employee Count": "",
				clay_field_Industry: "",
			},
		]);
		expect(result.rows[0]).toMatchObject({
			company_name: "",
			company_match_status: "not_found",
			company_match_review_status: "not_applicable",
		});
		expect(result.summary.clayNotFound).toBe(1);
	});
	test("rejects bad counts, repeated keys, and premature company types", () => {
		expect(() =>
			finalizeCompanyEnrichment([
				{ ...joined, "clay_field_Employee Count": "many" },
			]),
		).toThrow();
		expect(() => finalizeCompanyEnrichment([joined, joined])).toThrow();
		expect(() =>
			finalizeCompanyEnrichment([{ ...joined, company_type: "agency" }]),
		).toThrow();
	});
});

describe("bounded source evidence", () => {
	test("requires explicit, valid, bounded UTC windows", () => {
		expect(() => validateWindow(start, end)).not.toThrow();
		expect(() =>
			validateWindow(start, "2026-08-01T00:00:00.123Z"),
		).not.toThrow();
		for (const pair of [
			[end, start],
			[start, "2027-01-01T00:00:00Z"],
			["2026-07-01", end],
			["2026-02-30T00:00:00Z", "2026-03-04T00:00:00Z"],
		]) {
			expect(() => validateWindow(pair[0] ?? "", pair[1] ?? "")).toThrow();
		}
	});
	test("membership query never returns the full identity population", () => {
		const sql = productMembershipSql([person.org_id]);
		expect(sql).toContain("where o.stripe_customer_id in ('cus_Example1')");
		expect(sql).toContain("count(distinct m.user_id)");
		expect(sql).not.toContain("select u.");
		expect(() => productMembershipSql([])).toThrow();
		expect(() =>
			productMembershipSql(Array(101).fill(person.org_id)),
		).toThrow();
		expect(() => productMembershipSql(["cus_x' or true --"])).toThrow();
	});
	test("generation query uses final output duration and no media bodies", () => {
		const sql = generationEvidenceSql([org], start, end);
		expect(sql).toContain("where organization_id in (");
		expect(sql).toContain("and status = 'COMPLETED' and deleted_at is null");
		expect(sql).toContain("finished_at >=");
		expect(sql).toContain("finished_at <");
		expect(sql).toContain("output_media_length");
		expect(sql).not.toContain("output_url");
		expect(sql).not.toContain("inputs");
		expect(() => generationEvidenceSql([], start, end)).toThrow();
		expect(() =>
			generationEvidenceSql(Array(41).fill(org), start, end),
		).toThrow();
	});
	test("company lookup is domain-scoped, deduplicated and keyset-paged", () => {
		const sql = companyInvoiceMappingSql(
			["example.com"],
			end,
			"example.com/cus_1",
		);
		expect(sql).toContain("email_domain in ('example.com')");
		expect(sql).toContain("countDistinct(id)");
		expect(sql).toContain("mapping_key > 'example.com/cus_1'");
		expect(sql).toContain("order by mapping_key limit 500");
		expect(() => companyInvoiceMappingSql([], end)).toThrow();
	});
	test("keeps unknown and one-to-many mappings explicit", () => {
		expect(mappingStatus(0)).toBe("unmapped");
		expect(mappingStatus(1)).toBe("one_product_org");
		expect(mappingStatus(2)).toBe("multiple_product_orgs");
		expect(chunks([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
		expect(() => chunks([1], 0)).toThrow();
	});
});
