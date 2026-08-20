#!/usr/bin/env python3
"""Send Copilot CLI session usage and Git metadata to a webhook."""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any


DEFAULT_WEBHOOK_URL = "https://webhook.site/1bc3a2d1-2761-4d7f-86ed-ff8081bc396b"
NANO_AI_CREDITS_PER_CREDIT = Decimal("1000000000")


def git_value(cwd: Path, *args: str) -> str | None:
    result = subprocess.run(
        ["git", "-C", str(cwd), *args],
        check=False,
        capture_output=True,
        text=True,
    )
    value = result.stdout.strip()
    return value or None


def sanitized_remote(remote: str | None) -> str | None:
    if remote is None:
        return None

    if "://" not in remote or "@" not in remote:
        return remote

    scheme, remainder = remote.split("://", 1)
    return f"{scheme}://{remainder.rsplit('@', 1)[-1]}"


def repository_metadata(cwd: Path) -> dict[str, str | None]:
    root = git_value(cwd, "rev-parse", "--show-toplevel")
    repository_dir = Path(root) if root else cwd
    return {
        "cwd": str(cwd),
        "root": root,
        "remote_origin": sanitized_remote(
            git_value(repository_dir, "config", "--get", "remote.origin.url")
        ),
        "branch": git_value(repository_dir, "branch", "--show-current"),
        "commit": git_value(repository_dir, "rev-parse", "HEAD"),
    }


def ai_credits_from_nano(nano_ai_credits: int) -> float:
    credits = Decimal(nano_ai_credits) / NANO_AI_CREDITS_PER_CREDIT
    return float(credits.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def query_usage_store(
    database: Path, session_id: str
) -> tuple[list[dict[str, Any]], str] | None:
    if not database.is_file():
        return None

    try:
        connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    except sqlite3.Error as error:
        print(f"Cannot open Copilot usage store: {error}", file=sys.stderr)
        return None

    try:
        rows = connection.execute(
            """
            SELECT
                model,
                COALESCE(SUM(input_tokens), 0),
                COALESCE(SUM(output_tokens), 0),
                COALESCE(SUM(cache_read_tokens), 0),
                COALESCE(SUM(cache_write_tokens), 0),
                COALESCE(SUM(reasoning_tokens), 0),
                COALESCE(SUM(total_nano_aiu), 0)
            FROM assistant_usage_events
            WHERE session_id = ?
            GROUP BY model
            ORDER BY model
            """,
            (session_id,),
        ).fetchall()
    except sqlite3.Error as error:
        print(f"Cannot query Copilot usage store: {error}", file=sys.stderr)
        return None
    finally:
        connection.close()

    if not rows:
        return None

    return (
        [
            {
                "model": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cache_read_tokens": cache_read_tokens,
                "cache_write_tokens": cache_write_tokens,
                "reasoning_tokens": reasoning_tokens,
                "github_ai_credits": ai_credits_from_nano(nano_aiu),
            }
            for (
                model,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_write_tokens,
                reasoning_tokens,
                nano_aiu,
            ) in rows
        ],
        "session-store",
    )


def usage_from_events(events_path: Path) -> tuple[list[dict[str, Any]], str] | None:
    if not events_path.is_file():
        return None

    by_model: dict[str, int] = defaultdict(int)
    with events_path.open(encoding="utf-8") as events:
        for line in events:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            if event.get("type") != "assistant.message":
                continue

            data = event.get("data", {})
            output_tokens = data.get("outputTokens")
            if isinstance(output_tokens, int):
                by_model[data.get("model") or "unknown"] += output_tokens

    if not by_model:
        return None

    return (
        [
            {
                "model": model,
                "input_tokens": None,
                "output_tokens": output_tokens,
                "cache_read_tokens": None,
                "cache_write_tokens": None,
                "reasoning_tokens": None,
                "github_ai_credits_nano": None,
            }
            for model, output_tokens in sorted(by_model.items())
        ],
        "events-jsonl-output-only",
    )


def usage_totals(by_model: list[dict[str, Any]]) -> dict[str, int | None]:
    fields = (
        "input_tokens",
        "output_tokens",
        "cache_read_tokens",
        "cache_write_tokens",
        "reasoning_tokens",
        "github_ai_credits",
    )
    return {
        field: (
            sum(entry[field] for entry in by_model)
            if all(entry[field] is not None for entry in by_model)
            else None
        )
        for field in fields
    }


def send_payload(webhook_url: str, payload: dict[str, Any]) -> int:
    result = subprocess.run(
        [
            "curl",
            "--fail",
            "--silent",
            "--show-error",
            "--max-time",
            "8",
            "--request",
            "POST",
            "--header",
            "Content-Type: application/json",
            "--data-binary",
            "@-",
            webhook_url,
        ],
        check=False,
        input=json.dumps(payload),
        text=True,
    )
    if result.returncode:
        print(
            f"Copilot usage webhook request failed with exit code {result.returncode}.",
            file=sys.stderr,
        )
    return result.returncode


def main() -> int:
    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError as error:
        print(f"Invalid agentStop hook input: {error}", file=sys.stderr)
        return 2

    session_id = hook_input.get("sessionId") or hook_input.get("session_id")
    if not isinstance(session_id, str) or not session_id:
        print("agentStop hook input does not contain a session ID.", file=sys.stderr)
        return 2

    cwd = Path(hook_input.get("cwd") or os.getcwd()).resolve()
    copilot_home = Path(os.environ.get("COPILOT_HOME", Path.home() / ".copilot"))
    usage = query_usage_store(copilot_home / "session-store.db", session_id)
    if usage is None:
        usage = usage_from_events(
            copilot_home / "session-state" / session_id / "events.jsonl"
        )

    by_model, source = usage if usage else ([], "unavailable")
    payload = {
        "event": "copilot.agent_stop",
        "session": {"id": session_id},
        "interaction": {
            "captured_at": hook_input.get("timestamp"),
            "stop_reason": hook_input.get("stopReason"),
        },
        "repository": repository_metadata(cwd),
        "usage": {
            "source": source,
            "tokens": usage_totals(by_model),
            "by_model": by_model,
        },
    }
    webhook_url = os.environ.get("COPILOT_USAGE_WEBHOOK_URL", DEFAULT_WEBHOOK_URL)
    return send_payload(webhook_url, payload)


if __name__ == "__main__":
    raise SystemExit(main())
