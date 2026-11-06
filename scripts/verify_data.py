#!/usr/bin/env python3
"""Validate the JSON knowledge files produced by extract_data.py."""

from __future__ import annotations

import json
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "src" / "data"

PROGRAM_FIELDS = [
    "id", "title", "category", "summary", "capacity", "enrolled",
    "location", "fee", "target", "applyPeriod", "eduPeriod", "status",
    "sourceUrl", "content",
]
JOB_FIELDS = ["id", "boardType", "title", "date", "company", "content", "sourceUrl"]
KNOWLEDGE_FIELDS = ["id", "category", "title", "sourceUrl", "chunks"]

BOARD_TYPES = {"사회공헌", "취업지원", "창업", "일자리"}


def load(name: str):
    path = DATA_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"missing output file: {path}")
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def check(condition: bool, message: str, failures: list[str]) -> None:
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {message}")
    if not condition:
        failures.append(message)


def main() -> int:
    failures: list[str] = []

    programs = load("programs_all.json")
    jobs = load("jobs_all.json")
    knowledge = load("center_knowledge.json")

    check(isinstance(programs, list), "programs_all.json is a JSON array", failures)
    check(len(programs) >= 500, f"program count >= 500 (found {len(programs)})", failures)
    check(len(programs) == 667, f"program count == 667 crawl pages (found {len(programs)})", failures)
    program_ids = [p.get("id") for p in programs]
    check(len(program_ids) == len(set(program_ids)), "program ids are unique", failures)
    check(all(all(field in p for field in PROGRAM_FIELDS) for p in programs),
          "every program has all required fields", failures)
    check(all(p.get("title") for p in programs), "every program has a title", failures)

    check(isinstance(jobs, list), "jobs_all.json is a JSON array", failures)
    check(len(jobs) == 2034, f"job count == 2034 board posts (found {len(jobs)})", failures)
    job_ids = [(j.get("boardType"), j.get("id")) for j in jobs]
    check(len(job_ids) == len(set(job_ids)), "job (boardType, id) keys are unique", failures)
    check(all(all(field in j for field in JOB_FIELDS) for j in jobs),
          "every job has all required fields", failures)
    check({j.get("boardType") for j in jobs} == BOARD_TYPES,
          "job board types match 사회공헌/취업지원/창업/일자리", failures)
    check(all(j.get("title") for j in jobs), "every job has a title", failures)

    check(isinstance(knowledge, list), "center_knowledge.json is a JSON array", failures)
    check(all(all(field in k for field in KNOWLEDGE_FIELDS) for k in knowledge),
          "every knowledge page has all required fields", failures)
    chunk_total = sum(len(k.get("chunks") or []) for k in knowledge)
    check(chunk_total >= 5, f"knowledge chunk count >= 5 (found {chunk_total})", failures)

    print()
    print(f"programs: {len(programs)} (text content: {sum(1 for p in programs if p['content'])})")
    print(f"jobs: {len(jobs)} (text content: {sum(1 for j in jobs if j['content'])})")
    print(f"knowledge pages: {len(knowledge)} (chunks: {chunk_total})")

    if failures:
        print(f"\nRESULT: FAIL ({len(failures)} checks)")
        return 1
    print("\nRESULT: PASS")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
