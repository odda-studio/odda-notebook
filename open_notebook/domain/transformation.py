from typing import Any, ClassVar, Dict, List, Optional

from pydantic import Field, field_validator

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.base import ObjectModel, RecordModel


class TransformationGroup(ObjectModel):
    """A folder for transformations (one level; see migration 27)."""

    table_name: ClassVar[str] = "transformation_group"
    name: str

    @classmethod
    async def find_by_name(cls, name: str) -> Optional["TransformationGroup"]:
        rows = await repo_query(
            "SELECT * FROM transformation_group "
            "WHERE string::lowercase(name) = string::lowercase($name) LIMIT 1",
            {"name": name},
        )
        return cls(**rows[0]) if rows else None

    async def get_transformations(self) -> List["Transformation"]:
        rows = await repo_query(
            "SELECT * FROM transformation WHERE group_id = $group",
            {"group": ensure_record_id(str(self.id))},
        )
        return [Transformation(**row) for row in rows]


class Transformation(ObjectModel):
    table_name: ClassVar[str] = "transformation"
    nullable_fields: ClassVar[set[str]] = {"model_id", "group_id", "max_tokens"}
    name: str
    title: str
    description: str
    prompt: str
    apply_default: bool
    model_id: Optional[str] = None
    group_id: Optional[str] = None
    # Output budget of the model call; None = automatic (see graphs/transformation.py)
    max_tokens: Optional[int] = None

    @field_validator("group_id", mode="before")
    @classmethod
    def _stringify_group(cls, value):
        return str(value) if value is not None else value

    def _prepare_save_data(self) -> Dict[str, Any]:
        data = super()._prepare_save_data()
        if data.get("model_id"):
            data["model_id"] = ensure_record_id(data["model_id"])
        if data.get("group_id"):
            data["group_id"] = ensure_record_id(data["group_id"])
        return data


class DefaultPrompts(RecordModel):
    record_id: ClassVar[str] = "open_notebook:default_prompts"
    transformation_instructions: Optional[str] = Field(
        None, description="Instructions for executing a transformation"
    )
