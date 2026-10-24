# Security policy

## Scope

This plugin touches an installed desktop application (bytes on disk), reads skill files,
and can launch PowerShell scripts that you point it at. Those are the areas worth a report.

Out of scope: the CAD application itself, and anything that requires the plugin to
upload data — it has no upload path.

## Reporting

Open a private security advisory on this repository (Security → Advisories → Report a
vulnerability). Please do not file a public issue for an unpatched problem.

Include: the version, the exact action from the panel, and — for compatibility-repair
issues — the `sha256` that `node lib/patch.mjs scan <dll>` prints.

## Guarantees this project intends to keep

- The repair writes exactly one byte, verifies it by reading the file back, and never
  runs without a restorable copy of the original.
- No network egress except an optional loopback call to a local OpenViking server.
- No credentials are stored, read or forwarded.
- `install.ps1` / `restore.ps1` only ever run when you press the button, and only from
  the directory you configured via `VX_REPAIR_DIR`.

## Supported versions

Only the latest release line receives fixes.
