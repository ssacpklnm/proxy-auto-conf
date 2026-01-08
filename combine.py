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
    try:
        with open(BASE_URL_FILE, "r", encoding="utf-8") as f:
            url = f.read().strip()
            if not url:
                raise ValueError("base_config.txt is empty")
            return url
    except FileNotFoundError:
        raise FileNotFoundError(f"{BASE_URL_FILE} not found")

def download_base(url):
    resp = requests.get(url, headers=HEADERS)
    resp.raise_for_status()
    return resp.text

def parse_sections(content):
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
    new_lines = lines.copy()

    for patch_line in patch_lines:
        patch_line = patch_line.strip()
        if not patch_line:
            continue

        if patch_line.startswith("add|"):
            content = patch_line[len("add|"):]
            if content not in new_lines:
                new_lines.append(content)

        elif patch_line.startswith("delete|"):
            content = patch_line[len("delete|"):]
            new_lines = [l for l in new_lines if content not in l]

        elif patch_line.startswith("modify|"):
            parts = patch_line.split("|", 2)
            if len(parts) < 3:
                continue
            match_str = parts[1]
            new_line = parts[2]

            # 先删除段内所有匹配行
            new_lines = [l for l in new_lines if match_str not in l]

            # 然后只添加一次新行
            if new_line not in new_lines:
                new_lines.append(new_line)

    # 去掉首尾空行
    new_lines = [l for l in new_lines if l.strip() != ""]
    return new_lines

def merge_sections(base, patch):
    for sec, patch_lines in patch.items():
        if sec not in VALID_SECTIONS:
            continue
        base_lines = base.get(sec, [])
        merged_lines = apply_patch_to_section(base_lines, patch_lines)
        base[sec] = merged_lines
    return base

def generate_output(sections):
    out = []
    for sec, lines in sections.items():
        out.append(f"[{sec}]")
        out.extend(lines)
        out.append("")  # 段间空行
    return "\n".join(out).rstrip() + "\n"

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

    print(f"Generated {OUTPUT_FILE} successfully!")

if __name__ == "__main__":
    main()
