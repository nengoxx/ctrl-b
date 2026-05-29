"""Phase 7d-c — skill file CRUD tests.

Same dual-run convention. Covers GET/PUT/DELETE /api/skills/{name}: a blank PUT writes the scaffold
(and the discovery list picks it up immediately — the FileSkillProvider re-scans per call), a custom
PUT overwrites + the parsed description updates, an unsafe name is rejected (422 — traversal guard),
and DELETE removes it. Writes go to a **temp** skills dir under a temp config (audit E3).
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


def test_skill_file_crud() -> None:
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("server:\n  port: 5433\n", encoding="utf-8")  # skills_dir defaults to ./skills
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with _client() as c:
            assert c.get("/api/skills").json() == []  # none yet

            # malformed names are rejected by the slug guard before touching the filesystem
            assert c.put("/api/skills/Bad Name", json={"content": "x"}).status_code == 422
            assert c.put("/api/skills/UPPER", json={"content": "x"}).status_code == 422

            # blank content → scaffold written; appears in discovery with parsed frontmatter
            r = c.put("/api/skills/my-skill", json={"content": ""})
            assert r.status_code == 200, r.text
            assert "name: my-skill" in r.json()["content"]
            assert (tmp / "skills" / "my-skill" / "SKILL.md").is_file()
            listed = {s["name"]: s for s in c.get("/api/skills").json()}
            assert "my-skill" in listed

            # custom content overwrites + the parsed description updates live
            body = (
                "---\nname: my-skill\ndescription: Find things on the fleet.\n"
                "allowed_tools: [ping_host]\n---\nDo the thing.\n"
            )
            assert c.put("/api/skills/my-skill", json={"content": body}).status_code == 200
            assert c.get("/api/skills/my-skill").json()["content"] == body
            again = {s["name"]: s for s in c.get("/api/skills").json()}["my-skill"]
            assert again["description"] == "Find things on the fleet."
            assert again["allowed_tools"] == ["ping_host"]

            # delete → gone (404 on a second delete)
            assert c.delete("/api/skills/my-skill").status_code == 200
            assert c.get("/api/skills/my-skill").status_code == 404
            assert c.delete("/api/skills/my-skill").status_code == 404
            assert c.get("/api/skills").json() == []
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
