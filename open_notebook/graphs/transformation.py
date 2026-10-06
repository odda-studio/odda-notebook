import time
from typing import Any, Dict, Optional

from ai_prompter import Prompter
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from typing_extensions import NotRequired, TypedDict

from open_notebook.ai.provision import provision_langchain_model
from open_notebook.domain.notebook import Source
from open_notebook.domain.transformation import DefaultPrompts, Transformation
from open_notebook.exceptions import ConfigurationError, OpenNotebookError
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.error_classifier import classify_error
from open_notebook.utils.job_progress import record_llm_usage, report_progress
from open_notebook.utils.llm_usage import llm_usage, model_name
from open_notebook.utils.text_utils import extract_text_content
from open_notebook.utils.token_utils import token_count


class TransformationState(TypedDict):
    input_text: str
    source: Source
    transformation: Transformation
    output: str
    # token usage of the model call (open_notebook/utils/llm_usage.py)
    usage: NotRequired[Dict[str, Any]]


TRANSFORMATION_MAX_TOKENS = 8192
# Reasoning models (OpenAI o-series, gpt-5) count their hidden reasoning in the
# output budget: with a long prompt they can spend all of it thinking and
# return no text, so they get a larger one.
REASONING_MODEL_PREFIXES = ("o1", "o3", "o4", "gpt-5")
REASONING_MAX_TOKENS = 32768


def _apply_output_budget(chain: Any, max_tokens: Optional[int]) -> None:
    """The transformation's own budget wins; otherwise reasoning models get
    REASONING_MAX_TOKENS instead of TRANSFORMATION_MAX_TOKENS."""
    if max_tokens:
        if hasattr(chain, "max_tokens"):
            chain.max_tokens = max_tokens
        return
    budget = getattr(chain, "max_tokens", None)
    if (
        model_name(chain).startswith(REASONING_MODEL_PREFIXES)
        and isinstance(budget, int)
        and budget < REASONING_MAX_TOKENS
    ):
        chain.max_tokens = REASONING_MAX_TOKENS


def _empty_output_error(chain: Any, response: Any) -> ConfigurationError:
    """Permanent error for a model that returned no text (retrying won't help)."""
    name = model_name(chain) or "The model"
    metadata = getattr(response, "response_metadata", None) or {}
    if metadata.get("finish_reason") == "length":
        usage = metadata.get("token_usage") or {}
        reasoning = (usage.get("completion_tokens_details") or {}).get("reasoning_tokens")
        spent = f" ({reasoning} on reasoning)" if reasoning else ""
        return ConfigurationError(
            f"{name} used its whole output budget of {getattr(chain, 'max_tokens', '?')} "
            f"tokens{spent} and returned no text. Raise *Max output tokens* in the "
            "transformation settings, choose a model without reasoning (e.g. "
            "gpt-4o-mini), or shorten its prompt."
        )
    return ConfigurationError(
        f"{name} returned an empty response. Try again or choose another model "
        "for this transformation."
    )


async def run_transformation(state: dict, config: RunnableConfig) -> dict:
    source_obj = state.get("source")
    source: Source = source_obj if isinstance(source_obj, Source) else None  # type: ignore[assignment]
    content = state.get("input_text")
    assert source or content, "No content to transform"
    transformation: Transformation = state["transformation"]

    try:
        if not content:
            content = source.full_text
        # transformation.prompt is user-controlled free text. Never compile it as
        # Jinja template *source* (Prompter(template_text=...)) - pass it as a
        # plain render variable into a fixed, developer-authored template instead.
        # See docs/7-DEVELOPMENT/security.md (GHSA-f35w-wx37-26q7).
        instructions = transformation.prompt
        default_prompts: DefaultPrompts = DefaultPrompts(transformation_instructions=None)
        if default_prompts.transformation_instructions:
            instructions = f"{default_prompts.transformation_instructions}\n\n{instructions}"

        system_prompt = Prompter(prompt_template="transformation/execute").render(
            data={**state, "instructions": instructions}
        )
        content_str = str(content) if content else ""
        payload = [SystemMessage(content=system_prompt), HumanMessage(content=content_str)]
        chain = await provision_langchain_model(
            str(payload),
            config.get("configurable", {}).get("model_id"),
            "transformation",
            max_tokens=transformation.max_tokens or TRANSFORMATION_MAX_TOKENS,
        )
        _apply_output_budget(chain, transformation.max_tokens)

        estimate = token_count(system_prompt) + token_count(content_str)
        await report_progress(
            "calling_model",
            f"{transformation.title} · {model_name(chain)} · ~{estimate} tokens in · "
            f"max {getattr(chain, 'max_tokens', None) or '?'} out",
        )
        started = time.monotonic()
        response = await chain.ainvoke(payload)
        usage = llm_usage(chain, response, estimate, time.monotonic() - started)
        # recorded before validating the output: a failed call shows its usage too
        await record_llm_usage(usage)

        # Clean thinking content from the response
        response_content = extract_text_content(response.content)
        cleaned_content = clean_thinking_content(response_content)
        if not cleaned_content or not cleaned_content.strip():
            raise _empty_output_error(chain, response)

        if source:
            await report_progress("saving_insight", transformation.title)
            await source.add_insight(
                transformation.title, cleaned_content, transformation.id, usage=usage
            )

        return {
            "output": cleaned_content,
            "usage": usage,
        }
    except OpenNotebookError:
        raise
    except Exception as e:
        error_class, user_message = classify_error(e)
        raise error_class(user_message) from e


agent_state = StateGraph(TransformationState)
agent_state.add_node("agent", run_transformation)  # type: ignore[type-var]
agent_state.add_edge(START, "agent")
agent_state.add_edge("agent", END)
graph = agent_state.compile()
