"""Fails when a kit file in this app was edited or is missing. Standard library only; runs in CI."""
import hashlib, json, sys
from pathlib import Path
KIT = Path(__file__).resolve().parent.parent
def files(kit):
    return sorted(p for p in kit.rglob("*") if p.is_file() and p.name != "MANIFEST.json" and not {"__pycache__", "target"} & set(p.parts) and p.name != "Cargo.lock")
def digest(p): return hashlib.sha256(p.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
def manifest(kit): return {p.relative_to(kit).as_posix(): digest(p) for p in files(kit)}
def problems(kit):
    want, have = json.loads((kit / "MANIFEST.json").read_text()), manifest(kit)
    return [f"kit/{f} {'is missing' if f not in have else 'was added' if f not in want else 'was edited'}" for f in sorted(set(want) | set(have)) if want.get(f) != have.get(f)]
if __name__ == "__main__":
    bad = problems(KIT); print("\n".join(bad) or "kit unchanged"); sys.exit(bool(bad))
