#!/usr/bin/env python3
import re
import requests

BASE_URL_FILE = "base_config.txt"
PATCH_FILE = "patch.conf"
OUTPUT_FILE = "final.conf"

# 支持的 Loon 段落
VALID_SECTIONS = [
    "Plugin", "Rewrite", "Script", "Rule", "Remote Rule",
    "Host", "Proxy", "Proxy Group", "General", "Mitm"
]

def read_base_url():
    """Read base URL from base_config.txt"""
    try:
        with open(BASE_URL_FILE, "r", encoding="utf-8") as f:
            url = f.read().strip()
            if not url:
                raise ValueError("base_config.txt is empty")
            return url
    except FileNotFoundError:
        raise FileNotFoundError(f"{BASE_URL_FILE} not found")

def download_base(url):
    """Download base configuration content"""
    resp = requests.get(url)
    resp.raise_for_status()
    return resp.text

def parse_sections(content):
    """Parse all [Section] blocks into an ordered dict"""
    sections = {}
    current = None
    lines = []

    for line in content.splitlines():
        m = re.match(r"^\[(.+?)\]\s*$", line)
        if m:
            if current:
                sections[current] = lines
            current = m.group(1).strip()
            lines = []
        else:
            if current:
                lines.append(line)

    if current:
        sections[current] = lines

    return sections

def merge_sections(base, patch):
    """Merge patch sections into base with deduplication"""
    for sec, patch_lines in patch.items():
        if sec not in VALID_SECTIONS:
            continue  # skip unknown sections
        patch_set = list(dict.fromkeys([l for l in patch_lines if l.strip() != ""]))
        if sec not in base:
            # section doesn't exist → append
            base[sec] = patch_set
        else:
            merged = list(dict.fromkeys(base[sec] + patch_set))
            base[sec] = merged
    return base

def generate_output(sections):
    """Rebuild configuration content"""
    out = []
    for sec, lines in sections.items():
        out.append(f"[{sec}]")
        out.extend(lines)
        out.append("")  # blank line between sections
    return "\n".join(out).rstrip() + "\n"

def main():
    # 1. Read base URL
    url = read_base_url()
    print(f"Downloading base config from: {url}")

    # 2. Download base config
    base_content = download_base(url)

    # 3. Read patch
    with open(PATCH_FILE, "r", encoding="utf-8") as f:
        patch_content = f.read()

    # 4. Parse sections
    base_sections = parse_sections(base_content)
    patch_sections = parse_sections(patch_content)

    # 5. Merge sections (方案B)
    merged_sections = merge_sections(base_sections, patch_sections)

    # 6. Generate output
    final_content = generate_output(merged_sections)

    # 7. Write final.conf
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(final_content)

    print(f"Generated {OUTPUT_FILE} successfully!")

if __name__ == "__main__":
    main()
