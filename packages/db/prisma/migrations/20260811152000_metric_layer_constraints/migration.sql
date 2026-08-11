ALTER TABLE "syncRun"
ADD CONSTRAINT "syncRun_attempt_check" CHECK ("attempt" >= 1);

ALTER TABLE "ingestion"."dataset"
ADD CONSTRAINT "dataset_cadenceMinutes_check" CHECK ("cadenceMinutes" > 0),
ADD CONSTRAINT "dataset_freshnessSlaMinutes_check" CHECK ("freshnessSlaMinutes" >= 0),
ADD CONSTRAINT "dataset_backfillWindowDays_check" CHECK ("backfillWindowDays" IS NULL OR "backfillWindowDays" >= 0);

ALTER TABLE "core"."normalizedFact"
ADD CONSTRAINT "normalizedFact_period_check" CHECK ("periodEnd" > "periodStart");

ALTER TABLE "metrics"."metricInput"
ADD CONSTRAINT "metricInput_maxLagSeconds_check" CHECK ("maxLagSeconds" >= 0);

ALTER TABLE "metrics"."metricRun"
ADD CONSTRAINT "metricRun_period_check" CHECK ("periodEnd" > "periodStart"),
ADD CONSTRAINT "metricRun_dataThrough_check" CHECK ("dataThrough" IS NULL OR "dataThrough" <= "periodEnd"),
ADD CONSTRAINT "metricRun_rowCount_check" CHECK ("rowCount" >= 0);

ALTER TABLE "metrics"."metricSnapshot"
ADD CONSTRAINT "metricSnapshot_period_check" CHECK ("periodEnd" > "periodStart"),
ADD CONSTRAINT "metricSnapshot_dataThrough_check" CHECK ("dataThrough" <= "periodEnd"),
ADD CONSTRAINT "metricSnapshot_rowCount_check" CHECK ("rowCount" >= 0);
