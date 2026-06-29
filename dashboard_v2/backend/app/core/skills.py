"""Skills — reusable instruction bundles the agent can pull in for a task (DESIGN §5.6, D10).

A `Skill` is a `skills/<name>/SKILL.md` file: YAML frontmatter (`name`/`description`/optional
`allowed_tools`) + a markdown instructions body, plus optional sibling resource files. Adding a
skill = dropping a folder — no code change (the D8 "extensible by config" principle, for prompts).

Two seams, both `Protocol`s with a swappable default (D11):
- `SkillProvider.list()` discovers the available skills.
- `SkillSelector.select(...)` decides which apply to a turn — *model-invoked* by matching the user
  message against each skill's description (the default), on top of any *user-invoked* `/skill-name`.

Selected skills inject their `instructions` into the assembled system prompt and may **narrow** the
toolset to `allowed_tools` (intersected with the agent's allowlist — never widened, §5.6).
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol, runtime_checkable

from pydantic import BaseModel


class Skill(BaseModel):
    """One discovered skill. `allowed_tools` (when set) narrows the agent's toolset while the skill
    is active; `None` means "don't narrow". `resources_dir` points at the skill folder so its
    instructions can reference sibling files (scripts, templates) the owner dropped in."""

    name: str
    description: str = ""
    instructions: str = ""
    allowed_tools: list[str] | None = None
    resources_dir: Path | None = None

    model_config = {"arbitrary_types_allowed": True}


@runtime_checkable
class SkillProvider(Protocol):
    """Discovers the available skills. The file-based default scans `skills/<name>/SKILL.md`."""

    def list(self) -> list[Skill]: ...

    def get(self, name: str) -> Skill | None: ...


@runtime_checkable
class SkillSelector(Protocol):
    """Picks which skills apply to a turn (the swappable strategy, D11). The default matches the
    user message against each skill's name/description; an LLM-based selector is a drop-in."""

    def select(self, user_msg: str, skills: list[Skill]) -> list[Skill]: ...
