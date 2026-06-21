"""Token-overlap text matching — the one deterministic, model-agnostic matcher shared by the default
skill selector (`KeywordSkillSelector`) and agent selector (`KeywordAgentSelector`, 7e-g, D15 #8).

No LLM call: tokenize two strings (lowercased word runs, stopwords + ≤2-char tokens dropped) and count
the shared tokens. A richer LLM/embeddings ranker is a drop-in at the *selector* layer; this stays the
cheap default and means there's a single source of truth for the scoring (no second copy to drift).
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import TypeVar

_WORD = re.compile(r"[a-z0-9]+")
#: Stopwords stripped before token-overlap scoring so common verbs don't trigger every match.
_STOP = frozenset(
    "the a an and or of to for in on with my me you it is are be can please help how do i".split()
)

T = TypeVar("T")


def tokens(text: str) -> set[str]:
    """The scoring tokens of `text`: lowercased word runs, minus stopwords and tokens of ≤2 chars."""
    return {w for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 2}


def rank_by_overlap(
    query: str,
    items: list[T],
    text_of: Callable[[T], str],
    *,
    min_overlap: int = 1,
) -> list[tuple[int, T]]:
    """Score each item by how many tokens its `text_of(item)` shares with `query`; keep those scoring
    at least `min_overlap`, highest first. The sort is stable, so ties preserve `items` order. An
    empty/all-stopword `query` yields `[]` (nothing to match on)."""
    q = tokens(query)
    if not q:
        return []
    scored = [(len(q & tokens(text_of(it))), it) for it in items]
    scored = [(n, it) for n, it in scored if n >= min_overlap]
    scored.sort(key=lambda t: t[0], reverse=True)
    return scored
