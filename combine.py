#!/usr/bin/env python3
import re
import requests

BASE_URL_FILE = "base_config.txt"
PATCH_FILE = "patch.conf"
OUTPUT_FILE = "final.lcf"

VALID_SECTIONS = [
    "Plugin", "Rewrite", "Script", "Rule", "Remote Rule",
    "Remote Script", "Remote Filter", "Host", "Proxy", "Proxy Group",
    "General", "Mitm", "Proxy Chain"
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

def apply_patch_to_section(lines, patch_lines):
    """Apply add/delete/modify operations within a section"""
    new_lines = lines.copy()

    for patch_line in patch_lines:
        patch_line = patch_line.strip()
        if not patch_line:
            continue

        if patch_line.startswith("add|"):
            # add|整行内容
            content = patch_line[len("add|"):]
            if content not in new_lines:
                new_lines.append(content)

        elif patch_line.startswith("delete|"):
            # delete|匹配字符串
            content = patch_line[len("delete|"):]
            new_lines = [l for l in new_lines if content not in l]

        elif patch_line.startswith("modify|"):
            # modify|匹配字符串|整行新内容
            parts = patch_line.split("|", 2)
            if len(parts) < 3:
                continue
            match_str = parts[1]
            new_line = parts[2]
            for i, line in enumerate(new_lines):
                if match_str in line:
                    new_lines[i] = new_line
                    break  # 只替换第一次匹配到的行
    return new_lines

def merge_sections(base, patch):
    """Merge patch sections into base with deduplication"""
    for sec, patch_lines in patch.items():
        if sec not in VALID_SECTIONS:
            continue
        base_lines = base.get(sec, [])
        merged_lines = apply_patch_to_section(base_lines, patch_lines)
        # 去掉首尾空行
        merged_lines = [l for l in merged_lines if l.strip() != ""]
        base[sec] = merged_lines
    return base

def generate_output(sections):
    """Rebuild configuration content"""
    out = []
    for sec, lines in sections.items():
        out.append(f"[{sec}]")
        out.extend(lines)
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

    # 7. Write final.conf
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(final_content)

    print(f"Generated {OUTPUT_FILE} successfully!")

if __name__ == "__main__":
    main()
