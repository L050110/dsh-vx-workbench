# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [Unreleased]

### Planned
- parameterised factory generator (line length / stations / takt / robots / AGV)
- cycle-time and bottleneck report after a simulation run
- template assets fetched on demand instead of shipped in the package

## [0.1.0] — 2026-10-24

### Added
- **Signature-based compatibility repair** (`lib/patch.mjs`): locates the CAD import
  decision site by the 15 bytes around it instead of file offset `173095`, so other
  4.8 builds are recognised. Reports `unsupported` / `ambiguous` instead of guessing.
- Backup, read-back verification and one-click restore; refuses to restore from a
  backup that is itself patched.
- **Self-maintaining skill ledger** (`lib/skills.mjs`): fingerprints every `SKILL.md`
  under five roots, rewrites `docs/skills.md`, records added / changed / removed, and
  never reports an existing skill as new on the first scan.
- **Conversation fan-out**: queued notices into existing sessions, with a preview step,
  a per-run cap, and age filtering.
- **OpenViking ingest** (`lib/ov.mjs`): direct MCP-over-HTTP catalog read when a local
  server is reachable, otherwise an agent-pushed snapshot; four explicit states.
- Panel: compatibility status, one-click repair/restore, asset list, skill ledger card,
  work log, and a handoff brief for new conversations.

### Fixed
- A patched install was reported as "unsupported" because the signature hard-coded the
  unpatched jump opcode; the opcode token is now a wildcard and is classified separately.
- An explicitly requested `--backup` was ignored when writing to `--out`.

### Security
- No absolute personal paths ship as defaults; every path comes from the environment.
- `/vxwb` is local-only by construction; nothing is uploaded anywhere.
