"""A11/D48 Slice 2 — the embeddings client re-keyed onto a resolved chain + failover.

failover (walk the chain on any error) · the `dim` property (chain's agreed first-non-null) · enabled=False
→ unconfigured · the timeout rides the `EmbeddingsPolicy` onto the SDK client · drain closes SDK clients.
No network: the SDK `embeddings.create` is stubbed per target.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from _reg import target

from app.adapters.embeddings import EmbeddingsClient, EmbeddingsError
from app.domain.provider import EmbeddingsPolicy


def _run(coro):
    return asyncio.run(coro)


class _Emb:
    def __init__(self, index, vec):
        self.index, self.embedding = index, vec


def _fake_client(*, on_embed):
    async def create(*, model, input):
        if isinstance(on_embed, Exception):
            raise on_embed
        return SimpleNamespace(data=on_embed(model, input))

    return SimpleNamespace(embeddings=SimpleNamespace(create=create))


def _ec(chain=(), *, by_url=None, enabled=True, policy=None) -> EmbeddingsClient:
    ec = EmbeddingsClient(tuple(chain), policy or EmbeddingsPolicy(), enabled=enabled)
    if by_url is not None:
        ec._client = lambda t: by_url[t.base_url]  # type: ignore[assignment]
    return ec


def test_failover_walks_chain_and_orders_by_index() -> None:
    async def go():
        ec = _ec(
            chain=[target("primary", "http://p/v1", "e1"), target("openrouter", "http://f/v1", "e2")],
            by_url={
                "http://p/v1": _fake_client(on_embed=RuntimeError("down")),
                # returned out of order → must be sorted by index
                "http://f/v1": _fake_client(on_embed=lambda m, inp: [_Emb(1, [9.0]), _Emb(0, [1.0])]),
            },
        )
        out = await ec.embed(["a", "b"])
        assert out == [[1.0], [9.0]]  # index-ordered

    _run(go())


def test_all_fail_raises_embeddings_error() -> None:
    async def go():
        ec = _ec(
            chain=[target("p", "http://p/v1", "e")],
            by_url={"http://p/v1": _fake_client(on_embed=RuntimeError("boom"))},
        )
        try:
            await ec.embed("x")
            raise AssertionError("expected EmbeddingsError")
        except EmbeddingsError:
            pass

    _run(go())


def test_dim_property_is_chain_first_non_null() -> None:
    ec = _ec(chain=[target("p", "http://p/v1", "e", dim=None), target("o", "http://o/v1", "e2", dim=2560)])
    assert ec.dim == 2560
    assert ec.model == "e"  # the primary's wire model id
    assert _ec().dim is None  # empty chain


def test_enabled_false_is_unconfigured() -> None:
    async def go():
        ec = _ec(chain=[target("p", "http://p/v1", "e")], enabled=False)
        assert ec.configured is False
        try:
            await ec.embed("x")
            raise AssertionError("expected EmbeddingsError")
        except EmbeddingsError:
            pass
        assert _ec().configured is False  # empty chain, enabled True → still unconfigured

    _run(go())


def test_timeout_rides_policy_onto_sdk_client() -> None:
    # a real EmbeddingsClient (no stub) builds the SDK client with the policy timeout
    ec = _ec(chain=[target("p", "http://p/v1", "e")], policy=EmbeddingsPolicy(timeout_s=12.5))
    client = ec._client(ec._chain[0])
    assert client.timeout == 12.5


def test_drain_closes_sdk_clients() -> None:
    async def go():
        ec = _ec(chain=[target("p", "http://p/v1", "e")])
        closed = {"n": 0}

        class _FakeSDK:
            async def close(self):
                closed["n"] += 1

        ec._clients["p"] = _FakeSDK()  # type: ignore[assignment]
        await ec.retire()  # idle → immediate close
        assert closed["n"] == 1

    _run(go())


if __name__ == "__main__":
    passed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
            passed += 1
    print(f"\n{passed} passed")
