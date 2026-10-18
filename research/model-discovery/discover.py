"""Search public research APIs; keep reported facts and request failures explicit."""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import importlib.metadata
import json
import os
from pathlib import Path
from typing import Any

import httpx
from huggingface_hub import HfApi


def plain(value: Any) -> Any:
    # Hub CardData has an explicit serializer: inherited dataclass fields alone
    # omit its dynamic metadata, including licenses and evaluation results.
    if hasattr(value, "to_dict"):
        return plain(value.to_dict())
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return plain(dataclasses.asdict(value))
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if isinstance(value, dt.datetime):
        return value.isoformat()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def hub_record(info: Any, kind: str) -> dict:
    card = plain(getattr(info, "card_data", None))
    return {
        "id": info.id,
        "url": f"https://huggingface.co/{'datasets/' if kind == 'datasets' else ''}{info.id}",
        "revision": getattr(info, "sha", None),
        "task": getattr(info, "pipeline_tag", None),
        "library": getattr(info, "library_name", None),
        "downloads": getattr(info, "downloads", None),
        "tags": getattr(info, "tags", None),
        "gated": getattr(info, "gated", None),
        "card_data_reported_by_author": card,
        "evaluation_results_reported_by_author": plain(getattr(info, "eval_results", None)),
        "license_reported_by_author": card.get("license") if isinstance(card, dict) else None,
        "listed_files": [getattr(f, "rfilename", None) for f in (getattr(info, "siblings", None) or [])],
        "validation_in_moving_camera": "not evaluated by this search",
    }


def error_record(source: str, query: str, exc: Exception) -> dict:
    response = getattr(exc, "response", None)
    return {
        "source": source,
        "query": query,
        "error_type": type(exc).__name__,
        "http_status": getattr(response, "status_code", None),
        # Exception strings may contain authenticated URLs. Keep useful status
        # information without persisting API keys or request headers.
        "message": getattr(response, "reason_phrase", None) or type(exc).__name__,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("queries.json"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--sources", nargs="+", choices=["hub", "papers"], default=["hub", "papers"])
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    now = dt.datetime.now(dt.timezone.utc)
    output = args.output or Path(__file__).parent / "runs" / now.strftime("%Y%m%dT%H%M%SZ")
    output.mkdir(parents=True, exist_ok=True)
    results: dict[str, Any] = {
        "started_at_utc": now.isoformat(),
        "config": config,
        "versions": {p: importlib.metadata.version(p) for p in ["huggingface-hub", "httpx"]},
        "queries": [], "errors": [],
        "scope": "Discovery and author-reported metadata only; no model inference or agronomic validation.",
    }

    # A throttled service is skipped for the rest of this run, with the failure preserved.
    blocked: set[str] = set()
    if "hub" in args.sources:
        api = HfApi(token=False)
        for query in config.get("hub_queries", []):
            for kind in ["models", "datasets"]:
                if "huggingface" in blocked:
                    results["queries"].append({"source": kind, "query": query, "status": "skipped_after_rate_limit"})
                    continue
                try:
                    method = api.list_models if kind == "models" else api.list_datasets
                    kwargs: dict[str, Any] = {"search": query, "limit": config.get("limit_per_query", 10), "full": True}
                    if kind == "models":
                        kwargs["cardData"] = True
                    records = [hub_record(x, kind) for x in method(**kwargs)]
                    results["queries"].append({"source": kind, "query": query, "status": "ok", "items": records})
                    print(f"Hugging Face {kind}: {query}: {len(records)} results", flush=True)
                except Exception as exc:
                    error = error_record("huggingface", query, exc)
                    results["errors"].append(error)
                    if error["http_status"] == 429:
                        blocked.add("huggingface")
                    print(f"Hugging Face {kind}: {query}: {error['error_type']}", flush=True)

    if "papers" in args.sources:
        api_key = os.environ.get("SEMANTIC_SCHOLAR_API_KEY")
        headers = {"x-api-key": api_key} if api_key else {}
        with httpx.Client(timeout=25, headers=headers, follow_redirects=True) as client:
            for query in config.get("paper_queries", []):
                if "semantic_scholar" in blocked:
                    results["queries"].append({"source": "semantic_scholar", "query": query, "status": "skipped_after_rate_limit"})
                    continue
                try:
                    response = client.get(
                        "https://api.semanticscholar.org/graph/v1/paper/search",
                        params={"query": query, "limit": config.get("paper_limit_per_query", 5),
                                "fields": "title,year,abstract,url,openAccessPdf,externalIds"},
                    )
                    response.raise_for_status()
                    data = response.json()
                    results["queries"].append({"source": "semantic_scholar", "query": query, "status": "ok", "response": data})
                    print(f"Semantic Scholar: {query}: {len(data.get('data', []))} results", flush=True)
                except Exception as exc:
                    error = error_record("semantic_scholar", query, exc)
                    results["errors"].append(error)
                    if error["http_status"] in {401, 403, 429}:
                        blocked.add("semantic_scholar")
                    print(f"Semantic Scholar: {query}: {error['error_type']} ({error['http_status']})", flush=True)

        # Independently query a second literature catalog. Its responses keep
        # the provider identity; a failed service is never reported as success.
        openalex_key = os.environ.get("OPENALEX_API_KEY")
        with httpx.Client(timeout=25, follow_redirects=True) as client:
            for query in config.get("paper_queries", []):
                if "openalex" in blocked:
                    results["queries"].append({"source": "openalex", "query": query, "status": "skipped_after_rate_limit"})
                    continue
                try:
                    params = {"search": query, "per-page": config.get("paper_limit_per_query", 5)}
                    if openalex_key:
                        params["api_key"] = openalex_key
                    response = client.get("https://api.openalex.org/works", params=params)
                    response.raise_for_status()
                    data = response.json()
                    results["queries"].append({"source": "openalex", "query": query, "status": "ok", "response": data})
                    print(f"OpenAlex: {query}: {len(data.get('results', []))} results", flush=True)
                except Exception as exc:
                    error = error_record("openalex", query, exc)
                    results["errors"].append(error)
                    if error["http_status"] in {401, 403, 429}:
                        blocked.add("openalex")
                    print(f"OpenAlex: {query}: {error['error_type']} ({error['http_status']})", flush=True)

    results["finished_at_utc"] = dt.datetime.now(dt.timezone.utc).isoformat()
    (output / "results.json").write_text(json.dumps(plain(results), ensure_ascii=False, indent=2) + "\n")
    unique_models = {item["id"] for q in results["queries"] if q["source"] == "models" for item in q.get("items", [])}
    unique_datasets = {item["id"] for q in results["queries"] if q["source"] == "datasets" for item in q.get("items", [])}
    paper_records = sum(len(q.get("response", {}).get("results", q.get("response", {}).get("data", [])))
                        for q in results["queries"] if q["source"] in {"openalex", "semantic_scholar"})
    summary = {"output": str(output), "unique_models": len(unique_models), "unique_datasets": len(unique_datasets),
               "paper_records": paper_records, "request_errors": len(results["errors"])}
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
