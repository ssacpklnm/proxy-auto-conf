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


def merge_sections(base, patch):
    """Merge patch sections into base with add/delete/modify"""
    for sec, patch_lines in patch.items():
        if sec not in VALID_SECTIONS:
            continue

        if sec not in base:
            base[sec] = []  # 初始化空段落

        base_lines = base[sec]

        for pline in patch_lines:
            pline = pline.rstrip("\n")
            if not pline or pline.startswith("#"):
                continue

            if pline.startswith("add|"):
                content_to_add = pline[len("add|") :]
                if content_to_add not in base_lines:
                    base_lines.append(content_to_add)
            elif pline.startswith("delete|"):
                key = pline[len("delete|") :]
                base_lines = [l for l in base_lines if key not in l]
            elif pline.startswith("modify|"):
                parts = pline.split("|", 2)
                if len(parts) == 3:
                    match_key, new_line = parts[1], parts[2]
                    for i, l in enumerate(base_lines):
                        if match_key in l:
                            base_lines[i] = new_line

        base[sec] = base_lines

    return base



def apply_patch(base_sections, patch_sections):
    """Apply add/delete/modify patch rules to base_sections"""
    for sec, patch_lines in patch_sections.items():
        if sec not in VALID_SECTIONS:
            continue
        base_lines = base_sections.get(sec, [])

        for pline in patch_lines:
            pline = pline.rstrip("\n")  # 保留开头空格
            if not pline or pline.startswith("#"):
                continue

            if pline.startswith("add|"):
                # 直接添加，不修改、不去空格
                content_to_add = pline[len("add|") :]
                if content_to_add not in base_lines:
                    base_lines.append(content_to_add)
            elif pline.startswith("delete|"):
                key = pline[len("delete|") :]
                # 模糊匹配删除包含 key 的行
                base_lines = [l for l in base_lines if key not in l]
            elif pline.startswith("modify|"):
                # 格式: modify|匹配标识|整行新内容
                parts = pline.split("|", 2)
                if len(parts) == 3:
                    match_key, new_line = parts[1], parts[2]
                    for i, l in enumerate(base_lines):
                        if match_key in l:
                            base_lines[i] = new_line
            else:
                # 如果没有前缀，默认追加
                if pline not in base_lines:
                    base_lines.append(pline)

        base_sections[sec] = base_lines

    return base_sections



def generate_output(sections):
    """Rebuild configuration content preserving comments and spacing"""
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

    # 5. Apply patch rules
    merged_sections = apply_patch(base_sections, patch_sections)

    # 6. Generate output
    final_content = generate_output(merged_sections)

    # 7. Write final.lcf
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(final_content)

    print(f"Generated {OUTPUT_FILE} successfully!")


if __name__ == "__main__":
    main()
