"""The CI check on commit messages (scripts/check-commit-messages.sh, plan 016): PRs are
rebased onto main as written, so every commit in a pushed range must pass the commit-msg hook."""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHECK = ROOT / "scripts" / "check-commit-messages.sh"


def run_check(tmp_path: Path, *messages: str) -> subprocess.CompletedProcess[str]:
    """Checks the commits after a repo's first, one per message."""
    repo = tmp_path / "repo"
    subprocess.run(["git", "init", "--quiet", "-b", "main", str(repo)], check=True)
    for message in ("chore: Start", *messages):
        subprocess.run(
            ["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@example.com",
             "commit", "-qm", message, "--allow-empty"],
            check=True,
        )  # fmt: skip
    return subprocess.run(
        [str(CHECK), f"HEAD~{len(messages)}..HEAD"], cwd=repo, capture_output=True, text=True
    )


def test_well_formed_messages_pass(tmp_path: Path) -> None:
    result = run_check(
        tmp_path,
        "feat: Add the compare page (plan 008)",
        "fix!: Move the rankings page\n\nBREAKING CHANGE: old links stop working.",
        "data: Add 2 videos and 3 channels (2026-10-30)",
    )
    assert result.returncode == 0, result.stderr


def test_every_bad_message_is_named(tmp_path: Path) -> None:
    result = run_check(tmp_path, "Fix typo", "docs: Explain commits", "feature: Add a page")
    assert result.returncode == 1
    assert "Fix typo" in result.stderr
    assert "feature: Add a page" in result.stderr
    assert "docs: Explain commits" not in result.stderr
    assert "DEVELOPMENT.md" in result.stderr


def test_a_first_push_checks_the_newest_commit(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    run_check(tmp_path, "wip")
    zero = "0" * 40
    result = subprocess.run([str(CHECK), f"{zero}..HEAD"], cwd=repo, capture_output=True, text=True)
    assert result.returncode == 1
    assert "wip" in result.stderr
