UPDATE "revenueDoorPolicy"
SET
  "status" = 'COMPLETE',
  "notes" = 'Seven channel partners were reconciled on 2026-08-21 against the partner register, Atlas Product organizations, Stripe subscriptions, and Stripe invoices. Replicate, MagicHour, Runware, and Adapt Global source-record conflicts are resolved. Fal wire payments remain represented by Stripe invoices, so they do not block revenue-door classification.',
  "reviewedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'company-revenue-doors';

-- A Product plan label is not a contract registry. Enforce the reconciled
-- organization and Stripe mappings below so old or test partner-plan accounts
-- do not enter contract revenue by accident.
UPDATE "revenueDoorRule"
SET
  "active" = false,
  "evidence" = coalesce("evidence", '{}'::jsonb) || '{"classificationRole":"discovery evidence only; explicit Product organization and Stripe customer rules are enforced"}'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "policyId" = 'company-revenue-doors'
  AND "door" = 'PARTNERS'
  AND "matchKind" = 'PLAN';

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
  ('revenue-rule-domain-fal', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'fal.ai', 'Fal', false, '{"source":"Sanjit partner register","commercialModel":"usage only with a 20% discount","mappingStatus":"reconciled","classificationRole":"discovery evidence only; explicit Product organization and Stripe customer rules are enforced","billingNote":"Stripe invoices remain the billing record when payment is received by wire"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-higgsfield', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'higgsfield.ai', 'Higgsfield', false, '{"source":"Sanjit partner register","commercialModel":"usage only with custom pricing and an invoice threshold","mappingStatus":"reconciled","classificationRole":"discovery evidence only; explicit Product organization and Stripe customer rules are enforced"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-higgsfield-com', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'higgsfield.com', 'Higgsfield', false, '{"source":"Sanjit partner register","commercialModel":"usage only with custom pricing and an invoice threshold","mappingStatus":"reconciled","classificationRole":"discovery evidence only; explicit Product organization and Stripe customer rules are enforced"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-replicate', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'replicate.com', 'Replicate', false, '{"source":"Sanjit partner register plus Atlas Product and Stripe reconciliation","commercialModel":"usage only with custom discounts","mappingStatus":"reconciled","classificationRole":"discovery evidence only; explicit Product organization and Stripe customer rules are enforced","correction":"The register contained Higgsfield Stripe IDs"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-magichour', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'magichour.ai', 'MagicHour', false, '{"source":"Sanjit partner register plus Atlas Product and Stripe reconciliation","commercialModel":"usage only with custom discounts","mappingStatus":"reconciled","classificationRole":"discovery evidence only; explicit Product organization and Stripe customer rules are enforced","correction":"The register contained Runware Product organization ID"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-adaptglobal', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'adaptglobal.io', 'Adapt Global', false, '{"source":"Sanjit partner register plus Atlas Product and Stripe reconciliation","commercialModel":"monthly minimum plus usage","mappingStatus":"reconciled","classificationRole":"discovery evidence only; explicit Product organization and Stripe customer rules are enforced","correction":"Atlas resolved the missing Product organization from the Stripe customer and member domain"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-runware', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'runware.ai', 'Runware', false, '{"source":"Sanjit partner register plus Atlas Product and Stripe reconciliation","commercialModel":"metered usage with a 20% discount","mappingStatus":"reconciled","classificationRole":"discovery evidence only; explicit Product organization and Stripe customer rules are enforced","correction":"Atlas separated Runware from MagicHour"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-segmind', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'segmind.com', 'Segmind', false, '{"source":"Sanjit partner register","commercialModel":"Creator plan","mappingStatus":"reconciled","classificationRole":"discovery evidence only; explicit Product organization and Stripe customer rules are enforced"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-org-fal-primary', 'company-revenue-doors', 'PARTNERS', 'ORGANIZATION_ID', '896f3498-a14f-4926-af5a-c411d6b7b45b', 'Fal', true, '{"source":"Atlas Product organization and Stripe invoice reconciliation","stripeCustomerId":"cus_UFEx8IMuca1c8Q","subscriptionId":"sub_1TGlNKEkITKs7CbVFtAdgIHM"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-org-higgsfield-primary', 'company-revenue-doors', 'PARTNERS', 'ORGANIZATION_ID', 'f53205dd-3c9a-4bce-9527-f8354e055ca4', 'Higgsfield', true, '{"source":"Atlas Product organization and Stripe invoice reconciliation","stripeCustomerId":"cus_SyWP4tfa2kRMpf","subscriptionId":"sub_1S2ZMaEkITKs7CbVyS5muZRE"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-org-replicate-primary', 'company-revenue-doors', 'PARTNERS', 'ORGANIZATION_ID', '700e8b88-e549-4823-a3c8-c10775530b22', 'Replicate', true, '{"source":"Atlas Product organization and Stripe invoice reconciliation","stripeCustomerId":"cus_SgMT7A2kunjI6H","subscriptionId":"sub_1RkzlGEkITKs7CbV0dk7JtGv"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-org-replicate-secondary', 'company-revenue-doors', 'PARTNERS', 'ORGANIZATION_ID', 'f81a9433-d5c0-4e36-a399-49859c8b5d7d', 'Replicate', true, '{"source":"Atlas Product organization member-domain reconciliation","stripeCustomerId":"cus_UG5gUsKrW41Cfu","billingNote":"No 2026 Stripe invoices or active subscription; retained for Product usage classification"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-org-magichour-primary', 'company-revenue-doors', 'PARTNERS', 'ORGANIZATION_ID', '6608b82f-ddeb-4401-8e26-7f26eac2feee', 'MagicHour', true, '{"source":"Atlas Product organization and Stripe invoice reconciliation","stripeCustomerId":"cus_T2i9OeKuVG37xM","subscriptionId":"sub_1S6cjHEkITKs7CbVV0Y0E4cs"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-org-adaptglobal-primary', 'company-revenue-doors', 'PARTNERS', 'ORGANIZATION_ID', '05a1d7e6-380e-454f-b153-e055ec95e825', 'Adapt Global', true, '{"source":"Atlas Product organization and Stripe invoice reconciliation","stripeCustomerId":"cus_SD1nN37bOhE2Rf","subscriptionId":"sub_1RTlqlEkITKs7CbVPa7CEtaf"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-org-runware-primary', 'company-revenue-doors', 'PARTNERS', 'ORGANIZATION_ID', '9a5df4fa-2d8f-4e56-80bd-64dcfab677a2', 'Runware', true, '{"source":"Atlas Product organization and Stripe invoice reconciliation","stripeCustomerId":"cus_TZclGHaR8R3XDY","subscriptionId":"sub_1ScTYEEkITKs7CbVfbH8MHAX"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-org-segmind-primary', 'company-revenue-doors', 'PARTNERS', 'ORGANIZATION_ID', '6850f5f1-3c35-491e-a94a-5a6ee727b743', 'Segmind', true, '{"source":"Atlas Product organization and Stripe invoice reconciliation","stripeCustomerId":"cus_T18sGK87fqNMbI","subscriptionId":"sub_1S56asEkITKs7CbVRCdYnsDy"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-customer-fal-primary', 'company-revenue-doors', 'PARTNERS', 'STRIPE_CUSTOMER_ID', 'cus_UFEx8IMuca1c8Q', 'Fal', true, '{"source":"Sanjit partner register and Stripe invoice reconciliation"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-customer-higgsfield-primary', 'company-revenue-doors', 'PARTNERS', 'STRIPE_CUSTOMER_ID', 'cus_SyWP4tfa2kRMpf', 'Higgsfield', true, '{"source":"Sanjit partner register and Stripe invoice reconciliation"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-customer-replicate-primary', 'company-revenue-doors', 'PARTNERS', 'STRIPE_CUSTOMER_ID', 'cus_SgMT7A2kunjI6H', 'Replicate', true, '{"source":"Atlas Product organization and Stripe invoice reconciliation","correction":"Replaces Higgsfield customer copied into the partner register"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-customer-replicate-secondary', 'company-revenue-doors', 'PARTNERS', 'STRIPE_CUSTOMER_ID', 'cus_UG5gUsKrW41Cfu', 'Replicate', true, '{"source":"Atlas Product organization reconciliation","billingNote":"No 2026 invoices or active subscription"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-customer-magichour-primary', 'company-revenue-doors', 'PARTNERS', 'STRIPE_CUSTOMER_ID', 'cus_T2i9OeKuVG37xM', 'MagicHour', true, '{"source":"Sanjit partner register and Stripe invoice reconciliation"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-customer-adaptglobal-primary', 'company-revenue-doors', 'PARTNERS', 'STRIPE_CUSTOMER_ID', 'cus_SD1nN37bOhE2Rf', 'Adapt Global', true, '{"source":"Sanjit partner register and Stripe invoice reconciliation"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-customer-runware-primary', 'company-revenue-doors', 'PARTNERS', 'STRIPE_CUSTOMER_ID', 'cus_TZclGHaR8R3XDY', 'Runware', true, '{"source":"Sanjit partner register and Stripe invoice reconciliation"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-customer-segmind-primary', 'company-revenue-doors', 'PARTNERS', 'STRIPE_CUSTOMER_ID', 'cus_T18sGK87fqNMbI', 'Segmind', true, '{"source":"Sanjit partner register and Stripe invoice reconciliation"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("policyId", "matchKind", "matchValue") DO UPDATE
SET
  "door" = EXCLUDED."door",
  "label" = EXCLUDED."label",
  "active" = EXCLUDED."active",
  "evidence" = EXCLUDED."evidence",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "question"
SET
  "description" = replace(
    replace("description", ' The channel-partner list is still being completed.', ''),
    ' The partner list is still being completed.', ''
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "description" LIKE '%still being completed%';

UPDATE "metrics"."metricDefinition"
SET
  "description" = replace(
    replace("description", ' The channel-partner list is still being completed.', ''),
    ' The partner list is still being completed.', ''
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "description" LIKE '%still being completed%';
