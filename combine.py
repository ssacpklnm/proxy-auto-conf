#!/usr/bin/env python3
import re
import requests

BASE_URL_FILE = "base_config.txt"
PATCH_FILE = "patch.conf"
OUTPUT_FILE = "final.lcf"

# 支持的段落
VALID_SECTIONS = [
    "Plugin", "Rewrite", "Script", "Rule", "Remote Rule",
    "Remote Filter", "Host", "Proxy", "Proxy Group", "General", "Mitm"
]

# Loon iOS UA
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
            if current is not None:
                sections[current] = lines
            current = m.group(1).strip()
            lines = []
        else:
            if current is not None:
                lines.append(line)
    if current is not None:
        sections[current] = lines
    return sections

def apply_patch_line(base_lines, patch_line):
    """Apply add/delete/modify operations"""
    patch_line = patch_line.strip()
    if not patch_line:
        return base_lines

    if patch_line.startswith("add|"):
        _, line_content = patch_line.split("|", 1)
        # 添加到末尾，去重
        if line_content not in base_lines:
            base_lines.append(line_content)
    elif patch_line.startswith("delete|"):
        _, keyword = patch_line.split("|", 1)
        # 模糊匹配删除
        base_lines = [l for l in base_lines if keyword not in l]
    elif patch_line.startswith("modify|"):
        _, match_content, new_line = patch_line.split("|", 2)
        # 精确匹配并替换整行
        base_lines = [new_line if match_content in l else l for l in base_lines]
    else:
        # 普通行，直接添加去重
        if patch_line not in base_lines:
            base_lines.append(patch_line)

    return base_lines

def merge_sections(base, patch):
    """Merge patch sections into base with deduplication"""
    for sec, patch_lines in patch.items():
        if sec not in VALID_SECTIONS:
            continue

        base_lines = base.get(sec, [])

        for pline in patch_lines:
            base_lines = apply_patch_line(base_lines, pline)

        # 去掉段首尾空行
        base_lines = [l for l in base_lines if l.strip() != ""]
        base[sec] = base_lines

    return base

def generate_output(sections):
    """Rebuild configuration content without extra empty lines"""
    out = []
    for sec, lines in sections.items():
        out.append(f"[{sec}]")
        # 保留注释和内容，段内去掉空行
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

    # 7. Write final.conf
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(final_content)

    print(f"Generated {OUTPUT_FILE} successfully!")

if __name__ == "__main__":
    main()
