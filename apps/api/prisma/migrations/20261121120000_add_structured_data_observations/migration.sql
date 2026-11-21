CREATE TABLE "structured_data_observations" (
    "id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "namespace" VARCHAR(32) NOT NULL,
    "indicator_english" TEXT,
    "indicator_chinese" TEXT,
    "source_organization" TEXT,
    "source_project" TEXT,
    "region" TEXT,
    "region_type" TEXT,
    "parent_region" TEXT,
    "start_time" INTEGER,
    "end_time" INTEGER,
    "time_indicator_type" TEXT,
    "data_value" JSONB,
    "unit" TEXT,
    "source_url" TEXT,
    "published_at" TEXT,
    "indicator_explanation" TEXT,
    "input_by" TEXT,
    "input_at" TIMESTAMP(3),
    "is_public" BOOLEAN,
    "data_owner" TEXT,
    "last_modified_by" TEXT,
    "last_modified_at" TIMESTAMP(3),
    "annotations" JSONB,
    "raw_data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "structured_data_observations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "structured_data_observations_record_id_fkey"
      FOREIGN KEY ("record_id") REFERENCES "structured_data_records"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "structured_data_observations_record_id_row_index_key"
    ON "structured_data_observations"("record_id", "row_index");
CREATE INDEX "structured_data_observations_namespace_created_at_idx"
    ON "structured_data_observations"("namespace", "created_at");
CREATE INDEX "structured_data_observations_indicator_english_region_start_time_idx"
    ON "structured_data_observations"("indicator_english", "region", "start_time");

WITH records AS (
  SELECT id, namespace, data,
    CASE
      WHEN jsonb_typeof(data) = 'array' THEN data
      WHEN jsonb_typeof(data->'rows') = 'array' THEN data->'rows'
      WHEN jsonb_typeof(data->'items') = 'array' THEN data->'items'
      WHEN jsonb_typeof(data->'observations') = 'array' THEN data->'observations'
      WHEN jsonb_typeof(data->'structuredData') = 'array' THEN data->'structuredData'
      WHEN jsonb_typeof(data->'data') = 'array' THEN data->'data'
      WHEN jsonb_typeof(data) = 'object' THEN jsonb_build_array(data)
      ELSE '[]'::jsonb
    END AS rows
  FROM structured_data_records
), observations AS (
  SELECT r.id AS record_id, r.namespace, item.value AS raw_data,
         (item.ordinality - 1)::integer AS row_index
  FROM records r
  CROSS JOIN LATERAL jsonb_array_elements(r.rows) WITH ORDINALITY AS item(value, ordinality)
  WHERE jsonb_typeof(item.value) = 'object'
    AND item.value ?| ARRAY[
      'indicatorEnglish', 'indicatorChinese', 'indicatorNameZh', 'indicatorCode', 'indicator',
      'dataValue', 'value', 'region', 'country', 'entity', 'year', 'Year',
      '国别地区', '数据值'
    ]
), mapped AS (
  SELECT *,
    COALESCE(raw_data->>'startTime', raw_data->>'startYear', raw_data->>'year', raw_data->>'Year') AS start_text,
    COALESCE(raw_data->>'endTime', raw_data->>'endYear', raw_data->>'year', raw_data->>'Year') AS end_text
  FROM observations
)
INSERT INTO structured_data_observations (
  id, record_id, row_index, namespace, indicator_english, indicator_chinese,
  source_organization, source_project, region, region_type, parent_region,
  start_time, end_time, time_indicator_type, data_value, unit, source_url,
  published_at, indicator_explanation, input_by, input_at, is_public,
  data_owner, last_modified_by, last_modified_at, annotations, raw_data,
  created_at, updated_at
)
SELECT
  'backfill-' || record_id || '-' || row_index, record_id, row_index, namespace,
  COALESCE(raw_data->>'indicatorEnglish', raw_data->>'indicatorCode', raw_data->>'indicator', raw_data->>'code'),
  COALESCE(raw_data->>'indicatorChinese', raw_data->>'indicatorNameZh'),
  COALESCE(raw_data->>'sourceOrganization', raw_data->>'dataSourceOrganization', raw_data->>'organization', raw_data->>'source'),
  COALESCE(raw_data->>'sourceProject', raw_data->>'project', raw_data->>'revision'),
  COALESCE(raw_data->>'region', raw_data->>'country', raw_data->>'entity', raw_data->>'地区', raw_data->>'国家'),
  COALESCE(raw_data->>'regionType', raw_data->>'areaType'),
  COALESCE(raw_data->>'parentRegion', raw_data->>'parentArea'),
  CASE WHEN start_text ~ '^-?[0-9]{1,9}$' THEN start_text::integer END,
  CASE WHEN end_text ~ '^-?[0-9]{1,9}$' THEN end_text::integer END,
  COALESCE(raw_data->>'timeIndicatorType', raw_data->>'timeType', raw_data->>'estimateType'),
  COALESCE(raw_data->'dataValue', raw_data->'value'),
  COALESCE(raw_data->>'unit', raw_data->>'数据单位'),
  COALESCE(raw_data->>'sourceUrl', raw_data->>'url'),
  COALESCE(raw_data->>'publishedAt', raw_data->>'sourcePublishedAt', raw_data->>'publicationDate'),
  COALESCE(raw_data->>'indicatorExplanation', raw_data->>'description'),
  COALESCE(raw_data->>'inputBy', raw_data->>'createdBy'),
  NULL,
  CASE WHEN lower(COALESCE(raw_data->>'isPublic', raw_data->>'shared')) IN ('true', 'false')
       THEN lower(COALESCE(raw_data->>'isPublic', raw_data->>'shared'))::boolean END,
  COALESCE(raw_data->>'dataOwner', raw_data->>'owner'),
  COALESCE(raw_data->>'lastModifiedBy', raw_data->>'updatedBy'),
  NULL,
  COALESCE(raw_data->'annotations', raw_data->'otherMetadata', raw_data->'metadata'),
  raw_data, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM mapped;
