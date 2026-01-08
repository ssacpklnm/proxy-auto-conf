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
    with open(BASE_URL_FILE, "r", encoding="utf-8") as f:
        url = f.read().strip()
        if not url:
            raise ValueError("base_config.txt is empty")
        return url

def download_base(url):
    """Download base configuration content"""
    resp = requests.get(url, headers=HEADERS)
    resp.raise_for_status()
    return resp.text

def parse_sections(content):
    """Parse sections and capture leading comments"""
    sections = {}
    current = None
    lines = []
    leading_comments = []

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
            else:
                # 在第一个 [Section] 之前的注释或空行
                leading_comments.append(line)
    if current:
        sections[current] = lines
    return leading_comments, sections

def apply_patch(base, patch):
    """Apply add/delete/modify operations from patch to base"""
    for sec, patch_lines in patch.items():
        if sec not in VALID_SECTIONS:
            continue
        base_lines = base.get(sec, [])
        new_lines = base_lines.copy()

        for line in patch_lines:
            if line.startswith("add|"):
                _, content = line.split("|", 1)
                if content not in new_lines:
                    new_lines.append(content)
            elif line.startswith("delete|"):
                _, keyword = line.split("|", 1)
                new_lines = [l for l in new_lines if keyword not in l]
            elif line.startswith("modify|"):
                try:
                    _, match_content, new_content = line.split("|", 2)
                except ValueError:
                    continue
                for idx, l in enumerate(new_lines):
                    if l.startswith(match_content) or l == match_content:
                        new_lines[idx] = new_content
        # 去掉段内多余空行
        new_lines = [l for l in new_lines if l.strip() != ""]
        base[sec] = new_lines
    return base

def generate_output(leading_comments, sections):
    """Rebuild configuration content preserving leading comments"""
    out = []
    # 文件开头注释
    for line in leading_comments:
        out.append(line)
    if leading_comments:
        out.append("")  # 注释和第一个 section 之间空一行

    for sec, lines in sections.items():
        out.append(f"[{sec}]")
        for l in lines:
            out.append(l)
        out.append("")  # 段落间保留单个空行
    return "\n".join(out).rstrip() + "\n"

def main():
    url = read_base_url()
    print(f"Downloading base config from: {url}")
    base_content = download_base(url)

    with open(PATCH_FILE, "r", encoding="utf-8") as f:
        patch_content = f.read()

    base_leading, base_sections = parse_sections(base_content)
    _, patch_sections = parse_sections(patch_content)

    merged_sections = apply_patch(base_sections, patch_sections)
    final_content = generate_output(base_leading, merged_sections)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(final_content)

    print(f"Generated {OUTPUT_FILE} successfully!")

if __name__ == "__main__":
    main()
