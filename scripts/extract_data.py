#!/usr/bin/env python3
"""Extract structured JSON from the cached 5060do.or.kr crawl mirror.

Source: NAS web_crawling archive (www.5060do.or.kr mirror).
Output: src/data/programs_all.json, jobs_all.json, center_knowledge.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}

BLOCK_TAGS = {
    "p", "div", "br", "li", "tr", "td", "th", "h1", "h2", "h3", "h4",
    "h5", "h6", "section", "article", "table", "ul", "ol", "dl", "dt",
    "dd", "header", "footer", "main", "nav", "form", "blockquote", "pre",
}

DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
INT_RE = re.compile(r"-?[\d,]+")

BOARD_TYPES = {
    7: "사회공헌",
    8: "취업지원",
    9: "창업",
    10: "일자리",
}

CENTER_PAGES = [
    ("greeting", "센터소개", "인사말"),
    ("history", "센터소개", "연혁"),
    ("vision", "센터소개", "비전/미션"),
    ("corporate", "센터소개", "운영법인"),
    ("organization", "센터소개", "조직도"),
    ("facility", "센터소개", "시설안내"),
    ("location", "센터소개", "오시는 길"),
    ("lifePlanAssay", "사업안내", "생애설계진단/상담"),
    ("lifeTimePlan", "사업안내", "인생설계"),
    ("lifeTaskDo", "사업안내", "일·활동"),
    ("lifeSocalhelp", "사업안내", "커뮤니티지원"),
    ("lifeSocalEntry", "커뮤니티", "커뮤니티 참여방법"),
    ("lifeOfficeEntry", "공유사무실", "공유사무실 참여방법"),
]

CONVENTION_PAGES = [
    ("index", "대관안내", "대관신청"),
]


class Node:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag: str = "", attrs=None, parent=None):
        self.tag = tag
        self.attrs = dict(attrs or [])
        self.children = []
        self.parent = parent


class DOM(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        node = Node(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(node)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def parse_file(path: Path) -> Node:
    text = path.read_text(encoding="utf-8", errors="replace")
    dom = DOM()
    dom.feed(text)
    dom.close()
    return dom.root


def iter_nodes(node: Node):
    for child in node.children:
        if isinstance(child, Node):
            yield child
            yield from iter_nodes(child)


def classes(node: Node) -> list[str]:
    return (node.attrs.get("class") or "").split()


def find_all(node: Node, tag=None, cls=None, id_=None):
    result = []
    for item in iter_nodes(node):
        if tag and item.tag != tag:
            continue
        if cls and cls not in classes(item):
            continue
        if id_ and item.attrs.get("id") != id_:
            continue
        result.append(item)
    return result


def find(node: Node, tag=None, cls=None, id_=None):
    items = find_all(node, tag=tag, cls=cls, id_=id_)
    return items[0] if items else None


def normalize(text: str) -> str:
    text = text.replace("\xa0", " ").replace("\u200b", "")
    lines = []
    for line in text.split("\n"):
        line = re.sub(r"[ \t\r\f\v]+", " ", line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def text_of(node: Node) -> str:
    if node is None:
        return ""
    parts = []

    def walk(item):
        if isinstance(item, str):
            parts.append(item)
            return
        is_block = item.tag in BLOCK_TAGS
        if item.tag == "br":
            parts.append("\n")
            return
        if is_block:
            parts.append("\n")
        for child in item.children:
            walk(child)
        if is_block:
            parts.append("\n")

    walk(node)
    return normalize("".join(parts))


def parse_int(text: str, default=0) -> int:
    match = INT_RE.search(text.replace(" ", ""))
    if not match:
        return default
    try:
        return int(match.group(0).replace(",", ""))
    except ValueError:
        return default


def date_range(node: Node) -> str:
    dates = [text_of(p) for p in find_all(node, "p", "date")]
    dates = [d for d in dates if DATE_RE.search(d)]
    if len(dates) >= 2:
        return f"{dates[0]} ~ {dates[1]}"
    match = DATE_RE.findall(text_of(node))
    if len(match) >= 2:
        return f"{match[0]} ~ {match[1]}"
    return text_of(node)


def summarize(content: str, limit: int = 200) -> str:
    if not content:
        return ""
    flat = re.sub(r"\s+", " ", content).strip()
    if len(flat) <= limit:
        return flat
    cut = flat[:limit]
    for punct in (". ", "다. ", "! ", "? "):
        pos = cut.rfind(punct)
        if pos > 80:
            return cut[: pos + len(punct)].strip()
    return cut.rstrip() + "…"


# ---------------------------------------------------------------------------
# Programs
# ---------------------------------------------------------------------------

PROGRAM_LABELS = {
    "모집상태": "status",
    "카테고리": "category",
    "강좌명": "title",
    "가입연령": "target",
    "모집인원": "capacity",
    "신청인원": "enrolled",
    "수강료": "fee",
    "모집기간": "applyPeriod",
    "교육기간": "eduPeriod",
    "프로그램내용": "content",
}


def parse_program(path: Path) -> dict | None:
    root = parse_file(path)

    program_id = None
    for node in find_all(root, "input"):
        if node.attrs.get("name") == "program":
            program_id = node.attrs.get("value")
            break
    if not program_id:
        match = re.search(r"idx=(\d+)", path.parent.name)
        if not match:
            return None
        program_id = match.group(1)

    container = find(root, "div", "lifeEduProgram")
    if container is None:
        return None

    scopes = find_all(container, "div", "pc")
    scope = scopes[0] if scopes else container
    table = find(scope, "table")
    if table is None:
        return None

    raw = {}
    for row in find_all(table, "tr"):
        cells = [c for c in row.children if isinstance(c, Node) and c.tag == "td"]
        i = 0
        while i < len(cells):
            cell = cells[i]
            if "gray" in classes(cell) and i + 1 < len(cells):
                label = text_of(cell)
                raw.setdefault(label, cells[i + 1])
                i += 2
                continue
            i += 1

    def value(label: str) -> str:
        node = raw.get(label)
        if node is None:
            return ""
        if label in ("모집기간", "교육기간"):
            return date_range(node)
        return text_of(node)

    content = value("프로그램내용")
    fee_text = value("수강료")

    return {
        "id": int(program_id),
        "title": value("강좌명"),
        "category": value("카테고리"),
        "summary": summarize(content),
        "capacity": parse_int(value("모집인원")),
        "enrolled": parse_int(value("신청인원")),
        "location": "",
        "fee": parse_int(fee_text) if fee_text else 0,
        "target": value("가입연령"),
        "applyPeriod": value("모집기간"),
        "eduPeriod": value("교육기간"),
        "status": value("모집상태"),
        "sourceUrl": f"https://www.5060do.or.kr/education/lifeEduProgram?idx={program_id}",
        "content": content,
    }


def extract_programs(base: Path) -> list[dict]:
    program_dir = base / "education" / "lifeEduProgram"
    rows = []
    for page in sorted(program_dir.iterdir()):
        if not page.is_dir():
            continue
        index = page / "index.html"
        if not index.exists():
            continue
        item = parse_program(index)
        if item is not None:
            rows.append(item)
    rows.sort(key=lambda r: r["id"], reverse=True)
    return rows


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

def parse_job(path: Path, theme: int, idx: int) -> dict | None:
    root = parse_file(path)

    title_node = find(root, "h2", "tit")
    title = text_of(title_node)
    if not title:
        return None

    date = ""
    author = ""
    info = find(root, "div", "info")
    if info is not None:
        for item in find_all(info, "div", "txt"):
            paragraphs = find_all(item, "p")
            label = ""
            value = ""
            for paragraph in paragraphs:
                if "into_txt" in classes(paragraph):
                    label = text_of(paragraph)
                else:
                    value = text_of(paragraph)
            if label == "작성일":
                date = value
            elif label == "작성자":
                author = value

    content = ""
    desc = find(root, "div", "desc_area")
    if desc is not None:
        inner = find(desc, "div", "inner")
        content = text_of(inner if inner is not None else desc)

    return {
        "id": idx,
        "boardType": BOARD_TYPES[theme],
        "title": title,
        "date": date,
        "company": "",
        "author": author,
        "content": content,
        "sourceUrl": f"https://www.5060do.or.kr/board/read?theme={theme}&idx={idx}",
    }


def extract_jobs(base: Path) -> list[dict]:
    read_dir = base / "board" / "read"
    rows = []
    for page in read_dir.iterdir():
        if not page.is_dir():
            continue
        match = re.match(r"theme=(\d+)&idx=(\d+)", page.name)
        if not match:
            continue
        theme, idx = int(match.group(1)), int(match.group(2))
        if theme not in BOARD_TYPES:
            continue
        index = page / "index.html"
        if not index.exists():
            continue
        item = parse_job(index, theme, idx)
        if item is not None:
            rows.append(item)
    rows.sort(key=lambda r: (list(BOARD_TYPES.values()).index(r["boardType"]), -r["id"]))
    return rows


# ---------------------------------------------------------------------------
# Center knowledge
# ---------------------------------------------------------------------------

def split_chunks(lines: list[str], limit: int = 800) -> list[str]:
    chunks = []
    buffer = ""
    for line in lines:
        if not buffer:
            buffer = line
        elif len(buffer) + len(line) + 1 <= limit:
            buffer = f"{buffer}\n{line}"
        else:
            chunks.append(buffer)
            buffer = line
    if buffer:
        chunks.append(buffer)
    return chunks


def parse_center_page(path: Path, category: str, fallback_title: str) -> dict | None:
    root = parse_file(path)
    content_view = find(root, "div", "contentView")
    if content_view is None:
        return None

    heading = find(content_view, "h4")
    title = text_of(heading) or fallback_title

    pc_scopes = find_all(content_view, "div", "pc")
    scope = pc_scopes[0] if pc_scopes else content_view

    title_block = find(scope, "div", "title")
    if title_block is not None:
        text = text_of(scope)
        text = text.replace(text_of(title_block), "", 1)
    else:
        text = text_of(scope)

    lines = [line for line in text.split("\n") if len(line.strip()) >= 2]
    deduped = []
    for line in lines:
        if not deduped or deduped[-1] != line:
            deduped.append(line)

    chunks = split_chunks(deduped)

    rel = path.parent.parent.name + "/" + path.parent.name
    item = {
        "id": f"center-{path.parent.parent.name}-{path.parent.name}",
        "category": category,
        "title": title,
        "sourceUrl": f"https://www.5060do.or.kr/{rel}",
        "chunks": chunks,
    }
    if not chunks:
        item["note"] = "이미지로만 제공되는 페이지라 텍스트를 추출하지 못했습니다."
    return item


def extract_center(base: Path) -> list[dict]:
    rows = []
    for slug, category, title in CENTER_PAGES:
        index = base / "subLifeTwist" / slug / "index.html"
        if not index.exists():
            continue
        item = parse_center_page(index, category, title)
        if item is not None:
            rows.append(item)
    for slug, category, title in CONVENTION_PAGES:
        index = base / "convention" / slug / "index.html"
        if not index.exists():
            continue
        item = parse_center_page(index, category, title)
        if item is not None:
            rows.append(item)
    return rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def write_json(path: Path, data) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    path.write_text(payload + "\n", encoding="utf-8")
    return path.stat().st_size


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        default=os.environ.get(
            "CRAWL_MIRROR_ROOT",
            r"\\x4\data_collect\web_crawling\5060do.or.kr\mirror\www.5060do.or.kr",
        ),
        help="Mirror root directory (contains education/, board/, subLifeTwist/)",
    )
    parser.add_argument("--out", default="src/data", help="Output directory")
    args = parser.parse_args()

    base = Path(args.root)
    if not base.exists():
        print(f"ERROR: mirror root not found: {base}", file=sys.stderr)
        return 2

    out_dir = Path(args.out)

    programs = extract_programs(base)
    jobs = extract_jobs(base)
    knowledge = extract_center(base)

    sizes = {
        "programs_all.json": write_json(out_dir / "programs_all.json", programs),
        "jobs_all.json": write_json(out_dir / "jobs_all.json", jobs),
        "center_knowledge.json": write_json(out_dir / "center_knowledge.json", knowledge),
    }

    print(f"programs: {len(programs)}")
    print(f"jobs: {len(jobs)}")
    for board_type in BOARD_TYPES.values():
        print(f"  - {board_type}: {sum(1 for j in jobs if j['boardType'] == board_type)}")
    print(f"knowledge pages: {len(knowledge)}")
    print(f"knowledge chunks: {sum(len(k['chunks']) for k in knowledge)}")
    for name, size in sizes.items():
        print(f"  {name}: {size} bytes")
    print(f"programs with text content: {sum(1 for p in programs if p['content'])}")
    print(f"programs missing title: {sum(1 for p in programs if not p['title'])}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
