import json
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[2]
CONTRACT_ROOT = ROOT / "contracts" / "v2.0"
SHARED_PATHS = [
    CONTRACT_ROOT / "shared" / "types.schema.json",
    CONTRACT_ROOT / "shared" / "command-envelope.schema.json",
    CONTRACT_ROOT / "shared" / "event-envelope.schema.json",
]
CASES = [
    ("commands/mission/CreateMission.schema.json", "valid/CreateMission.json", True),
    ("commands/mission/CreateMission.schema.json", "invalid/CreateMission_missing_objective.json", False),
    ("events/mission/MissionCreated.schema.json", "valid/MissionCreated.json", True),
]


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


registry = Registry()
for shared_path in SHARED_PATHS:
    shared_schema = load_json(shared_path)
    registry = registry.with_resource(shared_schema["$id"], Resource.from_contents(shared_schema))

failures = []
for schema_relative, fixture_relative, expected in CASES:
    schema_path = CONTRACT_ROOT / schema_relative
    fixture_path = ROOT / "validation" / "fixtures" / fixture_relative
    schema = load_json(schema_path)
    errors = list(Draft202012Validator(schema, registry=registry).iter_errors(load_json(fixture_path)))
    actual = not errors
    if actual != expected:
        failures.append(
            {
                "schema": str(schema_path.relative_to(ROOT)),
                "fixture": str(fixture_path.relative_to(ROOT)),
                "errors": [error.message for error in errors],
            }
        )

if failures:
    raise SystemExit(json.dumps(failures, indent=2))

print(f"PASS: {len(CASES)} contract fixture assertions")
