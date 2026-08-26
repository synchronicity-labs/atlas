import { timingSafeEqual } from "node:crypto";

export function validGbrainEvidenceAuthorization(
	secret: string,
	authorization: string | undefined,
): boolean {
	const actual = Buffer.from(authorization ?? "");
	const expected = Buffer.from(`Bearer ${secret}`);
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}
