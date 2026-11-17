import { CHINA_REGIONS } from './china-regions';

/** Match names independently of the semantic catalog, including cities without 市. */
export function inferQueryRegions(query: string): string[] {
  const matches: string[] = [];
  for (const province of CHINA_REGIONS) {
    const cities = province.cities.filter((city) =>
      regionNames(city).some((name) => query.includes(name)),
    );
    // A named city is more selective than its province; do not admit the
    // province's other cities just because the user wrote 福建泉州.
    if (cities.length) matches.push(...cities.map(shortRegionName));
    else if (regionNames(province.name).some((name) => query.includes(name))) {
      matches.push(shortRegionName(province.name));
    }
  }
  return [...new Set(matches)];
}

function shortRegionName(name: string): string {
  return name.replace(/(?:特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/, '');
}

function regionNames(name: string): string[] {
  return [...new Set([name, shortRegionName(name)])].filter((term) => term.length >= 2);
}
