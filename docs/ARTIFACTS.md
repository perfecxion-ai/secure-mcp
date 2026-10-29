# Verifying build artifacts

CI validates a package installation and restricted container before uploading the npm tarball and production CycloneDX dependency inventory. The artifact name contains the exact source commit: `verified-alpha-<commit>`.

For successful pushes to protected `main`, a separate job downloads those artifacts and creates build-provenance and SBOM attestations. That job has signing permissions but never checks out source, installs dependencies, or executes the package. Pull requests have read-only permissions and do not create attestations. Package publication remains disabled.

The [candidate record](validation/CANDIDATE.md) selects the immutable artifact for fresh-install trials. Prepare it without rebuilding:

```bash
node scripts/prepare-validation.mjs EXACT_MAIN_COMMIT /tmp/secure-mcp-candidate
```

The script requires an unexpired artifact from successful main CI, verifies workflow/ref/source identity, compares the downloaded SBOM with the signed predicate, and writes a checksum/verification manifest. It refuses an existing destination. The [fresh-install guide](validation/REAL_USER_VALIDATION.md) covers installation, feedback, and rollback. GitHub artifact retention is finite; the manifest records its expiry date.

For manual verification after downloading the same artifact, use the GitHub CLI:

```bash
gh attestation verify perfecxion-secure-mcp-server-2.0.0-alpha.1.tgz \
  --repo perfecxion-ai/secure-mcp \
  --signer-workflow perfecxion-ai/secure-mcp/.github/workflows/ci.yml \
  --source-ref refs/heads/main \
  --source-digest EXACT_MAIN_COMMIT
gh attestation verify perfecxion-secure-mcp-server-2.0.0-alpha.1.tgz \
  --repo perfecxion-ai/secure-mcp \
  --predicate-type https://cyclonedx.org/bom \
  --signer-workflow perfecxion-ai/secure-mcp/.github/workflows/ci.yml \
  --source-ref refs/heads/main \
  --source-digest EXACT_MAIN_COMMIT
```

Compare the attested source revision with the intended commit, not only the package version. Alpha builds can share an unreleased version number. Attestation binds a digest to its workflow and source; it does not prove that the code is secure, independently reviewed, or approved for release.

To reverify a retained bundle without downloading the Actions artifact again, run `node scripts/verify-validation.mjs EXACT_MAIN_COMMIT /absolute/path/to/bundle`. This performs fresh GitHub signature verification, compares the signed SBOM with the included file, and checks the manifest's package identity, checksums, and signed workflow-run identity. Saved verification reports are not trusted as substitutes for that check. GitHub attestation access is still required. See [prerelease preparation](RELEASING.md) for staging, publication decisions, and recovery.

The dependency inventory describes the installed production dependency graph at build time. It is not a container OS inventory. The npm tarball is promoted unchanged for validation; container signing and public release publication remain separate work. Fresh consumers resolve and lock their own dependency installation, so retain their lockfile and compare dependency changes before later upgrades.

The repository requires an up-to-date PR with the `Validate runtime` check from GitHub Actions, including for administrators. Force pushes and deletion of `main` are disabled. These settings supplement the workflow; contributors cannot change them by editing YAML.

References: [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) and the [attestation action](https://github.com/actions/attest).
