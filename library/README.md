# EMA Forge protocol library

The library is a static, versioned catalog of inspectable JSON. It can contain:

- `protocol`: a complete EMA Forge 2.0.0 study that replaces the current draft.
- `question_pack`: declarative questions installed as a new survey step in the first session. Question IDs, branching references, and response-piping references are remapped on installation so they cannot collide with an existing study.
- `task_preset`: settings for an existing built-in task engine (`epat`, `hct`, or `iat`). It cannot contain executable code.

To contribute, add one JSON file under `protocols/` or `packs/`, add its display entry to `catalog.json`, and open a pull request. Contributions should include a clear source and license, intended population and setting, estimated burden, validation status, and any device requirements. Demonstration questions must say that they are not a validated instrument. Do not submit proprietary questionnaire text, identifying participant data, secrets, remote scripts, or claims of clinical validity without supporting evidence.

New task engines are ordinary source-code contributions and require code and measurement review. The library deliberately does not execute JavaScript supplied by a library item.
