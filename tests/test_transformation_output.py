"""Transformations with reasoning models and permanent job failures."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from open_notebook.exceptions import (
    PERMANENT_JOB_ERRORS,
    AuthenticationError,
    ConfigurationError,
    NotFoundError,
)
from open_notebook.graphs import transformation as tg


def chain(model_name, max_tokens=8192, content="", finish_reason="stop", reasoning=0):
    response = SimpleNamespace(
        content=content,
        response_metadata={
            "finish_reason": finish_reason,
            "token_usage": {"completion_tokens_details": {"reasoning_tokens": reasoning}},
        },
    )
    return SimpleNamespace(
        model_name=model_name, max_tokens=max_tokens, ainvoke=AsyncMock(return_value=response)
    )


def state():
    transformation = MagicMock(title="CV info", prompt="Extract", model_id="model:1", max_tokens=None)
    return {"input_text": "a CV", "transformation": transformation}


@pytest.mark.parametrize(
    "name,expected", [("gpt-5-nano", 32768), ("o3-mini", 32768), ("gpt-4o", 8192)]
)
def test_reasoning_models_get_a_larger_output_budget(name, expected):
    model = chain(name)
    tg._apply_output_budget(model, None)
    assert model.max_tokens == expected


def test_the_transformation_budget_wins():
    model = chain("gpt-5-nano")
    tg._apply_output_budget(model, 60000)
    assert model.max_tokens == 60000


@pytest.mark.asyncio
async def test_empty_output_from_spent_reasoning_budget_fails_with_a_clear_error():
    model = chain("gpt-5-nano", finish_reason="length", reasoning=32768)
    with patch.object(tg, "provision_langchain_model", AsyncMock(return_value=model)):
        with pytest.raises(ConfigurationError, match="32768 on reasoning"):
            await tg.run_transformation(state(), config={"configurable": {}})


@pytest.mark.asyncio
async def test_empty_output_is_never_saved_as_an_insight():
    model = chain("gpt-4o", content="  ")
    with patch.object(tg, "provision_langchain_model", AsyncMock(return_value=model)):
        with pytest.raises(ConfigurationError, match="empty response"):
            await tg.run_transformation(state(), config={"configurable": {}})


def test_auth_and_missing_records_are_not_retried():
    from commands.source_commands import (
        process_source_command,
        run_transformation_command,
    )

    for error in (AuthenticationError, NotFoundError, ConfigurationError):
        assert error in PERMANENT_JOB_ERRORS
    # the registered retry config uses the shared list
    from surreal_commands.core.registry import registry

    for name in ("run_transformation", "process_source"):
        item = registry.get_command_by_id(f"open_notebook.{name}")
        assert AuthenticationError in item.retry_config.stop_on
    assert process_source_command and run_transformation_command


def test_usage_is_built_from_standard_langchain_metadata():
    from open_notebook.utils.llm_usage import llm_usage

    response = SimpleNamespace(
        usage_metadata={
            "input_tokens": 5141, "output_tokens": 9000, "total_tokens": 14141,
            "output_token_details": {"reasoning": 7000}, "input_token_details": {"cache_read": 0},
        },
        response_metadata={"finish_reason": "stop", "model_name": "gpt-5-nano-2025-08-07"},
    )
    usage = llm_usage(chain("gpt-5-nano", max_tokens=32768), response, 5100, 12.345)
    assert usage == {
        "model": "gpt-5-nano-2025-08-07", "input_tokens": 5141, "output_tokens": 9000,
        "reasoning_tokens": 7000, "cached_input_tokens": 0, "total_tokens": 14141,
        "max_output_tokens": 32768, "prompt_tokens_estimate": 5100,
        "finish_reason": "stop", "duration_seconds": 12.35,
    }


@pytest.mark.asyncio
async def test_usage_is_recorded_even_when_the_output_is_empty():
    model = chain("gpt-5-nano", finish_reason="length", reasoning=32768)
    with (
        patch.object(tg, "provision_langchain_model", AsyncMock(return_value=model)),
        patch.object(tg, "record_llm_usage", AsyncMock()) as record,
    ):
        with pytest.raises(ConfigurationError):
            await tg.run_transformation(state(), config={"configurable": {}})
    usage = record.await_args_list[0].args[0]
    assert usage["finish_reason"] == "length" and usage["max_output_tokens"] == 32768


@pytest.mark.asyncio
async def test_usage_travels_with_the_insight():
    model = chain("gpt-4o", content="the insight")
    source = MagicMock(spec=tg.Source)
    source.add_insight = AsyncMock()
    st = {**state(), "source": source}
    with (
        patch.object(tg, "provision_langchain_model", AsyncMock(return_value=model)),
        patch.object(tg, "record_llm_usage", AsyncMock()),
    ):
        result = await tg.run_transformation(st, config={"configurable": {}})
    assert source.add_insight.await_args.kwargs["usage"] == result["usage"]
    assert result["usage"]["model"] == "gpt-4o"


@pytest.mark.asyncio
async def test_record_llm_usage_appends_to_the_job():
    from open_notebook.utils import job_progress as jp

    with patch("open_notebook.database.repository.repo_query", AsyncMock()) as query:
        await jp.record_llm_usage({"model": "x"})  # outside a job: nothing
        with jp.bind_job("command:1"):
            await jp.record_llm_usage({"model": "x"})
    assert query.await_count == 1 and "llm_usage" in query.await_args_list[0].args[0]


@pytest.mark.parametrize(
    "message",
    [
        "Error code: 400 - {'error': {'message': 'max_tokens is too large: 100000. This model "
        "supports at most 16384 completion tokens, whereas you provided 100000.'}}",
        "max_tokens: 100000 > 64000, which is the maximum allowed number of output tokens",
    ],
)
def test_output_limit_above_the_model_maximum_is_a_settings_error(message):
    from open_notebook.utils.error_classifier import classify_error

    error_class, text = classify_error(Exception(message))
    assert error_class is ConfigurationError
    assert "(100000)" in text and "Max output tokens" in text
