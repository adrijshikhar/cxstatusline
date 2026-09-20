#!/usr/bin/env python3
"""
triage.py - Categorize upstream ccstatusline commits and list changed files.

Can parse compare JSON from stdin or gh api, categorize each commit
according to the triage matrix, and output a markdown table or JSON.
"""

import argparse
import json
import re
import subprocess
import sys
from typing import Any, Dict, List, Optional


def classify_commit(title: str) -> str:
    """Classify commit title according to the triage matrix."""
    normalized = title.strip()

    # Category C: Claude-specific auth, keychain, oauth, external links
    if re.search(r"\b(keychain|oauth|auth|claudenews|anthropic)\b", normalized, re.I) or re.search(
        r"claude\s*(token|login|tier)", normalized, re.I
    ):
        return "C (Skip)"

    # Category D: Dev-dependencies, build config, CI, bumps
    if re.search(r"^chore\((deps|deps-dev|ci|release)\)", normalized, re.I) or re.search(
        r"\b(deps-dev|dependency|dependencies)\b", normalized, re.I
    ) or re.search(r"\bbump\s+(typescript|biome|chalk|react|ink|eslint)\b", normalized, re.I):
        return "D (Tooling)"

    # Category B: Usage, session telemetry, rate limits, reset timers
    if re.search(r"\b(usage|rate[ -]?limit|reset[ -]?timer|session|telemetry|five[ -]?hour|weekly)\b", normalized, re.I) or re.search(
        r"\bno-data\b", normalized, re.I
    ):
        return "B (Adapt)"

    # Category A: Direct port (widgets, git, terminal, layout, powerline, etc.)
    if re.search(r"\b(widget|widgets|git|jj|terminal|flex|width|command|symbol|powerline|ansi|layout|theme|llms\.txt|preview)\b", normalized, re.I):
        return "A (Direct)"

    return "A (Direct)"


def parse_commits_payload(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract list of commits with short sha, title, and assigned category."""
    commits = raw.get("commits", [])
    results = []
    for c in commits:
        sha = c.get("sha", "")
        short_sha = sha[:7] if sha else "unknown"
        commit_info = c.get("commit", {})
        message = commit_info.get("message", "")
        title = message.split("\n")[0].strip() if message else ""
        category = classify_commit(title)
        results.append({
            "sha": sha,
            "shortSha": short_sha,
            "title": title,
            "category": category,
            "url": c.get("html_url", ""),
        })
    return results


def format_markdown_table(commits: List[Dict[str, Any]]) -> str:
    """Format commit entries into a GitHub markdown table."""
    lines = [
        "| Commit Hash | Upstream Title | Category | Target in `cxstatusline` | Notes / Actions |",
        "|---|---|---|---|---|",
    ]
    for c in commits:
        lines.append(f"| `{c['shortSha']}` | `{c['title']}` | {c['category']} | TBD | |")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Triage upstream ccstatusline commits")
    parser.add_argument("message", nargs="?", help="Single commit message to classify")
    parser.add_argument("--file", "-f", help="JSON file containing GitHub compare payload")
    parser.add_argument("--compare", help="Compare range to fetch via gh api (e.g. base...HEAD)")
    parser.add_argument("--repo", default="sirmalloc/ccstatusline", help="Upstream repo (default: sirmalloc/ccstatusline)")
    parser.add_argument("--json", action="store_true", help="Output raw JSON array")

    args = parser.parse_args()

    if args.message:
        cat = classify_commit(args.message)
        if args.json:
            print(json.dumps({"title": args.message, "category": cat}, indent=2))
        else:
            print(f"Message: {args.message}")
            print(f"Category: {cat}")
        return

    payload: Optional[Dict[str, Any]] = None

    if args.compare:
        cmd = ["gh", "api", f"repos/{args.repo}/compare/{args.compare}"]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            sys.stderr.write(f"Error fetching compare from GitHub: {res.stderr}\n")
            sys.exit(1)
        payload = json.loads(res.stdout)
    elif args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            payload = json.load(f)
    elif not sys.stdin.isatty():
        input_data = sys.stdin.read().strip()
        if input_data:
            payload = json.loads(input_data)

    if payload is None:
        parser.print_help()
        sys.exit(0)

    entries = parse_commits_payload(payload)

    if args.json:
        print(json.dumps(entries, indent=2))
    else:
        print(format_markdown_table(entries))


if __name__ == "__main__":
    main()
