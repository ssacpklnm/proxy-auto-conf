#!/usr/bin/env python3
import re
import requests

BASE_URL_FILE = "base_config.txt"
PATCH_FILE = "patch.conf"
OUTPUT_FILE = "final.lcf"

VALID_SECTIONS = [
    "Plugin", "Rewrite", "Script", "Rule", "Remote Rule",
    "Host", "Proxy", "Proxy Group", "General", "Mitm",
    "Remote Proxy", "Remote Filter", "Remote Script",
    "Proxy Chain"
]

HEADERS = {
    "User-Agent": "Loon/3.2.1 (iPhone; iOS 17.0)",
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

# ---------- Utils ----------

def read_base_url():
    with open(BASE_URL_FILE, "r", encoding="utf-8") as f:
        url = f.read().strip()
        if not url:
            raise ValueError("base_config.txt is empty")
        return url

def download_base(url):
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.text

# ---------- Parse ----------

def parse_sections(content):
    """
    Parse config into sections.
    Preserve all lines before first [Section] as __HEADER__
    """
    sections = {}
    header = []
    current = None
    lines = []

    for line in content.splitlines():
        m = re.match(r"^\[(.+?)\]\s*$", line)
        if m:
            if current is None:
                sections["__HEADER__"] = header
            else:
                sections[current] = lines

            current = m.group(1).strip()
            lines = []
        else:
            if current is None:
                header.append(line)
            else:
                lines.append(line)

    if current:
        sections[current] = lines

    return sections

# ---------- Merge ----------

def merge_sections(base, patch):
    """
    Merge patch sections into base sections.
    - Only handle VALID_SECTIONS
    - Remove duplicate lines
    - No extra empty lines
    """
    for sec, patch_lines in patch.items():
        if sec not in VALID_SECTIONS:
            continue

        base_lines = base.get(sec, [])

        base_clean = [l for l in base_lines if l.strip()]
        patch_clean = [l for l in patch_lines if l.strip()]

        merged = list(dict.fromkeys(base_clean + patch_clean))
        base[sec] = merged

    return base

# ---------- Output ----------

def generate_output(sections):
    out = []

    # Header (comments before first section)
    header = sections.pop("__HEADER__", [])
    if header:
        out.extend(header)
        out.append("")

    for sec, lines in sections.items():
        out.append(f"[{sec}]")
        out.extend(lines)
        out.append("")

    return "\n".join(out).rstrip() + "\n"

# ---------- Main ----------

def main():
    url = read_base_url()
    print(f"Downloading base config from: {url}")

    base_content = download_base(url)

    with open(PATCH_FILE, "r", encoding="utf-8") as f:
        patch_content = f.read()

    base_sections = parse_sections(base_content)
    patch_sections = parse_sections(patch_content)

    merged_sections = merge_sections(base_sections, patch_sections)
    final_content = generate_output(merged_sections)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(final_content)

    print(f"✅ Generated {OUTPUT_FILE} successfully")

if __name__ == "__main__":
    main()
