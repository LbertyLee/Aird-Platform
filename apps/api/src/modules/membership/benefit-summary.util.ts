/**
 * 将权益 JSON 格式化为可读摘要文案。
 */
const BENEFIT_LABEL: Record<string, string> = {
  search_quota: '检索次数',
  export_quota: '导出次数',
  max_agents: 'Agent 数量',
  storage_bytes: '存储容量',
};

const BYTES_PER_G = 1024 ** 3;

/**
 * 格式化单个权益值。
 */
function formatOne(code: string, raw: unknown): string {
  const label = BENEFIT_LABEL[code] ?? code;
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if ('bytes' in obj || code === 'storage_bytes') {
      const bytes = Number(obj.bytes ?? 0);
      const g = Math.round((bytes / BYTES_PER_G) * 100) / 100;
      return `${label} ${g}G`;
    }
    if ('enabled' in obj) {
      return `${label} ${obj.enabled ? '开' : '关'}`;
    }
    if ('n' in obj) {
      return `${label} ${obj.n ?? 0}`;
    }
  }
  return `${label} ${String(raw ?? '-')}`;
}

/**
 * 将权益列表格式化为「·」分隔摘要。
 */
export function formatBenefitsSummary(
  benefits: Array<{ benefitCode: string; valueJson: unknown }>,
): string {
  if (!benefits?.length) return '-';
  return benefits
    .map((b) => formatOne(b.benefitCode, b.valueJson))
    .join(' · ');
}

/**
 * 将合并后的权益字典格式化为摘要。
 */
export function formatValuesSummary(values: Record<string, unknown>): string {
  const codes = Object.keys(values);
  if (!codes.length) return '-';
  return codes.map((code) => formatOne(code, values[code])).join(' · ');
}
