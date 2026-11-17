/** Translate display labels only; identifiers, units, values and citations remain stable. */
const LABEL_FIELDS = new Set([
  'title',
  'name',
  'indicatorName',
  'indicator',
  'indicator_name',
  'metric',
  'entity',
  'country',
  'countryName',
  'region',
  'regionName',
  'organization',
  'institution',
  'industry',
  'source',
  '__source',
  '国家',
  '地区',
  '机构',
  '行业',
  '指标',
  '指标名称',
]);
const LABEL_ARRAYS = new Set(['entities', 'indicatorNames']);

export function collectDisplayNames(value: unknown): string[] {
  const names = new Set<string>();
  visit(value, (text) => {
    if (/[a-z]/i.test(text)) names.add(text);
    return text;
  });
  return [...names];
}

export function localizeDisplayNames<T>(
  value: T,
  translations: Record<string, string>,
): T {
  return visit(value, (text) =>
    Object.prototype.hasOwnProperty.call(translations, text)
      ? translations[text]
      : text,
  ) as T;
}

function visit(value: unknown, translate: (text: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => visit(item, translate));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      LABEL_FIELDS.has(key) && typeof item === 'string'
        ? translate(item)
        : LABEL_ARRAYS.has(key) && Array.isArray(item)
          ? item.map((label) =>
              typeof label === 'string'
                ? translate(label)
                : visit(label, translate),
            )
          : visit(item, translate),
    ]),
  );
}
