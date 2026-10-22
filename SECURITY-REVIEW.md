# Security maintenance review — 2026-10-22

This branch hardens the CLI's selected project/template filesystem boundaries, separates package verification from release credentials, restricts agent workflow invocation to current repository writers, and refreshes compatible development dependencies. It has not been released or installed into a live environment.

## Validation

- Node 22.23.4, clean dummy HOME/environment, network-denied local execution.
- 177 tests in 31 files passed, including 22 filesystem boundary cases; TypeScript build and explicit shebang generation passed.
- Baseline boundary regressions reproduced 16 failures before the changes. Two existing CLI label expectations were also corrected to match the published binary name.
- Frozen install with lifecycle scripts disabled passed; final npm audit reported zero advisories (baseline eight groups). Audit is a dependency advisory check, not proof of application safety.
- Packed archive members were checked for containment and ordinary file/directory types, then manually extracted. Packaged CLI help, dry-run and dummy Codex installation passed; AGENTS.md and .kiro/settings were created.
- Authorization mock cases admin/maintain/write allowed, read/triage/none denied, and API error failed closed. Actionlint and release-job credential separation checks passed. No real agent, model, npm publish or production test was invoked.
- Tracked/reachable text and installed dependency indicators were checked locally without displaying secret values. Exact known indicators and secret patterns cannot establish absence of compromise.

## Deployment and rollback

Feature branch/PR workflows only run regression and static security checks; publishing remains tag/manual only. Review and merge through normal protection rules. In a disposable staging project, use Node 22.23.4 or a verified supported patched runtime, install the locked dependencies with scripts disabled, explicitly build/test/shebang/pack, inspect the tarball, then run the packaged CLI against dummy data. Confirm existing regular files, backups and append behavior. Existing linked template/project entries are rejected and require an explicit operator decision before replacing them.

A release needs separate authorization. Preserve the previous package artifact and project backup before installation. Roll back using the prior verified artifact and project backup through the existing release procedure; do not overwrite linked paths or restore a suspected compromised artifact. No migration or user-data deletion is part of this branch.

## Remaining verification

- Filesystem checks are not an OS sandbox against a hostile process concurrently replacing parent directories. Use a private project directory and separate OS/container identity for untrusted concurrent work.
- Pinned agent action revisions still download/install internal tools dynamically. Review and isolate those downloads, tool permissions, network egress and credential access before enabling automation. Repository-write authorization does not make retrieved documents trustworthy.
- Runtime engines and CI pins are configuration evidence, not evidence of installed production/batch versions or restart status. Obtain actual executable/package revision, deployment ID and source commit from the operator.
- Tenant isolation, external-data prompt injection/exfiltration, live publishing permissions, administrator MFA/token inventory, audit logs and backup restoration have not been comprehensively verified. No web/API service was identified in the retrieved repository configuration; external installations are outside that observation.
- Historical logs, unreachable Git objects, published packages and previously installed copies are not covered by local pattern checks. Preserve evidence and investigate separately if an indicator is found.
