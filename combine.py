#!/usr/bin/env python3
import re
import requests

BASE_URL_FILE = "base_config.txt"
PATCH_FILE = "patch.conf"
OUTPUT_FILE = "final.lcf"

VALID_SECTIONS = [
    "Plugin", "Rewrite", "Script", "Rule", "Remote Rule",
    "Host", "Proxy", "Proxy Group", "General", "Mitm"
]

HEADERS = {
    "User-Agent": "Loon/3.2.1 (iPhone; iOS 17.0)",
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

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
    resp = requests.get(url, headers=HEADERS)
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
    """Merge patch sections into base with deduplication and remove extra empty lines"""
    for sec, patch_lines in patch.items():
        if sec not in VALID_SECTIONS:
            continue

        # 去掉 patch 段首尾空行
        patch_lines_clean = [l for l in patch_lines if l.strip() != ""]
        # 去掉 base 段首尾空行
        base_lines_clean = base.get(sec, [])
        base_lines_clean = [l for l in base_lines_clean if l.strip() != ""]

        # 合并去重
        merged = list(dict.fromkeys(base_lines_clean + patch_lines_clean))
        base[sec] = merged

    return base

def generate_output(sections):
    """Rebuild configuration content without extra empty lines"""
    out = []
    for sec, lines in sections.items():
        out.append(f"[{sec}]")
        # 去掉段内空行
        cleaned_lines = [l for l in lines if l.strip() != ""]
        out.extend(cleaned_lines)
        out.append("")  # 段落间保留一个空行
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
