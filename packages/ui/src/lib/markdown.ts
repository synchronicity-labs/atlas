const standaloneUrlBlock =
	/```[^\r\n]*\r?\n[ \t]*(https?:\/\/[^\s`]+)[ \t]*\r?\n```/gi;
const inlineUrlCode = /`(https?:\/\/[^\s`]+)`/gi;

export function linkifyMarkdownUrls(markdown: string): string {
	return markdown
		.replace(standaloneUrlBlock, "<$1>")
		.replace(inlineUrlCode, "<$1>");
}
