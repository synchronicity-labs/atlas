UPDATE "revenueDoorPolicy"
SET
  "status" = 'COMPLETE',
  "notes" = 'Partner list reviewed from Sanjit channel-partner register on 2026-08-20. A run is complete only when every listed domain resolves to a live Product organization. Three source-record mapping exceptions remain documented in rule evidence.',
  "reviewedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'company-revenue-doors';

INSERT INTO "revenueDoorRule" (
  "id",
  "policyId",
  "door",
  "matchKind",
  "matchValue",
  "label",
  "active",
  "evidence",
  "createdAt",
  "updatedAt"
) VALUES
  ('revenue-rule-domain-fal', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'fal.ai', 'Fal', true, '{"source":"Sanjit channel-partner register","commercialModel":"usage only, 20% discount"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-higgsfield', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'higgsfield.ai', 'Higgsfield', true, '{"source":"Sanjit channel-partner register","commercialModel":"usage only, custom pricing and threshold"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-higgsfield-com', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'higgsfield.com', 'Higgsfield', true, '{"source":"Sanjit channel-partner register","commercialModel":"usage only, custom pricing and threshold"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-replicate', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'replicate.com', 'Replicate', true, '{"source":"Sanjit channel-partner register","commercialModel":"usage only, 20% discount","mappingReview":"billing mapping repeats Higgsfield in the source register"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-magichour', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'magichour.ai', 'MagicHour', true, '{"source":"Sanjit channel-partner register","commercialModel":"usage only, discount terms","mappingReview":"Product organization mapping is also listed for Runware"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-adaptglobal', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'adaptglobal.io', 'Adapt Global', true, '{"source":"Sanjit channel-partner register","commercialModel":"monthly minimum plus usage","mappingReview":"Product organization mapping is missing in the source register"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-runware', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'runware.ai', 'Runware', true, '{"source":"Sanjit channel-partner register","commercialModel":"usage discount","mappingReview":"Product organization mapping is also listed for MagicHour"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-segmind', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'segmind.com', 'Segmind', true, '{"source":"Sanjit channel-partner register","commercialModel":"Creator plan"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("policyId", "matchKind", "matchValue") DO UPDATE
SET
  "door" = EXCLUDED."door",
  "label" = EXCLUDED."label",
  "active" = EXCLUDED."active",
  "evidence" = EXCLUDED."evidence",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "question"
SET
  "description" = 'Monthly accrued usage for organizations resolved through the governed channel-partner registry. The current month is month to date.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "sourceExternalId" = 'weekly-revenue:partner-usage-history';

UPDATE "metrics"."metricDefinition"
SET
  "description" = 'Monthly accrued usage for organizations resolved through the governed channel-partner registry. The current month is month to date.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'company.partner_usage_history';
