/** Strict support for World Bank's separated metric/year/scale/value layout. */
export interface WorldBankGdpEvidenceRow {
  value: number;
  period: string;
  unit: string;
  entity?: string;
  evidence: string;
}

const NUMBER = '[+-]?\\d+(?:,\\d{3})*(?:\\.\\d+)?';
const UNITS: Record<string, string> = {
  trillion: '万亿美元',
  billion: '十亿美元',
  million: '百万美元',
};
const ENTITY_GROUPS = [
  ['美国', 'United States', 'United States of America', 'USA'],
  ['中国', 'China', 'CHN'],
  ['世界', '全球', 'World', 'WLD'],
  ['厄瓜多尔', 'Ecuador'],
  ['日本', 'Japan', 'JPN'],
  ['韩国', 'South Korea', 'Korea, Rep.', 'KOR'],
  ['印度', 'India', 'IND'],
  ['德国', 'Germany', 'DEU'],
  ['法国', 'France', 'FRA'],
  ['英国', 'United Kingdom', 'GBR'],
  ['南非', 'South Africa', 'ZAF'],
];

export function normalizeWorldBankEntity(value: string): string {
  const normalized = value.trim().toLowerCase();
  return ENTITY_GROUPS.find((group) => group.some((name) => name.toLowerCase() === normalized))?.[0] ?? value.trim();
}

export function sameWorldBankEntity(left: string, right: string): boolean {
  return normalizeWorldBankEntity(left).toLowerCase() === normalizeWorldBankEntity(right).toLowerCase();
}

export function parseWorldBankGdpEvidence(
  evidence: string,
  document = evidence,
): WorldBankGdpEvidenceRow[] {
  const rows: WorldBankGdpEvidenceRow[] = [];
  // A bare card value needs the country page's own heading, not the query country.
  const pageEntity = document.match(/^#\s+([^\r\n|]+?)\s*$/m)?.[1]?.trim();
  const singleEntity = pageEntity && !/Data for|GDP|[,，]/i.test(pageEntity) ? pageEntity : undefined;
  const card = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]+)?GDP[ \t]*\(current US\$\)[ \t]*\r?\n\s*Most recent value\s*\r?\n\s*\(([12]\d{3})[ \t]+(trillion|billion|million)\)\s*\r?\n[ \t]*([^\r\n]+)/gi;
  for (const match of evidence.matchAll(card)) {
    const values = match[3].trim();
    const quote = match[0].replace(/^\n/, '').trim();
    if (new RegExp(`^${NUMBER}$`).test(values)) {
      rows.push({value: Number(values.replace(/,/g, '')), period: match[1], unit: UNITS[match[2].toLowerCase()], entity: singleEntity, evidence: quote});
      continue;
    }
    // Parse country/value pairs independently; never bind China's number to the US.
    const pairs = [...values.matchAll(new RegExp(`([A-Za-z][A-Za-z .,'’()-]*?|[\\u4e00-\\u9fff]+)[ \\t]+(${NUMBER})(?=[ \\t]|$)`, 'g'))];
    if (!pairs.length || pairs.map((pair) => pair[0]).join(' ').replace(/\s+/g, ' ') !== values.replace(/\s+/g, ' ')) continue;
    for (const pair of pairs)
      rows.push({value: Number(pair[2].replace(/,/g, '')), period: match[1], unit: UNITS[match[2].toLowerCase()], entity: pair[1].trim(), evidence: quote});
  }

  // Country tables must quote the nominal-USD metric as well as the exact header.
  const table = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]+)?GDP[ \t]*\(current US\$\)(?:[ \t]+-[^\r\n]+)?[ \t]*\r?\n\s*Country[ \t]+Most Recent Year[ \t]+Most Recent Value[ \t]+\((Millions|Billions|Trillions)\)[ \t]*\r?\n((?:[ \t]*\r?\n|[^\r\n]+\r?\n?)+)/gi;
  for (const match of evidence.matchAll(table)) {
    const header = match[0].slice(0, match[0].length - match[2].length).replace(/^\n/, '');
    let preceding = '';
    for (const line of match[2].split(/\r?\n/)) {
      preceding += line + '\n';
      if (!line.trim()) continue;
      const row = line.match(new RegExp(`^[ \\t]*([A-Za-z][A-Za-z .,'’()-]*?|[\\u4e00-\\u9fff]+)[ \\t]+([12]\\d{3})[ \\t]+(${NUMBER})[ \\t]*$`));
      if (!row) break;
      rows.push({entity: row[1].trim(), period: row[2], value: Number(row[3].replace(/,/g, '')), unit: UNITS[match[1].toLowerCase().replace(/s$/, '')], evidence: (header + preceding).trim()});
    }
  }
  return rows.filter((row) => Number.isFinite(row.value));
}
