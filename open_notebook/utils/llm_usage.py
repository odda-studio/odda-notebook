"""
Token usage of one LLM call, recorded so users can see how much of the
model's context and output budget a job really used (activity view, insights,
transformation playground).

Built from LangChain's standard ``usage_metadata`` (input/output tokens,
reasoning details) plus ``response_metadata`` (finish reason, served model),
so it works across providers; fields a provider doesn't report stay None.
"""

from typing import Any, Dict, Optional


def _int(value: Any) -> Optional[int]:
    return int(value) if isinstance(value, (int, float)) else None


def model_name(chain: Any) -> str:
    return str(getattr(chain, "model_name", None) or getattr(chain, "model", None) or "")


def llm_usage(
    chain: Any,
    response: Any,
    prompt_tokens_estimate: Optional[int],
    duration_seconds: float,
) -> Dict[str, Any]:
    usage = getattr(response, "usage_metadata", None) or {}
    metadata = getattr(response, "response_metadata", None) or {}
    output_details = usage.get("output_token_details") or {}
    input_details = usage.get("input_token_details") or {}
    return {
        "model": metadata.get("model_name") or model_name(chain) or None,
        "input_tokens": _int(usage.get("input_tokens")),
        "output_tokens": _int(usage.get("output_tokens")),
        "reasoning_tokens": _int(output_details.get("reasoning")),
        "cached_input_tokens": _int(input_details.get("cache_read")),
        "total_tokens": _int(usage.get("total_tokens")),
        "max_output_tokens": _int(getattr(chain, "max_tokens", None)),
        "prompt_tokens_estimate": prompt_tokens_estimate,
        "finish_reason": metadata.get("finish_reason") or metadata.get("stop_reason"),
        "duration_seconds": round(duration_seconds, 2),
    }
