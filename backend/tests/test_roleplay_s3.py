"""Phase 23 / D70 slice S3 — the lorebook subsystem (ROLEPLAY_PLAN §6).

Four things land here, and each one has a rule that is easy to break silently:

  1. **The scan** (§6.3) — the haystack is the incoming message ONCE plus the last `scan_depth`
     PRIOR chat messages. The pin that proves it is `test_the_scan_window_reaches_the_oldest…`: it
     puts the only copy of a key in the OLDEST message of the window, which a post-persist
     `history[-scan_depth:]` would have pushed out (Emma F11's double-scan defect, from the other
     side — the symptom of scanning the current message twice is a real prior message going missing).
  2. **The budget** (§6.4) — ONE global pass over both positions, evicting lowest `priority` (null ⇒
     `order`), and the FRAMING IS NOT MEASURED. Both halves are pinned, because "the block is over
     budget" and "the entries are over budget" are different sentences.
  3. **Placement** — the head block sits after the skills note and BEFORE the named example
     messages (their `name` terminates the coalescing run, so a block after them would be re-roled
     as mid-history text), and the tail block sits before `post_history`.
  4. **Import** (§6.5) — the three circulating shapes, the alias table, and the POSITION DOWNGRADE,
     which must never be silent: every collapsed entry gets a report line naming it.

The §6.7 test book is AUTHORED here rather than copied from the field: it exercises one v1 mechanism
per entry, so a failure names the mechanism. The owner's real ST book is the S7 device-round target
and is deliberately not in the repo.

Assembly runs on the S0 helpers (one source of truth for the head shape); the API/import half runs on
S2's `home` fixture. Every write goes to a temp `$CTRLB_HOME` — never the operator's config.yaml.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml
from _async import run_async
from fastapi.testclient import TestClient
from test_roleplay_s0 import _agent, _client, _session, _systems, _workspace
from test_roleplay_s2 import agent_yaml, home, imported, make_client, v3
from test_steer_drain_a_d41 import _Fake, _no_compact, _text

from app.domain.conversation import Message, TextPart, Thread
from app.domain.enums import Actor
from app.services.agent.prompts import REGISTRY

__all__ = ["home"]  # the temp-workspace fixture is imported, not redefined


# ── the §6.7 test book: one entry per v1 mechanism ────────────────────────────────────────────────

KEEP = "The cartographer's own chart. " * 10  # 300 chars — the survivor of the eviction pair
DROP = "A copyist's tracing of it. " * 11  # 297 chars — the sacrifice

TEST_BOOK: dict[str, Any] = {
    "name": "The Hollow Sea",
    "description": "The S3 fixture — one v1 mechanism per entry (§6.7).",
    "entries": [
        # constant: active every turn, no key and no scan needed.
        {"keys": [], "constant": True, "content": "The Hollow Sea is charted only in rumour.", "order": 10},
        # plain keys: any hit activates, whole-word + casefolded by default.
        {"keys": ["ghostship", "the captain"], "content": "The ghostship Veile sails in fog.", "order": 20},
        # the AND-ANY gate: the primary hits AND one secondary must too.
        {
            "keys": ["harbour"],
            "secondary_keys": ["storm", "gale"],
            "logic": "and_any",
            "content": "Vane Harbour closes its chain in a storm.",
            "order": 30,
        },
        # the NOT-ANY gate: the primary hits and NO secondary may.
        {
            "keys": ["lantern"],
            "secondary_keys": ["daylight"],
            "logic": "not_any",
            "content": "The lantern on the mole burns green.",
            "order": 40,
        },
        # the tail position: same activation rules, the other slot.
        {
            "keys": ["veile"],
            "position": "tail",
            "content": "Speak of the Veile in the past tense.",
            "order": 50,
        },
        # the eviction-forcing pair: one key, two entries, priorities far apart.
        {"keys": ["cartographer"], "priority": 90, "order": 60, "content": KEEP},
        {"keys": ["cartographer"], "priority": 1, "order": 70, "content": DROP},
        # macros in BOTH the key and the content (§4.3).
        {"keys": ["{{char}}"], "content": "{{char}} answers to {{user}} alone.", "order": 80},
        # an entry whose content renders to nothing is dropped (the V3 MUST).
        {"keys": ["silence"], "content": "   ", "order": 90},
        # off is off.
        {"keys": ["forbidden"], "enabled": False, "content": "Never said.", "order": 95},
    ],
}

INTRO = REGISTRY["lorebook_intro"].default


# ── helpers ───────────────────────────────────────────────────────────────────────────────────────


def _book(c, slug: str, book: dict[str, Any]) -> dict:
    r = c.put(f"/api/lorebooks/{slug}", json={"book": book})
    assert r.status_code == 200, r.text
    return r.json()


def _thread(c, *turns: tuple[str, str]) -> Thread:
    """A thread seeded with `(role, text)` messages, in order — the prior history a scan sees."""
    s = c.app.state

    async def go():
        t = await s.threads.create(Thread())
        for role, text in turns:
            actor = Actor.USER if role == "user" else Actor.AGENT
            await s.messages.add(Message(thread_id=t.id, role=role, actor=actor, parts=[TextPart(text=text)]))
        return t

    return run_async(go())


def _turn(c, thread: Thread, agent_name: str | None, user_text: str) -> list[dict]:
    """The assembled payload for a turn — the scan pre-pass then the assembly, in `run_turn`'s own
    order (activate BEFORE the user message is persisted, §6.3)."""
    session = _session(c, agent_name)
    run_async(session._activate_lorebooks(thread, user_text))
    return run_async(session._assemble(thread))


def _blocks(messages: list[dict]) -> list[str]:
    """Every framed lorebook block in an assembled payload, in payload order."""
    return [m["content"] for m in messages if m.get("content", "").startswith(INTRO)]


def _run_turn(c, thread: Thread, agent_name: str | None, user_text: str) -> _Fake:
    """One REAL turn through `run_turn` against a scripted model — the only way to pin the ordering
    between the scan and the user-message persist (F11), since that ordering IS `run_turn`'s body."""
    fake = _Fake([[_text("ok")]])
    session = _session(c, agent_name)
    session._inference = fake
    _no_compact(session)

    async def go():
        return [ev async for ev in session.run_turn(thread, user_text)]

    run_async(go())
    return fake


# ── 1. activation (§6.3) ──────────────────────────────────────────────────────────────────────────


def test_a_constant_entry_activates_with_no_scan_at_all() -> None:
    """`constant: true` needs no key and no history: the entry is standing content the owner wants
    in every turn (the field's "instruction chain" pattern — §6.7 records that it needs no new
    mechanism)."""
    with _workspace(), _client() as c:
        _book(c, "hollow-sea", TEST_BOOK)
        _agent(c, "nyx", lorebooks=["hollow-sea"])
        block = _blocks(_turn(c, _thread(c), "nyx", "nothing in this message matches anything"))
        assert len(block) == 1
        assert "charted only in rumour" in block[0]
        assert "ghostship Veile" not in block[0]  # …and nothing else came along for the ride


def test_a_plain_key_activates_and_matching_folds_case_and_whole_words() -> None:
    """Any key hits; matching casefolds and respects word boundaries by default (ST's SHIPPED
    default, R65 §1.2) — so `Ghostship` hits and `ghostships` does not."""
    with _workspace(), _client() as c:
        _book(c, "hollow-sea", TEST_BOOK)
        _agent(c, "nyx", lorebooks=["hollow-sea"])
        hit = _blocks(_turn(c, _thread(c), "nyx", "tell me about the Ghostship"))[0]
        assert "The ghostship Veile sails in fog." in hit
        miss = _blocks(_turn(c, _thread(c), "nyx", "tell me about ghostships"))[0]
        assert "Veile" not in miss  # `whole_words` — the plural is a different word


def test_the_and_any_gate_needs_a_secondary_hit_too() -> None:
    with _workspace(), _client() as c:
        _book(c, "hollow-sea", TEST_BOOK)
        _agent(c, "nyx", lorebooks=["hollow-sea"])
        alone = _blocks(_turn(c, _thread(c), "nyx", "we reach the harbour"))[0]
        assert "Vane Harbour" not in alone
        both = _blocks(_turn(c, _thread(c), "nyx", "we reach the harbour in a storm"))[0]
        assert "Vane Harbour closes its chain" in both


def test_the_not_any_gate_is_blocked_by_a_secondary_hit() -> None:
    with _workspace(), _client() as c:
        _book(c, "hollow-sea", TEST_BOOK)
        _agent(c, "nyx", lorebooks=["hollow-sea"])
        clear = _blocks(_turn(c, _thread(c), "nyx", "is the lantern lit?"))[0]
        assert "burns green" in clear
        blocked = _blocks(_turn(c, _thread(c), "nyx", "is the lantern lit in daylight?"))[0]
        assert "burns green" not in blocked


def test_a_disabled_entry_and_an_empty_rendered_entry_never_emit() -> None:
    """Two different silences: `enabled: false` is the owner's switch, and an entry whose content
    renders to nothing is dropped because the V3 MUST is that each entry renders ONCE — and an empty
    render is not a render (it would otherwise emit a blank paragraph inside the block)."""
    with _workspace(), _client() as c:
        _book(c, "hollow-sea", TEST_BOOK)
        _agent(c, "nyx", lorebooks=["hollow-sea"])
        block = _blocks(_turn(c, _thread(c), "nyx", "forbidden silence"))[0]
        assert "Never said." not in block
        assert block == f"{INTRO}\n\nThe Hollow Sea is charted only in rumour."


def test_macros_render_in_both_the_keys_and_the_content() -> None:
    """The §4.3 pass runs over BOTH halves before either is used: a `{{char}}` KEY must scan for the
    character's name (not for the literal braces), and the content is substituted like any other
    owner-authored surface."""
    with _workspace(), _client() as c:
        _book(c, "hollow-sea", TEST_BOOK)
        _agent(c, "nyx", title="Nyx", user_name="Ari", lorebooks=["hollow-sea"])
        block = _blocks(_turn(c, _thread(c), "nyx", "are you there, Nyx?"))[0]
        assert "Nyx answers to Ari alone." in block
        assert "{{char}}" not in block


def test_each_entry_renders_exactly_once() -> None:
    """The spec MUST. Two of this entry's keys are in one message and the entry still appears once."""
    with _workspace(), _client() as c:
        _book(c, "hollow-sea", TEST_BOOK)
        _agent(c, "nyx", lorebooks=["hollow-sea"])
        block = _blocks(_turn(c, _thread(c), "nyx", "the captain of the ghostship"))[0]
        assert block.count("The ghostship Veile sails in fog.") == 1


# ── 2. the scan window (§6.3, Emma F11) ───────────────────────────────────────────────────────────


def test_the_scan_window_reaches_the_oldest_message_in_it() -> None:
    """The load-bearing F11 pin, driven through the REAL `run_turn`.

    `scan_depth: 2` and the only copy of the key sits in the OLDER of the two prior messages. The
    scan therefore has to run BEFORE the incoming message is persisted — a post-persist
    `history[-2:]` would see [recent, incoming] and lose the key entirely, which is the other face
    of scanning the current message twice."""
    with _workspace(), _client() as c:
        assert c.put("/api/settings", json={"lorebooks": {"scan_depth": 2}}).status_code == 200
        _book(c, "hollow-sea", TEST_BOOK)
        _agent(c, "nyx", lorebooks=["hollow-sea"])
        thread = _thread(c, ("user", "the ghostship again"), ("assistant", "mm."))
        fake = _run_turn(c, thread, "nyx", "and then?")
        assert "The ghostship Veile sails in fog." in "".join(_blocks(fake.seen[0]))


def test_a_message_past_the_scan_window_is_not_scanned() -> None:
    """The window is a window. One message further back and the same key is invisible — which is
    what makes `scan_depth` a knob rather than decoration."""
    with _workspace(), _client() as c:
        assert c.put("/api/settings", json={"lorebooks": {"scan_depth": 2}}).status_code == 200
        _book(c, "hollow-sea", TEST_BOOK)
        _agent(c, "nyx", lorebooks=["hollow-sea"])
        thread = _thread(c, ("user", "the ghostship again"), ("assistant", "mm."), ("user", "go on"))
        fake = _run_turn(c, thread, "nyx", "and then?")
        assert "Veile" not in "".join(_blocks(fake.seen[0]))


def test_the_incoming_message_is_scanned_even_at_depth_zero() -> None:
    """`scan_depth: 0` is "only what was just said" — never "nothing"."""
    with _workspace(), _client() as c:
        assert c.put("/api/settings", json={"lorebooks": {"scan_depth": 0}}).status_code == 200
        _book(c, "hollow-sea", TEST_BOOK)
        _agent(c, "nyx", lorebooks=["hollow-sea"])
        thread = _thread(c, ("user", "the ghostship again"))
        fake = _run_turn(c, thread, "nyx", "is the lantern lit?")
        block = "".join(_blocks(fake.seen[0]))
        assert "burns green" in block and "Veile" not in block


def test_the_head_is_byte_stable_across_a_drive_but_a_fresh_turn_re_scans() -> None:
    """Two guarantees at once, because they pull against each other: the scan runs ONCE per turn (so
    the cached prefix cannot jitter mid-drive — `test_static_head_byte_stable_across_drain`'s
    contract), and a NEW turn re-scans (so a book that matches only the second message still lands).
    """
    with _workspace(), _client() as c:
        _book(c, "hollow-sea", TEST_BOOK)
        _agent(c, "nyx", lorebooks=["hollow-sea"])
        thread = _thread(c)

        session = _session(c, "nyx")
        run_async(session._activate_lorebooks(thread, "nothing here"))
        before = json.dumps(session._static_prefix(), sort_keys=True)
        run_async(session._assemble(thread))  # a second assembly inside the same turn
        assert json.dumps(session._static_prefix(), sort_keys=True) == before
        assert "Veile" not in before

        fake = _run_turn(c, thread, "nyx", "about the ghostship")
        assert "The ghostship Veile sails in fog." in "".join(_blocks(fake.seen[0]))


# ── 3. the budget (§6.4) ──────────────────────────────────────────────────────────────────────────


def test_the_budget_evicts_lowest_priority_first() -> None:
    """ONE global pass: over budget, the lowest `priority` goes (V3's eviction model, not ST's
    refusal — R65 §1.10). The pair share a key, so both activate and exactly one survives."""
    with _workspace(), _client() as c:
        assert c.put("/api/settings", json={"lorebooks": {"budget_chars": 500}}).status_code == 200
        _book(c, "hollow-sea", TEST_BOOK)
        _agent(c, "nyx", lorebooks=["hollow-sea"])
        block = _blocks(_turn(c, _thread(c), "nyx", "find me the cartographer"))[0]
        assert KEEP.strip() in block
        assert "copyist" not in block


def test_a_null_priority_is_ranked_by_its_order() -> None:
    """`priority: null` means "rank me by `order`" (§6.2's V3 split), and the eviction rule is
    lowest-first — so between two unprioritized entries the LOWER `order` number is sacrificed. That
    reads backwards until you hold both meanings at once: `order` ranks the render (lower renders
    first) and, standing in for `priority`, it ranks importance (higher survives) — which is exactly
    V3/ST's `insertion_order` semantics, not an accident of the comparison."""
    with _workspace(), _client() as c:
        assert c.put("/api/settings", json={"lorebooks": {"budget_chars": 60}}).status_code == 200
        _book(
            c,
            "pair",
            {
                "name": "Pair",
                "entries": [
                    {"keys": ["anchor"], "order": 10, "content": "A" * 40},
                    {"keys": ["anchor"], "order": 20, "content": "B" * 40},
                ],
            },
        )
        _agent(c, "nyx", lorebooks=["pair"])
        block = _blocks(_turn(c, _thread(c), "nyx", "drop the anchor"))[0]
        assert "B" * 40 in block and "A" * 40 not in block


def test_the_framing_is_not_charged_against_the_budget() -> None:
    """The budget bounds the OWNER's text. The framing is a registry constant — charging for it
    would make a configured 4000 characters mean something different after a prompt edit."""
    with _workspace(), _client() as c:
        content = "C" * 100
        assert c.put("/api/settings", json={"lorebooks": {"budget_chars": 100}}).status_code == 200
        _book(c, "one", {"name": "One", "entries": [{"keys": ["anchor"], "content": content}]})
        _agent(c, "nyx", lorebooks=["one"])
        block = _blocks(_turn(c, _thread(c), "nyx", "drop the anchor"))[0]
        assert content in block  # …the entry fits exactly…
        assert len(block) > 100  # …while the block, framing included, does not


def test_the_budget_pass_is_global_across_both_positions() -> None:
    """Emma F10: eviction is decided over ALL activated entries together, then the survivors are
    partitioned. A head entry and a tail entry compete for the same characters."""
    with _workspace(), _client() as c:
        assert c.put("/api/settings", json={"lorebooks": {"budget_chars": 50}}).status_code == 200
        _book(
            c,
            "both",
            {
                "name": "Both",
                "entries": [
                    {"keys": ["anchor"], "priority": 90, "content": "H" * 40},
                    {"keys": ["anchor"], "priority": 1, "position": "tail", "content": "T" * 40},
                ],
            },
        )
        _agent(c, "nyx", lorebooks=["both"])
        blocks = _blocks(_turn(c, _thread(c), "nyx", "drop the anchor"))
        assert len(blocks) == 1 and "H" * 40 in blocks[0]  # the tail entry lost to the head one


# ── 4. placement (§6.4) ───────────────────────────────────────────────────────────────────────────


def test_the_head_block_sits_after_the_skills_note_and_before_the_named_examples() -> None:
    """The structural pin. The examples' `name` is what terminates `normalize_system_messages`'
    leading coalescing run (Emma F1), so a block appended after them would fall OUT of the coalesced
    head and be re-roled as mid-history text — the lorebook block must be the last PLAIN block."""
    with _workspace(), _client() as c:
        _book(c, "hollow-sea", TEST_BOOK)
        _agent(c, "nyx", lorebooks=["hollow-sea"], example_dialogue="<START>\n{{user}}: hi\n{{char}}: mm.")
        messages = _turn(c, _thread(c), "nyx", "about the ghostship")
        systems = _systems(messages)
        lorebook = next(i for i, m in enumerate(systems) if m.startswith(INTRO))
        first_named = next(i for i, m in enumerate(messages) if m.get("name"))
        assert lorebook == len(systems) - 3  # the two example pseudo-messages follow it
        assert lorebook < first_named


def test_the_tail_block_sits_immediately_before_post_history() -> None:
    """The tail slot is shared (§4.2): reference material first, the agent's own last word closest
    to generation."""
    with _workspace(), _client() as c:
        _book(c, "hollow-sea", TEST_BOOK)
        _agent(c, "nyx", lorebooks=["hollow-sea"], post_history="Stay in character.")
        messages = _turn(c, _thread(c), "nyx", "speak of the Veile")
        tail = [m["content"] for m in messages[-2:]]
        assert tail[0].startswith(INTRO) and "past tense" in tail[0]
        assert tail[1] == "Stay in character."


def test_the_two_positions_are_two_blocks_under_one_framing() -> None:
    with _workspace(), _client() as c:
        _book(c, "hollow-sea", TEST_BOOK)
        _agent(c, "nyx", lorebooks=["hollow-sea"])
        blocks = _blocks(_turn(c, _thread(c), "nyx", "the ghostship Veile"))
        assert len(blocks) == 2
        assert "sails in fog" in blocks[0] and "past tense" in blocks[1]


def test_no_activation_costs_no_prompt_bytes_at_all() -> None:
    """A scan miss emits NOTHING — not an empty block, not the framing. The head of an agent with a
    book that did not match is the head of an agent with no book."""
    with _workspace(), _client() as c:
        _book(c, "quiet", {"name": "Quiet", "entries": [{"keys": ["nothing"], "content": "x"}]})
        _agent(c, "nyx", lorebooks=["quiet"])
        _agent(c, "nyx2")
        with_book = _systems(_turn(c, _thread(c), "nyx", "hello"))
        without = _systems(_turn(c, _thread(c), "nyx2", "hello"))
        assert with_book == without


# ── 5. attachment (§6.3/§6.5) ─────────────────────────────────────────────────────────────────────


def test_global_and_agent_books_union_and_dedupe() -> None:
    """`lorebooks.books` ∪ the agent's own, slug-deduped — the field's bind-twice-counts-once rule.
    The shared slug must contribute its entry exactly once."""
    with _workspace(), _client() as c:
        assert (
            c.put("/api/settings", json={"lorebooks": {"books": ["hollow-sea", "global"]}}).status_code == 200
        )
        _book(c, "hollow-sea", TEST_BOOK)
        _book(c, "global", {"name": "Global", "entries": [{"keys": ["ghostship"], "content": "Also true."}]})
        _agent(c, "nyx", lorebooks=["hollow-sea"])  # bound in BOTH places
        block = _blocks(_turn(c, _thread(c), "nyx", "about the ghostship"))[0]
        assert block.count("The ghostship Veile sails in fog.") == 1
        assert "Also true." in block


def test_a_missing_or_unreadable_book_is_skipped_not_fatal() -> None:
    """A listed book whose file is gone must cost the owner its entries and nothing else (§6.3) —
    deleting a book can never break every turn of every agent that still lists it."""
    with _workspace() as (tmp, _cfg), _client() as c:
        _book(c, "hollow-sea", TEST_BOOK)
        _book(c, "broken", {"name": "Broken", "entries": []})
        (tmp / "lorebooks" / "broken.yaml").write_text("entries: [oh no\n", encoding="utf-8")
        _agent(c, "nyx", lorebooks=["hollow-sea", "broken", "never-existed"])
        block = _blocks(_turn(c, _thread(c), "nyx", "about the ghostship"))[0]
        assert "The ghostship Veile sails in fog." in block


def test_a_disabled_book_contributes_nothing() -> None:
    with _workspace(), _client() as c:
        _book(c, "hollow-sea", {**TEST_BOOK, "enabled": False})
        _agent(c, "nyx", lorebooks=["hollow-sea"])
        assert _blocks(_turn(c, _thread(c), "nyx", "about the ghostship")) == []


# ── 6. the CRUD surface (§6.1) ────────────────────────────────────────────────────────────────────


def test_crud_round_trips_a_book(home: Path) -> None:
    with make_client() as c:
        assert c.get("/api/lorebooks").json() == {"lorebooks": []}
        _book(c, "hollow-sea", TEST_BOOK)
        listed = c.get("/api/lorebooks").json()["lorebooks"]
        assert listed == [{"slug": "hollow-sea", "name": "The Hollow Sea", "enabled": True, "entries": 10}]

        got = c.get("/api/lorebooks/hollow-sea").json()["book"]
        assert got["entries"][1]["keys"] == ["ghostship", "the captain"]
        assert got["entries"][1]["whole_words"] is True  # the defaults are materialised, not implied

        assert c.delete("/api/lorebooks/hollow-sea").json() == {"slug": "hollow-sea", "deleted": True}
        assert c.get("/api/lorebooks/hollow-sea").status_code == 404
        assert c.delete("/api/lorebooks/hollow-sea").status_code == 404


def test_a_bad_slug_is_refused_by_the_shared_guard(home: Path) -> None:
    """The skills/agents grammar, reused — not a second regex."""
    with make_client() as c:
        for bad in ("../escape", "Upper", "with space"):
            assert c.get(f"/api/lorebooks/{bad}").status_code in (404, 422)
        assert c.put("/api/lorebooks/Nope", json={"book": {}}).status_code == 422


def test_a_book_file_is_written_0600_through_the_yaml_chokepoint(home: Path) -> None:
    """The `agent.yaml` contract, one file over (§6.1): a book is owner content written atomically at
    0600 by `edit_config_yaml`, never by a bare `yaml.safe_dump` at whatever the umask allows."""
    with make_client() as c:
        _book(c, "hollow-sea", TEST_BOOK)
    p = home / "lorebooks" / "hollow-sea.yaml"
    assert p.stat().st_mode & 0o777 == 0o600


def test_yaml_11_ambiguous_keys_survive_a_round_trip(home: Path) -> None:
    """Entry keys are EXACTLY the ambiguous class (§6.1): the writer is YAML 1.2 and the loader is
    1.1, so `no` and `23:00` must be quoted on the way out or they come back as `False` and `1380` —
    a key that can never match again."""
    with make_client() as c:
        _book(c, "times", {"name": "Times", "entries": [{"keys": ["no", "23:00", "on"], "content": "x"}]})
        raw = (home / "lorebooks" / "times.yaml").read_text(encoding="utf-8")
        assert "'no'" in raw and "'23:00'" in raw and "'on'" in raw
        assert c.get("/api/lorebooks/times").json()["book"]["entries"][0]["keys"] == ["no", "23:00", "on"]
    assert yaml.safe_load(raw)["entries"][0]["keys"] == ["no", "23:00", "on"]


def test_a_save_preserves_the_owners_comments(home: Path) -> None:
    """`edit_config_yaml` is comment-preserving, and a book is a file the owner edits by hand."""
    with make_client() as c:
        _book(c, "hollow-sea", {"name": "The Hollow Sea", "entries": []})
        p = home / "lorebooks" / "hollow-sea.yaml"
        p.write_text("# my own notes\n" + p.read_text(encoding="utf-8"), encoding="utf-8")
        _book(
            c, "hollow-sea", {"name": "The Hollow Sea", "description": "now with a subtitle", "entries": []}
        )
        assert "# my own notes" in p.read_text(encoding="utf-8")


def test_an_unparsable_book_never_takes_the_listing_down(home: Path) -> None:
    with make_client() as c:
        _book(c, "good", {"name": "Good", "entries": []})
        (home / "lorebooks" / "bad.yaml").write_text("entries: [oh no\n", encoding="utf-8")
        assert [b["slug"] for b in c.get("/api/lorebooks").json()["lorebooks"]] == ["good"]


# ── 7. import (§6.5) ──────────────────────────────────────────────────────────────────────────────


def st_entry(uid: int, **fields) -> dict[str, Any]:
    """One ST raw-export entry: the shipped field names, ST's own nulls, and its numeric enums."""
    return {
        "uid": uid,
        "key": [],
        "keysecondary": [],
        "comment": "",
        "content": "",
        "constant": False,
        "selective": True,
        "selectiveLogic": 0,
        "disable": False,
        "insertion_order": 100,
        "position": 1,
        "caseSensitive": None,
        "matchWholeWords": None,
        "depth": 4,
        "probability": 100,
        "role": None,
        **fields,
    }


ST_BOOK: dict[str, Any] = {
    "name": "Simple Traits",
    "entries": {
        "0": st_entry(0, key=["ghostship"], comment="Ghostship", content="It sails in fog.", position=1),
        "1": st_entry(1, key=["harbour"], keysecondary=["storm"], selectiveLogic=3, comment="Harbour"),
        "2": st_entry(2, key=["before"], comment="Before", content="b.", position=0),
        "3": st_entry(3, key=["note"], comment="Note", content="n.", position=2, insertion_order=5),
        "4": st_entry(4, key=["deep"], comment="Deep", content="d.", position=4),
        "5": st_entry(5, key=["off"], comment="Off", content="o.", disable=True, matchWholeWords=False),
    },
}


def post_book(c: TestClient, payload: Any, name: str = "whatever.bin") -> Any:
    body = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
    return c.post("/api/lorebooks/import", files={"file": (name, body, "application/octet-stream")})


def import_book_ok(c: TestClient, payload: Any) -> dict:
    r = post_book(c, payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_the_st_raw_export_imports_whole(home: Path) -> None:
    """Shape ②: `entries` as a DICT keyed by uid, ST's field names, ST's nulls. The alias table plus
    the shipped-default rule (`matchWholeWords` absent/null ⇒ TRUE) is the whole mapping."""
    with make_client() as c:
        body = import_book_ok(c, ST_BOOK)
    assert body["slug"] == "simple-traits"
    entries = body["book"]["entries"]
    assert body["book"]["name"] == "Simple Traits"
    assert [e["keys"] for e in entries[:2]] == [["ghostship"], ["harbour"]]
    assert entries[0]["content"] == "It sails in fog."
    assert entries[0]["order"] == 100  # `insertion_order`
    assert entries[0]["whole_words"] is True  # null ⇒ the SHIPPED default, not the code one
    assert entries[0]["case_sensitive"] is False
    assert entries[0]["priority"] is None  # absent stays NULL — it means "rank me by order"
    assert entries[5]["enabled"] is False  # `disable: true`
    assert entries[5]["whole_words"] is False  # …and an explicit false is honoured
    assert entries[1]["secondary_keys"] == ["storm"]  # `keysecondary`
    # `comment` is not a field we implement, so it survives as stash rather than vanishing.
    assert entries[0]["comment"] == "Ghostship"
    assert "comment" in body["report"]["stashed_keys"]
    assert "key" in body["report"]["mapped"]


def test_the_position_downgrade_is_reported_per_entry(home: Path) -> None:
    """§6.5's ruling: v1 stores `head | tail`, so every collapse is named. Position 1 is the ONE
    exact landing — our head block sits after the character definitions, which is what it means."""
    with make_client() as c:
        body = import_book_ok(c, ST_BOOK)
    entries = body["book"]["entries"]
    warnings = body["report"]["warnings"]
    assert [e["position"] for e in entries] == ["head", "head", "head", "tail", "tail", "head"]
    assert not any(w.startswith("Ghostship:") for w in warnings)  # position 1 = an exact landing
    assert any(w.startswith("Before:") and "landed at the head" in w for w in warnings)
    assert any(w.startswith("Note:") and "landed at the tail" in w for w in warnings)
    assert any(w.startswith("Deep:") and "fixed depth" in w for w in warnings)
    # …and the fields the collapse dropped are STASHED, not reported one by one.
    assert entries[4]["depth"] == 4 and entries[4]["probability"] == 100


def test_the_ruled_logic_mapping_reports_its_approximation(home: Path) -> None:
    """`selectiveLogic: 3` is AND-ALL, which v1 has no equivalent for: it lands on AND-ANY WITH a
    line, because the entry now activates more readily than its author wrote."""
    with make_client() as c:
        body = import_book_ok(c, ST_BOOK)
    assert body["book"]["entries"][1]["logic"] == "and_any"
    assert any("AND-ALL" in w and w.startswith("Harbour:") for w in body["report"]["warnings"])


def test_logic_is_normalized_away_when_there_are_no_secondary_keys(home: Path) -> None:
    """An approximation of a gate that does not exist is not an approximation — no report line."""
    with make_client() as c:
        book = {"name": "Quiet", "entries": {"0": st_entry(0, key=["k"], content="c", selectiveLogic=3)}}
        body = import_book_ok(c, book)
    assert body["book"]["entries"][0]["logic"] == "and_any"
    assert body["report"]["warnings"] == []


def test_the_v3_envelope_and_a_bare_list_are_both_read(home: Path) -> None:
    """Shapes ① and ③ (R65 §5), sniffed off the parsed value — never off the filename."""
    with make_client() as c:
        envelope = import_book_ok(
            c,
            {
                "spec": "lorebook_v3",
                "data": {"name": "Enveloped", "entries": [{"keys": ["a"], "content": "A"}]},
            },
        )
        bare = import_book_ok(c, [{"keys": ["b"], "content": "B", "position": "after_char"}])
    assert envelope["slug"] == "enveloped" and envelope["book"]["entries"][0]["content"] == "A"
    assert bare["slug"] == "lorebook"  # no name in a bare list → the mint's fallback
    assert bare["book"]["entries"][0]["position"] == "head"  # V3's own string, an exact landing
    assert bare["report"]["warnings"] == []


def test_the_spec_name_wins_over_the_st_alias(home: Path) -> None:
    """The alias table's precedence rule, on an entry that carries both spellings."""
    with make_client() as c:
        body = import_book_ok(
            c, [{"keys": ["spec"], "key": ["raw"], "content": "c", "order": 7, "insertion_order": 900}]
        )
    entry = body["book"]["entries"][0]
    assert entry["keys"] == ["spec"] and entry["order"] == 7
    assert "key" not in entry  # the loser is dropped, not stashed as a contradictory second copy


def test_a_second_import_of_the_same_name_walks_the_slug(home: Path) -> None:
    with make_client() as c:
        first = import_book_ok(c, ST_BOOK)
        second = import_book_ok(c, ST_BOOK)
    assert (first["slug"], second["slug"]) == ("simple-traits", "simple-traits-2")


def test_an_import_over_the_cap_is_413(home: Path) -> None:
    """The cap+1/413 posture, on the config key it names verbatim so the owner can act on it."""
    (home / "config.yaml").write_text(
        (home / "config.yaml").read_text(encoding="utf-8") + "lorebooks:\n  max_import_bytes: 80\n",
        encoding="utf-8",
    )
    with make_client() as c:
        r = post_book(c, ST_BOOK)
    assert r.status_code == 413
    assert "lorebooks.max_import_bytes" in r.json()["detail"]


def test_hostile_and_unusable_json_is_refused(home: Path) -> None:
    with make_client() as c:
        assert post_book(c, b'{"entries": [').status_code == 422  # not JSON at all
        assert post_book(c, b"").status_code == 422  # empty upload
        assert post_book(c, {"name": "no entries"}).status_code == 422  # not a book
        assert post_book(c, {"spec": "lorebook_v9", "data": {}}).status_code == 422  # a spec we don't read
        # Depth is the hostile property no single reader owns (the card route's own note): this JSON
        # parses fine and then exhausts the stack in the YAML quoting walk, on its way to disk.
        deep = json.loads("[" * 4000 + "]" * 4000)
        assert post_book(c, [{"keys": ["a"], "content": "c", "extensions": deep}]).status_code == 422


# ── 8. the card hook (§6.5) ───────────────────────────────────────────────────────────────────────


def test_a_cards_embedded_book_lands_as_a_real_attached_book(home: Path) -> None:
    """End to end: the V3 `character_book` becomes `<agent-slug>-book.yaml`, is attached to the
    agent BEFORE validation, is reported (downgrade lines included), and STAYS in the `card` stash —
    the stash is its permanent provenance home (the S2 ruling), so landing it is additive."""
    card = v3(
        name="Nyx",
        description="d",
        character_book={
            "name": "Nyx's own",
            "entries": [
                {"keys": ["archive"], "content": "It floods.", "position": "before_char"},
                {"keys": ["tide"], "content": "It rises at dusk."},
            ],
        },
    )
    with make_client() as c:
        body = imported(c, json.dumps(card).encode("utf-8"))
        listed = c.get("/api/lorebooks").json()["lorebooks"]
    assert body["agent"]["lorebooks"] == ["nyx-book"]
    assert agent_yaml(home, "nyx")["lorebooks"] == ["nyx-book"]
    assert listed == [{"slug": "nyx-book", "name": "Nyx's own", "enabled": True, "entries": 2}]
    assert body["agent"]["card"]["character_book"]["entries"][0]["keys"] == ["archive"]  # provenance
    warnings = body["report"]["warnings"]
    assert any("imported as 'nyx-book'" in w and "2 entries" in w for w in warnings)
    assert any(w.startswith("entry 1:") and "landed at the head" in w for w in warnings)


def test_an_embedded_book_that_will_not_map_is_a_warning_not_a_refusal(home: Path) -> None:
    """The avatar's trade (§5.4): the character is the text, so a malformed extra costs a line in
    the report, never the whole import."""
    card = v3(name="Nyx", description="d", character_book={"entries": "not a book"})
    with make_client() as c:
        body = imported(c, json.dumps(card).encode("utf-8"))
    assert body["agent"].get("lorebooks", []) == []
    assert any("embedded lorebook was not imported" in w for w in body["report"]["warnings"])


def test_an_imported_book_activates_on_the_very_next_turn(home: Path) -> None:
    """The whole slice, end to end: a card imported through the API is a character whose book is
    already scanning."""
    card = v3(
        name="Nyx",
        description="d",
        character_book={"name": "Nyx's own", "entries": [{"keys": ["archive"], "content": "It floods."}]},
    )
    with make_client() as c:
        imported(c, json.dumps(card).encode("utf-8"))
        block = _blocks(_turn(c, _thread(c), "nyx", "tell me about the archive"))
    assert block and "It floods." in block[0]
