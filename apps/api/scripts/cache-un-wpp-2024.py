"""Prewarm the immutable WPP 2024 official file; run from apps/api (Python 3)."""
import hashlib
import os
from pathlib import Path
import tempfile
import urllib.request

URL = "https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_Demographic_Indicators_Medium.csv.gz"
SHA256 = "286ac36bb1415e2e1ade03acfef0a29f0e4c087e2f78e38c48f50c5df89082bc"

def main():
    directory = Path(os.environ.get("OFFICIAL_DATA_CACHE_DIR", "storage/official-data"))
    directory.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        digest = hashlib.sha256()
        with tempfile.NamedTemporaryFile(dir=directory, delete=False) as out:
            temporary = Path(out.name)
            with urllib.request.urlopen(URL, timeout=60) as response:
                while chunk := response.read(1024 * 1024):
                    digest.update(chunk)
                    out.write(chunk)
                    if out.tell() > 32 * 1024 * 1024:
                        raise ValueError("Official file exceeds expected size")
        if digest.hexdigest() != SHA256:
            raise ValueError("Official file checksum changed; review the edition before updating")
        target = directory / "WPP2024_Demographic_Indicators_Medium.csv.gz"
        temporary.replace(target)
        print(f"Verified official WPP 2024 cache: {target}")
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

if __name__ == "__main__":
    main()
