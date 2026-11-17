"""Generate yudao-sources-data.ts intl org section from Excel sheet."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_XLSX = Path(
    r"c:\Users\Administrator\Desktop\AI智库数智研究平台AI数据智能汇总.202601014（补充国际）.xlsx"
)
TARGET = ROOT / "apps/api/prisma/data/yudao-sources-data.ts"
INTL_OFFSET = 338 - 17  # replace 17 legacy intl rows with 338 from Excel


def ts_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def format_entry(item: dict) -> str:
    chunks = [f"id: '{item['id']}'", f'name: "{ts_escape(item["name"])}"']
    if item.get("en"):
        chunks.append(f'en: "{ts_escape(item["en"])}"')
    chunks.append(f"category: '{item['category']}'")
    if item.get("region"):
        chunks.append(f'region: "{ts_escape(item["region"])}"')
    if item.get("site"):
        chunks.append(f'site: "{ts_escape(item["site"])}"')
    if item.get("note"):
        chunks.append(f'note: "{ts_escape(item["note"])}"')
    chunks.append(f"status: '{item['status']}'")
    return "  { " + ", ".join(chunks) + " },"


def normalize_url(raw: str) -> str | None:
    raw = (raw or "").strip()
    if not raw or raw.lower() == "nan":
        return None
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw.lstrip("/")
    return raw


def core_note(name: str, url: str | None, field_note: str | None) -> str | None:
    notes: list[str] = []
    if field_note:
        notes.append(field_note)
    if url:
        host = url.lower()
        if "data.worldbank.org" in host or host.rstrip("/").endswith("worldbank.org"):
            if name in ("世界银行", "世界银行数据银行") or "世界银行" in name:
                notes.insert(0, "核心数据源：世界银行（WB）")
        if "imf.org" in host and "国际货币基金" in name:
            notes.insert(0, "核心数据源：国际货币基金组织（IMF）")
        if "unstats.un.org" in host and "联合国统计司" in name:
            notes.insert(0, "核心数据源：联合国（UN）")
        if "oecd.org" in host and name == "OECD":
            notes.insert(0, "核心数据源：OECD")
        if "ec.europa.eu/eurostat" in host or name == "Eurostat":
            notes.insert(0, "核心数据源：欧盟统计局（Eurostat）")
    if not notes:
        return None
    merged: list[str] = []
    for n in notes:
        if n not in merged:
            merged.append(n)
    return "；".join(merged)


def load_intl_rows(xlsx_path: Path) -> list[list[str]]:
    import pandas as pd

    sheet = "国际组织统计网站"
    df = pd.read_excel(xlsx_path, sheet_name=sheet, header=None)
    return df.fillna("").astype(str).values.tolist()


def load_intl_items(xlsx_path: Path) -> list[dict]:
    rows = load_intl_rows(xlsx_path)[1:]
    items: list[dict] = []
    for index, row in enumerate(rows, start=1):
        if not row or not str(row[0]).strip():
            continue
        _seq, zh, en, url, domain = (row + ["", "", "", "", ""])[:5]
        zh = str(zh).strip()
        if not zh:
            continue
        en_name = str(en).strip()
        if en_name.lower() == "nan":
            en_name = ""
        site = normalize_url(str(url))
        field_note = str(domain).strip()
        if field_note.lower() == "nan":
            field_note = ""
        item = {
            "id": f"DS{index:04d}",
            "name": zh,
            "category": "国际组织",
            "region": "国际",
            "status": "启用",
        }
        if en_name:
            item["en"] = en_name
        if site:
            item["site"] = site
        note = core_note(zh, site, field_note or None)
        if note:
            item["note"] = note
        items.append(item)
    return items


def renumber_tail(content: str) -> str:
    tail_match = re.search(
        r"(  \{ id: 'DS0018'.*)\n\]\n\nexport const sourceCategories",
        content,
        re.DOTALL,
    )
    if not tail_match:
        raise RuntimeError("Could not locate DS0018 tail in yudao-sources-data.ts")
    tail = tail_match.group(1)

    def repl(match: re.Match[str]) -> str:
        num = int(match.group(1))
        return f"DS{num + INTL_OFFSET:04d}"

    tail = re.sub(r"DS(\d{4})", repl, tail)
    return tail


def main() -> None:
    xlsx_path = DEFAULT_XLSX
    if not xlsx_path.exists():
        raise SystemExit(f"Excel not found: {xlsx_path}")
    intl_items = load_intl_items(xlsx_path)
    if len(intl_items) != 338:
        raise RuntimeError(f"Expected 338 intl rows, got {len(intl_items)}")

    content = TARGET.read_text(encoding="utf-8")
    tail = renumber_tail(content)

    header = """// 数据来源字典 · 依据《AI智库数智研究平台AI数据智能汇总.202601014（补充国际）.xlsx》录入
// 包含：国际组织统计网站 / 世界各国统计网站 / 中国各级政府及部门网站 / 三大核心数据源（世界银行、联合国、IMF）
export interface DataSourceItem {
  id: string
  name: string
  en?: string
  category: string // 国际组织 | 各国统计局 | 中国政府机构
  region?: string // 国家/地区 或 中国行政层级
  site?: string
  note?: string
  status: string
}

export const dataSources: DataSourceItem[] = [
"""

    body_lines = [format_entry(item) for item in intl_items]
    footer = "\n" + tail + "\n]\n\nexport const sourceCategories = ['国际组织', '各国统计局', '中国政府机构']\n"
    TARGET.write_text(header + "\n".join(body_lines) + footer, encoding="utf-8")
    print(f"Wrote {len(intl_items)} intl + renumbered tail (+{INTL_OFFSET}) -> {TARGET}")


if __name__ == "__main__":
    main()
