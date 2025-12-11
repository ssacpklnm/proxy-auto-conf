import requests

BASE_URL_FILE = "base_config.txt"
PATCH_FILE = "patch.conf"
OUTPUT_FILE = "final.conf"

# 分段标题
SECTIONS = ["[Plugin]", "[Rule]", "[Rewrite]", "[Host]", "[URL Rewrite]"]

def load_patch_by_section(patch_text):
    """把 patch 按段落分类"""
    result = {s: [] for s in SECTIONS}
    current = None

    for line in patch_text.splitlines():
        striped = line.strip()
        if striped in SECTIONS:
            current = striped
            continue
        if current and striped and not striped.startswith("#"):
            result[current].append(line)
    return result


def insert_into_section(base_text, patch_map):
    """把 patch 插入到 base 文件对应段落"""
    lines = base_text.splitlines()
    output = []
    current_section = None

    for line in lines:
        striped = line.strip()
        if striped in SECTIONS:
            current_section = striped
            output.append(line)
            # 插入补丁
            if patch_map[current_section]:
                output.extend(patch_map[current_section])
            continue
        output.append(line)

    # 如果某些段落不存在于原文件，则追加
    for section in SECTIONS:
        if patch_map[section]:
            output.append("")
            output.append(section)
            output.extend(patch_map[section])

    return "\n".join(output)


def main():
    with open(BASE_URL_FILE, "r") as f:
        url = f.read().strip()

    print(f"Downloading base config: {url}")
    base_text = requests.get(url).text

    with open(PATCH_FILE, "r") as f:
        patch_text = f.read()

    patch_map = load_patch_by_section(patch_text)

    final_text = insert_into_section(base_text, patch_map)

    with open(OUTPUT_FILE, "w") as f:
        f.write(final_text)

    print("final.conf updated successfully")


if __name__ == "__main__":
    main()
