export function sourceErrorSummary(error: string | null): string | null {
	if (!error) return null;
	const questionFailures =
		/^(\d+) question\(s\) failed in the refresh cycle\.$/.exec(error);
	if (questionFailures)
		return `${questionFailures[1]} question(s) failed; the refresh job finished but the source is not ready.`;
	if (/timeout|timed out|deadline exceeded/i.test(error))
		return "Source request timed out.";
	if (/rate.?limit|too many requests|\b429\b/i.test(error))
		return "Source rate limit reached.";
	if (/unauthori[sz]ed|forbidden|permission|\b40[13]\b/i.test(error))
		return "Source authentication or permission failed.";
	if (/not configured|not set|missing.*credential/i.test(error))
		return "Source configuration is missing.";
	if (/\bHTTP\s+5\d\d\b/i.test(error)) return "Source returned a server error.";
	return "Source refresh failed. Inspect the protected source diagnostics for details.";
}
