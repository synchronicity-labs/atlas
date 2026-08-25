import {
	GoogleServiceAccountClient,
	googleServiceAccount,
} from "@crm/db/google-service-account";
import type { CatalogSheet } from "./metric-catalog.parser";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

type SpreadsheetMetadata = {
	spreadsheetId?: string;
	properties?: { title?: string; timeZone?: string };
	sheets?: Array<{
		properties?: {
			sheetId?: number;
			title?: string;
			index?: number;
		};
	}>;
};

type SpreadsheetValues = {
	values?: unknown[][];
};

export type CatalogWorkbook = {
	id: string;
	title: string;
	timeZone: string | null;
	sheets: CatalogSheet[];
};

export class MetricCatalogClient {
	private readonly google = new GoogleServiceAccountClient(
		googleServiceAccount(),
	);

	async workbook(spreadsheetId: string): Promise<CatalogWorkbook> {
		const token = await this.google.accessToken([SHEETS_SCOPE]);
		const metadata = await this.get<SpreadsheetMetadata>(
			`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?includeGridData=false`,
			token,
		);
		const sheets = await Promise.all(
			(metadata.sheets ?? []).flatMap((sheet) => {
				const id = sheet.properties?.sheetId;
				const title = sheet.properties?.title;
				const index = sheet.properties?.index;
				if (id === undefined || !title || index === undefined) return [];
				return [this.sheet(spreadsheetId, token, { id, title, index })];
			}),
		);

		return {
			id: metadata.spreadsheetId ?? spreadsheetId,
			title: metadata.properties?.title ?? "KPI workbook",
			timeZone: metadata.properties?.timeZone ?? null,
			sheets: sheets.sort((left, right) => left.index - right.index),
		};
	}

	private async sheet(
		spreadsheetId: string,
		token: string,
		properties: { id: number; title: string; index: number },
	): Promise<CatalogSheet> {
		const escaped = properties.title.replaceAll("'", "''");
		const range = `'${escaped}'!A:AE`;
		const result = await this.get<SpreadsheetValues>(
			`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
			token,
		);
		return {
			id: properties.id,
			title: properties.title,
			index: properties.index,
			rows: result.values ?? [],
		};
	}

	private async get<T>(url: string, token: string): Promise<T> {
		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!response.ok) {
			throw new Error(`Google Sheets request failed (${response.status}).`);
		}
		return (await response.json()) as T;
	}
}
