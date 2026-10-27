"""ISS-117 — the env-leak guard (conftest's `pytest_runtest_protocol` + `pytest_runtest_teardown` wrappers).

A test that leaves `os.environ` changed — in its body, in a fixture finalizer, or in a finalizer that also
raises — must get exactly one ERROR, at its own teardown, naming the keys and never their values; the env
is restored, so the next test starts clean; a finalizer that merely raises must not make every later test
report the stale `PYTEST_CURRENT_TEST` the runner leaves behind; `monkeypatch` stays silent.

One whole child pytest session runs `_PROBE` under the REAL conftest, built by
`test_tmp_lifecycle_iss99._probe_sessions` (its module docstring says why a plain subprocess and not
`pytester`); each test's outcome is read from the child's JUnit XML. The leaked value is handed in through
the child's env, so it appears in no source line a traceback could print.
"""

from __future__ import annotations

import secrets
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest
from test_tmp_lifecycle_iss99 import BACKEND, _probe_sessions

_PROBE = """
import os

import pytest

VALUE = os.environ["GUARD_PROBE_VALUE"]


def test_body_leak():
    os.environ["LEAK_BODY"] = VALUE


def test_after_body_leak():
    assert "LEAK_BODY" not in os.environ


@pytest.fixture
def leaks_in_finalizer():
    yield
    os.environ["LEAK_FINALIZER"] = VALUE


def test_finalizer_leak(leaks_in_finalizer):
    pass


def test_after_finalizer_leak():
    assert "LEAK_FINALIZER" not in os.environ


@pytest.fixture
def leaks_and_raises():
    yield
    os.environ["LEAK_BOTH"] = VALUE
    raise RuntimeError("finalizer boom")


def test_leak_and_raise(leaks_and_raises):
    pass


def test_after_leak_and_raise():
    assert "LEAK_BOTH" not in os.environ


@pytest.fixture
def raises():
    yield
    raise RuntimeError("plain boom")


def test_raise_only(raises):
    pass


def test_after_raise_only():
    pass


def test_after_raise_only_again():
    pass


def test_changed_and_removed():
    os.environ["GUARD_PRE_CHANGE"] = VALUE
    del os.environ["GUARD_PRE_REMOVE"]


def test_after_changed_and_removed():
    assert os.environ["GUARD_PRE_CHANGE"] == "before"
    assert os.environ["GUARD_PRE_REMOVE"] == "before"


def test_monkeypatch_is_clean(monkeypatch):
    monkeypatch.setenv("MP_ADDED", VALUE)
    monkeypatch.setenv("GUARD_PRE_CHANGE", VALUE)
    monkeypatch.delenv("GUARD_PRE_REMOVE")
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("MP_CONTEXT", VALUE)
    os.environ["MP_ADDED"] = "rewritten"  # a direct write to a key monkeypatch owns is undone with it
"""

#: The tests that must ERROR (at teardown), each with the text its report must carry. Every other test
#: in `_PROBE` must pass.
_ERRORS = {
    "test_body_leak": ["env leaked by test_probe.py::test_body_leak: added LEAK_BODY"],
    "test_finalizer_leak": ["env leaked by test_probe.py::test_finalizer_leak: added LEAK_FINALIZER"],
    "test_leak_and_raise": [
        "RuntimeError: finalizer boom",
        "env leaked by test_probe.py::test_leak_and_raise: added LEAK_BOTH",
    ],
    "test_raise_only": ["RuntimeError: plain boom"],
    "test_changed_and_removed": [
        "env leaked by test_probe.py::test_changed_and_removed: removed GUARD_PRE_REMOVE; changed GUARD_PRE_CHANGE"
    ],
}


@pytest.fixture(scope="module")
def child(tmp_path_factory: pytest.TempPathFactory) -> tuple[dict[str, list[ET.Element]], str, str]:
    """Run `_PROBE` once: per test name, the JUnit outcome elements (error/failure/skipped); the whole
    report text (XML + stdout + stderr); the leaked value."""
    tmp = tmp_path_factory.mktemp("guard")
    argv, env, _root = _probe_sessions(tmp)
    Path(argv[-1]).write_text(_PROBE, encoding="utf-8")  # the probe file `_probe_sessions` wrote
    value = f"guard-secret-{secrets.token_hex(8)}"
    env |= {"GUARD_PROBE_VALUE": value, "GUARD_PRE_CHANGE": "before", "GUARD_PRE_REMOVE": "before"}
    junit = tmp / "junit.xml"
    run = subprocess.run(
        [*argv, f"--junitxml={junit}"], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=180
    )
    assert run.returncode == 1, run.stdout + run.stderr
    xml = junit.read_text(encoding="utf-8")
    outcomes = {case.get("name", ""): list(case) for case in ET.fromstring(xml).iter("testcase")}
    outcomes = {
        name: [e for e in elems if e.tag in ("error", "failure", "skipped")]
        for name, elems in outcomes.items()
    }
    return outcomes, xml + run.stdout + run.stderr, value


def _report(element: ET.Element) -> str:
    return (element.get("message") or "") + "\n" + (element.text or "")


def test_only_the_leaking_or_raising_tests_error_and_the_next_test_is_clean(child) -> None:
    """Body leak, finalizer leak, leaking+raising finalizer, changed+removed keys: one ERROR each, the env
    restored (the `test_after_*` tests assert it); a merely raising finalizer: its own ERROR and NO spurious
    ones on the later tests; `monkeypatch` / `MonkeyPatch.context()`: clean."""
    outcomes, _text, _value = child
    assert len(outcomes) == _PROBE.count("\ndef test_")
    bad = {name: [e.tag for e in elems] for name, elems in outcomes.items() if elems}
    assert bad == {name: ["error"] for name in _ERRORS}


@pytest.mark.parametrize("name", sorted(_ERRORS))
def test_each_error_names_its_test_and_its_keys(child, name: str) -> None:
    outcomes, _text, _value = child
    (error,) = outcomes[name]
    report = _report(error)
    assert "teardown" in report
    for expected in _ERRORS[name]:
        assert expected in report
    if name == "test_raise_only":  # the stale `PYTEST_CURRENT_TEST` is not a leak
        assert "env leaked" not in report


def test_the_report_names_keys_never_values(child) -> None:
    _outcomes, text, value = child
    assert "LEAK_BODY" in text
    assert value not in text
