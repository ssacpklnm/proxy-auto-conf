#!/usr/bin/env python3
import re

def parse_sections(content):
    """Parse all [Section] blocks into an ordered dict structure."""
    sections = {}
    current = None
    lines = []

    for line in content.splitlines(keepends=False):
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
    """Merge patch sections into base sections with deduplication."""
    for sec, patch_lines in patch.items():
        patch_set = list(dict.fromkeys([l for l in patch_lines if l.strip() != ""]))

        if sec not in base:
            # Section doesn't exist → append directly
            base[sec] = patch_set
        else:
            # Section exists → merge with dedupe
            merged = list(dict.fromkeys(
                base[sec] + patch_set
            ))
            base[sec] = merged

    return base


def generate_output(sections):
    """Rebuild file content."""
    out = []
    for sec, lines in sections.items():
        out.append(f"[{sec}]")
        out.extend(lines)
        out.append("")  # blank line between sections
    return "\n".join(out).rstrip() + "\n"


def main():
    with open("base_config.conf", "r", encoding="utf-8") as f:
        base_content = f.read()

    with open("patch.conf", "r", encoding="utf-8") as f:
        patch_content = f.read()

    base_sections = parse_sections(base_content)
    patch_sections = parse_sections(patch_content)

    merged = merge_sections(base_sections, patch_sections)

    final = generate_output(merged)

    with open("final.conf", "w", encoding="utf-8") as f:
        f.write(final)


if __name__ == "__main__":
    main()
