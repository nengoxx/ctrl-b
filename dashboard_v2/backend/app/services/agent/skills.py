"""File-discovered skills + the default selection strategy (DESIGN §5.6, D10/D11).

`FileSkillProvider` scans a `skills/` directory for `<name>/SKILL.md` bundles, parsing the YAML
frontmatter (`name`/`description`/`allowed_tools`) and the markdown body (the instructions). A
malformed skill is skipped (logged), never fatal — like the per-server isolation elsewhere.

`KeywordSkillSelector` is the swappable default `SkillSelector` (D11): it matches the user message
against each skill's name + description (token overlap), returning those over a small threshold.
It's model-agnostic (no extra LLM call, works with a weak local model) and deterministic; an
`LLMSkillSelector` that asks the model to pick is the documented drop-in alternative.

`available_skills` computes one agent's effective set — its own `agents/<name>/skills/` (always
available) merged over the global `skills/` it inherits via its `skills` allowlist (7e-f-1, D14).
`resolve_skills` then unions the *user-invoked* `/skill-name` (always honored) with the selector's
*model-invoked* picks over that set; `narrow_tools` turns the active set into a narrowed allowlist.
"""

from __future__ import annotations

import logging
import re
from fnmatch import fnmatch
from pathlib import Path
from typing import TYPE_CHECKING

import yaml

from app.core.fsutil import write_text_eol
from app.core.skills import Skill, SkillProvider, SkillSelector
from app.core.textmatch import rank_by_overlap

if TYPE_CHECKING:
    from app.config import Settings
    from app.domain.agent import AgentDef

log = logging.getLogger(__name__)

#: A skill folder name: lowercase slug, no path separators — guards the file write below (and the
#: `/api/skills` + `/api/agents` endpoints, which import it) against traversal: the name becomes
#: `<root>/<name>/SKILL.md`. Agent names reuse the same shape.
SKILL_SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def valid_skill_slug(name: str) -> bool:
    """Whether `name` is a safe skill/agent folder slug (one source of truth for the API + tool)."""
    return bool(SKILL_SLUG.match(name))

_FRONTMATTER = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.DOTALL)


def _parse_skill_md(path: Path, fallback_name: str) -> Skill | None:
    """Parse a `SKILL.md`: optional `---`-fenced YAML frontmatter then a markdown body. Missing
    frontmatter → the whole file is the instructions and the folder name is the skill name."""
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        log.warning("skill %s: unreadable (%s)", path, exc)
        return None
    meta: dict = {}
    body = raw
    m = _FRONTMATTER.match(raw)
    if m:
        try:
            parsed = yaml.safe_load(m.group(1)) or {}
            if isinstance(parsed, dict):
                meta = parsed
        except yaml.YAMLError as exc:
            log.warning("skill %s: bad frontmatter (%s)", path, exc)
        body = m.group(2)
    allowed = meta.get("allowed_tools")
    if isinstance(allowed, str):
        allowed = [allowed]
    return Skill(
        name=str(meta.get("name") or fallback_name),
        description=str(meta.get("description") or ""),
        instructions=body.strip(),
        allowed_tools=list(allowed) if allowed else None,
        resources_dir=path.parent,
    )


class FileSkillProvider(SkillProvider):
    """Scans `root/<name>/SKILL.md`. Re-reads on each `list()` (a single user, a handful of files —
    cheap, and it means a dropped-in skill is live without a restart)."""

    def __init__(self, root: Path) -> None:
        self._root = root

    def list(self) -> list[Skill]:
        if not self._root.is_dir():
            return []
        out: list[Skill] = []
        for child in sorted(self._root.iterdir()):
            md = child / "SKILL.md"
            if child.is_dir() and md.is_file():
                skill = _parse_skill_md(md, child.name)
                if skill is not None:
                    out.append(skill)
        return out

    def get(self, name: str) -> Skill | None:
        return next((s for s in self.list() if s.name == name), None)


class KeywordSkillSelector(SkillSelector):
    """Default selector (D11): score each skill by token overlap between the user message and the
    skill's name + description; return those scoring at least `min_overlap`, best first, capped at
    `max_skills`. Deterministic and model-agnostic — swap in an LLM-based selector for richer
    matching later. Scoring is the shared `core.textmatch.rank_by_overlap` (one source of truth with
    the agent selector)."""

    def __init__(self, min_overlap: int = 1, max_skills: int = 2) -> None:
        self._min = min_overlap
        self._max = max_skills

    def select(self, user_msg: str, skills: list[Skill]) -> list[Skill]:
        ranked = rank_by_overlap(
            user_msg, skills, lambda s: f"{s.name} {s.description}", min_overlap=self._min
        )
        return [s for _, s in ranked[: self._max]]


def _allowed_by(allow: list[str] | str, name: str) -> bool:
    return allow == "*" or any(fnmatch(name, p) for p in allow)


def available_skills(
    global_provider: SkillProvider, settings: "Settings", agent: "AgentDef"
) -> list[Skill]:
    """The effective skill set for one agent (7e-f-1, D14): the agent's OWN `agents/<name>/skills/`
    (always available) merged over the GLOBAL `skills/` it inherits. Global inheritance reuses the
    agent's existing `skills` allowlist — `"*"` inherits all, a list a subset, `[]` none — so there's
    no separate inherit knob. An own skill overrides an inherited one of the same name. The
    default/root agent IS the global set (it has no own folder), so it just gets the global skills its
    own allowlist permits."""
    by_name = {s.name: s for s in global_provider.list() if _allowed_by(agent.skills, s.name)}
    if agent.name != settings.DEFAULT_AGENT_NAME:
        for s in FileSkillProvider(agent_skills_root(settings, agent)).list():
            by_name[s.name] = s  # own overrides an inherited skill of the same name
    return list(by_name.values())


def agent_skills_root(settings: "Settings", agent: "AgentDef") -> Path:
    """The directory holding an agent's OWN `<name>/SKILL.md` bundles — where `skill_manage` writes
    (7e-f-2). The default/root agent owns the global `skills/` (so it edits the shared set); a
    specialist owns `agents/<slug>/skills/`. Mirrors `available_skills`'s own-folder path so a
    self-authored skill lands exactly where that resolver picks it up next turn."""
    if agent.name == settings.DEFAULT_AGENT_NAME:
        return settings.skills_dir_path()
    return settings.agents_dir_path() / agent.name / "skills"


def write_skill_md(root: Path, name: str, content: str) -> None:
    """Create/overwrite `root/<name>/SKILL.md` with `content`, EOL-preserving + atomic. The single
    write path for both the `/api/skills` editor and the `skill_manage` tool. Caller validates the
    slug (`valid_skill_slug`) and supplies the full markdown (incl. any scaffold default)."""
    p = root / name / "SKILL.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    write_text_eol(p, content)


def remove_skill_md(root: Path, name: str) -> bool:
    """Delete `root/<name>/SKILL.md`, returning whether it was present. Cleans up the folder only if
    it's left empty — owner-dropped resource files (assets, scripts) are preserved."""
    p = root / name / "SKILL.md"
    if not p.is_file():
        return False
    p.unlink()
    try:
        p.parent.rmdir()  # only succeeds when empty — keep any sibling resources
    except OSError:
        pass
    return True


def resolve_skills(
    available: list[Skill],
    selector: SkillSelector,
    user_msg: str,
    *,
    invoked: list[str] | None = None,
) -> list[Skill]:
    """The active skills for a turn over an agent's effective set (`available_skills`): user-invoked
    `/skill-name` (always, if present) unioned with the selector's model-invoked picks. Order:
    invoked first (explicit intent), then selected; de-duplicated by name."""
    by_name = {s.name: s for s in available}
    active: list[Skill] = []
    seen: set[str] = set()
    for name in invoked or []:
        s = by_name.get(name)
        if s and s.name not in seen:
            active.append(s)
            seen.add(s.name)
    for s in selector.select(user_msg, available):
        if s.name not in seen:
            active.append(s)
            seen.add(s.name)
    return active


def skills_prompt(active: list[Skill]) -> str | None:
    """Render the active skills' instructions as a system-prompt addition, or `None` if empty."""
    if not active:
        return None
    blocks = [
        f"## Skill: {s.name}\n{s.instructions}" for s in active if s.instructions
    ]
    if not blocks:
        return None
    return (
        "The following skill instructions apply to this task — follow them:\n\n"
        + "\n\n".join(blocks)
    )


def narrow_tools(active: list[Skill], agent_allow: list[str] | str) -> list[str] | str:
    """Intersect the agent's tool allowlist with the union of active skills' `allowed_tools`. A
    skill may narrow the toolset, never widen it (§5.6). If no active skill sets `allowed_tools`,
    the agent's allowlist is returned unchanged. The result is a concrete name list (resolved
    against the agent allowlist) or `"*"` when nothing narrows."""
    restricting = [s.allowed_tools for s in active if s.allowed_tools]
    if not restricting:
        return agent_allow
    union = {name for tools in restricting for name in tools}
    if agent_allow == "*":
        return sorted(union)
    # Keep only skill-requested tools the agent is also allowed (by glob) — never widen.
    return sorted(n for n in union if _allowed_by(agent_allow, n))
