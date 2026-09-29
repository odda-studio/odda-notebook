"""Notebook chat retrieval mode: passages from vector search instead of whole sources."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage

from open_notebook.utils import context_builder


def row(parent, similarity, content, id=None, title=None):
    return {"id": id or parent, "parent": parent, "title": title or parent,
            "similarity": similarity, "content": content}


def fake_db(chunks=(), insights=(), notes=(), notebook_sources=(), notebook_notes=()):
    """repo_query stand-in routing by the SQL each retrieval step sends."""
    calls = []

    async def query(sql, params=None):
        calls.append((sql, params))
        if "FROM reference" in sql:
            return list(notebook_sources)
        if "FROM artifact" in sql:
            return list(notebook_notes)
        if "FROM source_embedding" in sql:
            return list(chunks)
        if "FROM source_insight" in sql:
            return list(insights)
        if "FROM note" in sql:
            return list(notes)
        raise AssertionError(sql)

    return query, calls


async def retrieve(db, **kwargs):
    query, calls = db
    with patch("open_notebook.database.repository.repo_query", side_effect=query), \
         patch("open_notebook.utils.embedding.generate_embedding", AsyncMock(return_value=[0.1])):
        context, kept = await context_builder.build_retrieval_context("notebook:1", "q", **kwargs)
    return context, kept, calls


class TestBuildRetrievalContext:
    @pytest.mark.asyncio
    async def test_insight_mode_searches_only_insights(self):
        db = fake_db(
            chunks=[row("source:a", 0.9, "raw text")],
            insights=[row("source:a", 0.4, "summary", id="source_insight:i")],
            notebook_sources=["source:a"],
        )
        context, kept, calls = await retrieve(db, full_source_ids=[], insight_source_ids=["source:a"])

        assert not any("FROM source_embedding" in sql for sql, _ in calls)
        assert kept == 1
        assert context["sources"] == [
            {"id": "source_insight:i", "title": "source:a", "similarity": 0.4, "passages": ["summary"]}
        ]

    @pytest.mark.asyncio
    async def test_insights_are_not_crowded_out_by_text_chunks(self):
        """Regression: chunks score higher than insights, and used to take
        every slot so the answer never saw the insights."""
        db = fake_db(
            chunks=[row("source:a", 0.9 - i / 100, f"chunk {i}") for i in range(10)],
            insights=[row("source:b", 0.41, "insight b", id="source_insight:b")],
            notebook_sources=["source:a", "source:b"],
        )
        context, kept, _ = await retrieve(
            db, full_source_ids=["source:a"], insight_source_ids=["source:b"], max_passages=3
        )
        ids = [e["id"] for e in context["sources"]]
        assert kept == 3 and ids == ["source:a", "source_insight:b"]
        assert context["sources"][0]["passages"] == ["chunk 0", "chunk 1"]

    @pytest.mark.asyncio
    async def test_items_outside_the_notebook_or_below_threshold_are_dropped(self):
        db = fake_db(
            chunks=[row("source:a", 0.1, "too weak")],
            notebook_sources=["source:a"],
        )
        context, kept, calls = await retrieve(
            db, full_source_ids=["source:a", "source:elsewhere"]
        )
        assert kept == 0 and context == {"sources": [], "notes": []}
        chunk_params = next(p for sql, p in calls if "FROM source_embedding" in sql)
        assert [str(s) for s in chunk_params["sources"]] == ["source:a"]

    @pytest.mark.asyncio
    async def test_nothing_selected_skips_the_embedding(self):
        db = fake_db(notebook_sources=["source:a"])
        query, _ = db
        with patch("open_notebook.database.repository.repo_query", side_effect=query), \
             patch("open_notebook.utils.embedding.generate_embedding", AsyncMock()) as embed:
            context, kept = await context_builder.build_retrieval_context(
                "notebook:1", "q", full_source_ids=[]
            )
        embed.assert_not_awaited()
        assert kept == 0

    @pytest.mark.asyncio
    async def test_notes_are_searched(self):
        db = fake_db(
            notes=[row("note:n", 0.5, "my note", id="note:n")],
            notebook_notes=["note:n"],
        )
        context, kept, _ = await retrieve(db, full_source_ids=[], note_ids=["note:n"])
        assert kept == 1 and [n["id"] for n in context["notes"]] == ["note:n"]


def test_follow_up_questions_include_the_previous_one():
    from api.routers.chat import _retrieval_query

    history = [HumanMessage(content="Who is Strahd?"), AIMessage(content="A vampire.")]
    assert _retrieval_query(history, "Where does he live?") == "Who is Strahd?\nWhere does he live?"
    assert _retrieval_query([], "First question") == "First question"


class TestExecuteRetrieval:
    def _client(self):
        from api.main import app

        return TestClient(app)

    def _patches(self, embedding_model):
        from api.routers import chat as chat_router

        session = SimpleNamespace(model_override=None, save=AsyncMock())
        notebook = SimpleNamespace(id="notebook:1")
        graph = MagicMock()
        graph.get_state.return_value = SimpleNamespace(values={"messages": []})
        graph.invoke.return_value = {"messages": [HumanMessage(content="q", id="m1"), AIMessage(content="a", id="m2")]}
        return graph, [
            patch.object(chat_router, "get_session_or_404",
                         AsyncMock(return_value=("chat_session:1", session))),
            patch.object(chat_router, "repo_query", AsyncMock(return_value=[{"out": "notebook:1"}])),
            patch.object(chat_router.Notebook, "get", AsyncMock(return_value=notebook)),
            patch.object(chat_router, "chat_graph", graph),
            patch.object(chat_router.model_manager, "get_embedding_model",
                         AsyncMock(return_value=embedding_model)),
        ]

    def test_retrieval_context_replaces_the_selected_context(self):
        from api.routers import chat as chat_router

        graph, patches = self._patches(embedding_model=object())
        retrieved = {"sources": [{"id": "source:a", "passages": ["p"]}], "notes": []}
        with patches[0], patches[1], patches[2], patches[3], patches[4], patch.object(
            chat_router, "build_retrieval_context", AsyncMock(return_value=(retrieved, 1))
        ) as build:
            response = self._client().post("/api/chat/execute", json={
                "session_id": "chat_session:1",
                "message": "q",
                "context": {"sources": [{"id": "source:a", "full_text": "huge"}], "notes": []},
                "retrieval": {
                    "enabled": True,
                    "source_modes": {"source:a": "full", "source:b": "insights"},
                    "note_ids": [],
                },
            })

        assert response.status_code == 200, response.text
        assert response.json()["retrieved_passages"] == 1
        assert build.await_args is not None
        assert build.await_args.kwargs["full_source_ids"] == ["source:a"]
        assert build.await_args.kwargs["insight_source_ids"] == ["source:b"]
        state = graph.invoke.call_args.kwargs["input"]
        assert state["context"] == retrieved and state["retrieval"] is True

    def test_retrieval_without_embedding_model_is_a_configuration_error(self):
        _, patches = self._patches(embedding_model=None)
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            response = self._client().post("/api/chat/execute", json={
                "session_id": "chat_session:1", "message": "q",
                "context": {"sources": [], "notes": []},
                "retrieval": {"enabled": True, "source_ids": ["source:a"]},
            })
        assert response.status_code == 422
        assert "embedding model" in response.json()["detail"]

    def test_default_mode_is_unchanged(self):
        graph, patches = self._patches(embedding_model=None)
        context = {"sources": [{"id": "source:a"}], "notes": []}
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            response = self._client().post("/api/chat/execute", json={
                "session_id": "chat_session:1", "message": "q", "context": context,
            })
        assert response.status_code == 200
        assert response.json()["retrieved_passages"] is None
        state = graph.invoke.call_args.kwargs["input"]
        assert state["context"] == context and state["retrieval"] is False
