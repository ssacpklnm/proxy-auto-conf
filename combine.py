import requests

BASE_URL_FILE = "base_config.txt"
PATCH_FILE = "patch.conf"
OUTPUT_FILE = "final.conf"

# 支持的段落
SECTIONS = ["[Plugin]", "[Rule]", "[Rewrite]", "[Host]", "[URL Rewrite]"]

def load_patch_by_section(text):
    """按段落拆分补丁"""
    result = {s: [] for s in SECTIONS}
    current = None

    for line in text.splitlines():
        striped = line.strip()
        if striped in SECTIONS:
            current = striped
            continue
        if current and striped and not striped.startswith("#"):
            result[current].append(line.strip())
    return result


def extract_sections(text):
    """把 base 配置按段落拆分"""
    result = {s: [] for s in SECTIONS}
    current = None

    for line in text.splitlines():
        striped = line.strip()
        if striped in SECTIONS:
            current = striped
            continue
        if current and striped and not striped.startswith("#"):
            result[current].append(line.strip())
    return result


def merge_and_dedupe(base_map, patch_map):
    """合并 + 去重"""
    merged = {}

    for section in SECTIONS:
        # base + patch 合并
        combined = base_map[section] + patch_map[section]

        # 去重，保持原顺序
        seen = set()
        result = []
        for item in combined:
            if item not in seen:
                seen.add(item)
                result.append(item)
        merged[section] = result

    return merged


def rebuild_text(base_text, merged_map):
    """把合并结果插回 base 文件"""
    lines = base_text.splitlines()
    output = []
    current_section = None
    inserted = {s: False for s in SECTIONS}

    for line in lines:
        striped = line.strip()

        if striped in SECTIONS:
            current_section = striped
            output.append(line)

            # 插入去重后的内容
            output.extend(merged_map[current_section])
            inserted[current_section] = True
            continue

        # 非 section 的行照抄
        output.append(line)

    # 如果某段落不存在于原文件，追加
    for section in SECTIONS:
        if not inserted[section] and merged_map[section]:
            output.append("")
            output.append(section)
            output.extend(merged_map[section])

    return "\n".join(output)


def main():
    # 读取 base URL
    with open(BASE_URL_FILE, "r") as f:
        url = f.read().strip()

    base_text = requests.get(url).text

    with open(PATCH_FILE, "r") as f:
        patch_text = f.read()

    # 拆分
    base_map = extract_sections(base_text)
    patch_map = load_patch_by_section(patch_text)

    # 合并 + 去重
    merged_map = merge_and_dedupe(base_map, patch_map)

    # 重建配置
    final_text = rebuild_text(base_text, merged_map)

    with open(OUTPUT_FILE, "w") as f:
        f.write(final_text)

    print("final.conf updated and deduplicated successfully")


if __name__ == "__main__":
    main()
