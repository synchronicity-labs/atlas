const CORPORATE_SUFFIXES = new Set([
	"bv",
	"corp",
	"corporation",
	"gmbh",
	"inc",
	"incorporated",
	"limited",
	"llc",
	"llp",
	"ltd",
	"plc",
	"private",
	"pvt",
]);

const DESCRIPTIVE_SUFFIXES = new Set([
	"media",
	"production",
	"productions",
	"studio",
	"studios",
	"team",
]);

export function contractCustomerAliases(
	folderName: string,
	legalName?: string | null,
): string[] {
	const parenthetical = [...folderName.matchAll(/\(([^)]+)\)/g)].flatMap(
		(match) => (match[1] ? [match[1]] : []),
	);
	const outside = folderName.replace(/\s*\([^)]+\)\s*/g, " ").trim();
	const pieces = [outside, ...outside.split(/\s+-\s+/), ...parenthetical];
	if (legalName) pieces.push(legalName);

	const aliases = new Set<string>();
	for (const piece of pieces) {
		const cleaned = stripCorporateSuffix(piece);
		if (canonicalContractName(cleaned).length >= 3) aliases.add(cleaned);
		if (/\s+ai$/i.test(cleaned)) {
			const withoutAi = cleaned.replace(/\s+ai$/i, "").trim();
			if (canonicalContractName(withoutAi).length >= 3) aliases.add(withoutAi);
		}
	}
	return [...aliases];
}

export function canonicalContractName(value: string): string {
	return value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

export function contractNameMatch(
	aliases: readonly string[],
	candidate: string | null,
): { confidence: number; matchedAlias: string } | null {
	if (!candidate) return null;
	const candidateCanonical = canonicalContractName(
		stripCorporateSuffix(candidate),
	);
	const candidateVariants = nameVariants(candidateCanonical);
	let best: { confidence: number; matchedAlias: string } | null = null;

	for (const alias of aliases) {
		const aliasCanonical = canonicalContractName(alias);
		if (!aliasCanonical) continue;
		let confidence = 0;
		if (candidateCanonical === aliasCanonical) {
			confidence =
				canonicalContractName(candidate) === canonicalContractName(alias)
					? 0.98
					: 0.94;
		} else {
			const aliasVariants = nameVariants(aliasCanonical);
			if (
				[...aliasVariants].some((variant) => candidateVariants.has(variant))
			) {
				confidence = 0.88;
			}
		}
		if (confidence > (best?.confidence ?? 0)) {
			best = { confidence, matchedAlias: alias };
		}
	}
	return best;
}

export function contractSearchTerms(aliases: readonly string[]): string[] {
	return [
		...new Set(
			aliases.flatMap((alias) => {
				const canonical = canonicalContractName(alias);
				const first = canonical.split(" ")[0] ?? "";
				return [alias, first.length >= 4 ? first : ""].filter(
					(value) => canonicalContractName(value).length >= 3,
				);
			}),
		),
	];
}

export function contractDomainMatch(
	aliases: readonly string[],
	domain: string | null,
): { confidence: number; matchedAlias: string } | null {
	if (!domain) return null;
	const labels = domain.toLowerCase().split(".").filter(Boolean);
	if (labels.length < 2) return null;
	const domainName = canonicalContractName(labels.at(-2) ?? "").replaceAll(
		" ",
		"",
	);
	if (!domainName) return null;

	for (const alias of aliases) {
		const aliasVariants = nameVariants(canonicalContractName(alias));
		if (
			[...aliasVariants].some(
				(variant) => variant.replaceAll(" ", "") === domainName,
			)
		) {
			return { confidence: 0.995, matchedAlias: alias };
		}
	}

	return null;
}

function stripCorporateSuffix(value: string): string {
	const words = value
		.trim()
		.replace(/[.,]+$/g, "")
		.split(/\s+/);
	while (
		words.length > 1 &&
		CORPORATE_SUFFIXES.has(
			canonicalContractName(words[words.length - 1] ?? "").replaceAll(" ", ""),
		)
	) {
		words.pop();
	}
	return words.join(" ");
}

function nameVariants(value: string): Set<string> {
	const words = value.split(" ").filter(Boolean);
	const variants = new Set([value]);
	if (words.length > 1 && words[words.length - 1] === "ai") {
		variants.add(words.slice(0, -1).join(" "));
	}
	if (
		words.length > 1 &&
		DESCRIPTIVE_SUFFIXES.has(words[words.length - 1] ?? "")
	) {
		variants.add(words.slice(0, -1).join(" "));
	}
	return variants;
}
