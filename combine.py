#!/usr/bin/env python3
import re
import requests

BASE_URL_FILE = "base_config.txt"
PATCH_FILE = "patch.conf"
OUTPUT_FILE = "final.lcf"

VALID_SECTIONS = [
    "Plugin", "Rewrite", "Script", "Rule", "Remote Rule",
    "Host", "Proxy", "Proxy Group", "General", "Mitm", "Remote Filter"
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
    """Parse all [Section] blocks into an ordered dict, preserving comments"""
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

def apply_patch_operations(base_lines, patch_lines):
    """Apply add/delete/modify operations in patch_lines to base_lines"""
    base_lines = base_lines.copy()

    for line in patch_lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        if line.startswith("add|"):
            content = line[len("add|"):].strip()
            if content not in base_lines:
                base_lines.append(content)

        elif line.startswith("delete|"):
            keyword = line[len("delete|"):].strip()
            base_lines = [l for l in base_lines if keyword not in l]

        elif line.startswith("modify|"):
            parts = line.split("|", 2)
            if len(parts) == 3:
                key, new_content = parts[1].strip(), parts[2].strip()
                for idx, l in enumerate(base_lines):
                    # 只匹配行开头标识符
                    if l.startswith(f"{key} ="):
                        base_lines[idx] = new_content
                        break

    return base_lines

def merge_sections(base, patch):
    """Merge patch sections into base with operations"""
    for sec, patch_lines in patch.items():
        if sec not in VALID_SECTIONS:
            continue

        base_lines = base.get(sec, [])
        merged_lines = apply_patch_operations(base_lines, patch_lines)
        base[sec] = merged_lines

    return base

def generate_output(sections):
    """Rebuild configuration content without extra empty lines"""
    out = []
    for sec, lines in sections.items():
        out.append(f"[{sec}]")
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

    # 5. Merge sections
    merged_sections = merge_sections(base_sections, patch_sections)

    # 6. Generate output
    final_content = generate_output(merged_sections)

    # 7. Write final.lcf
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(fina
