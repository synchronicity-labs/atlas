CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "productUser_externalId_trgm_idx"
ON "productUser" USING GIN ("externalId" gin_trgm_ops);

CREATE INDEX "productUser_email_trgm_idx"
ON "productUser" USING GIN ("email" gin_trgm_ops);

CREATE INDEX "productUser_displayName_trgm_idx"
ON "productUser" USING GIN ("displayName" gin_trgm_ops);

CREATE INDEX "productUser_role_trgm_idx"
ON "productUser" USING GIN ("role" gin_trgm_ops);

CREATE INDEX "productUserIdentity_normalizedValue_trgm_idx"
ON "productUserIdentity" USING GIN ("normalizedValue" gin_trgm_ops);

CREATE INDEX "productOrganization_externalId_trgm_idx"
ON "productOrganization" USING GIN ("externalId" gin_trgm_ops);

CREATE INDEX "productOrganization_name_trgm_idx"
ON "productOrganization" USING GIN ("name" gin_trgm_ops);

CREATE INDEX "productOrganization_domain_trgm_idx"
ON "productOrganization" USING GIN ("domain" gin_trgm_ops);

CREATE INDEX "productOrganization_stripeCustomerId_trgm_idx"
ON "productOrganization" USING GIN ("stripeCustomerId" gin_trgm_ops);
