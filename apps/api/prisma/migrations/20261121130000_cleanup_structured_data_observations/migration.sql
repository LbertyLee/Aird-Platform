WITH ranked AS (
  SELECT
    observation.id,
    ROW_NUMBER() OVER (
      PARTITION BY
        observation.record_id,
        lower(COALESCE(
          NULLIF(observation.indicator_english, ''),
          observation.raw_data->>'indicatorCode',
          observation.raw_data->>'catalogIndicatorCode',
          observation.raw_data->>'code',
          observation.indicator_chinese,
          ''
        )),
        lower(CASE btrim(COALESCE(observation.region, ''))
          WHEN '上海' THEN '上海市'
          ELSE btrim(COALESCE(observation.region, ''))
        END),
        observation.start_time,
        observation.end_time,
        lower(COALESCE(observation.time_indicator_type, '')),
        lower(COALESCE(observation.unit, '')),
        lower(COALESCE(observation.source_organization, '')),
        lower(COALESCE(observation.source_project, ''))
      ORDER BY
        CASE WHEN btrim(COALESCE(observation.region, '')) = '上海市' THEN 0 ELSE 1 END,
        CASE WHEN NULLIF(observation.indicator_chinese, '') IS NOT NULL THEN 0 ELSE 1 END,
        observation.created_at,
        observation.id
    ) AS duplicate_rank
  FROM structured_data_observations AS observation
)
DELETE FROM structured_data_observations AS observation
USING ranked
WHERE observation.id = ranked.id
  AND ranked.duplicate_rank > 1;

UPDATE structured_data_observations AS observation
SET
  region = CASE btrim(COALESCE(observation.region, ''))
    WHEN '上海' THEN '上海市'
    ELSE NULLIF(btrim(COALESCE(observation.region, '')), '')
  END,
  indicator_chinese = COALESCE(
    NULLIF(observation.indicator_chinese, ''),
    indicator.name
  ),
  dedupe_key = CASE
    WHEN observation.indicator_english IS NOT NULL
      AND NULLIF(btrim(COALESCE(observation.region, '')), '') IS NOT NULL
    THEN md5(
      lower(observation.indicator_english) || chr(31) ||
      lower(CASE btrim(COALESCE(observation.region, ''))
        WHEN '上海' THEN '上海市'
        ELSE btrim(COALESCE(observation.region, ''))
      END) || chr(31) ||
      COALESCE(observation.start_time::text, '') || chr(31) ||
      COALESCE(observation.end_time::text, '') || chr(31) ||
      lower(COALESCE(observation.time_indicator_type, '')) || chr(31) ||
      lower(COALESCE(observation.unit, '')) || chr(31) ||
      lower(COALESCE(observation.source_organization, '')) || chr(31) ||
      lower(COALESCE(observation.source_project, ''))
    )
    ELSE md5(
      'row' || chr(31) || observation.record_id || chr(31) ||
      observation.row_index::text
    )
  END
FROM indicators AS indicator
WHERE indicator.code = observation.indicator_english
  AND indicator.deleted_at IS NULL;

UPDATE structured_data_observations AS observation
SET
  region = CASE btrim(COALESCE(observation.region, ''))
    WHEN '上海' THEN '上海市'
    ELSE NULLIF(btrim(COALESCE(observation.region, '')), '')
  END,
  dedupe_key = CASE
    WHEN observation.indicator_english IS NOT NULL
      AND NULLIF(btrim(COALESCE(observation.region, '')), '') IS NOT NULL
    THEN md5(
      lower(observation.indicator_english) || chr(31) ||
      lower(CASE btrim(COALESCE(observation.region, ''))
        WHEN '上海' THEN '上海市'
        ELSE btrim(COALESCE(observation.region, ''))
      END) || chr(31) ||
      COALESCE(observation.start_time::text, '') || chr(31) ||
      COALESCE(observation.end_time::text, '') || chr(31) ||
      lower(COALESCE(observation.time_indicator_type, '')) || chr(31) ||
      lower(COALESCE(observation.unit, '')) || chr(31) ||
      lower(COALESCE(observation.source_organization, '')) || chr(31) ||
      lower(COALESCE(observation.source_project, ''))
    )
    ELSE md5(
      'row' || chr(31) || observation.record_id || chr(31) ||
      observation.row_index::text
    )
  END
WHERE observation.region = '上海'
   OR observation.region IS NULL
   OR btrim(observation.region) = '';
