# Verifying build artifacts

CI validates a package installation and restricted container before uploading the npm tarball and production CycloneDX dependency inventory. The artifact name contains the exact source commit: `verified-alpha-<commit>`.

For successful pushes to protected `main`, a separate job downloads those artifacts and creates build-provenance and SBOM attestations. That job has signing permissions but never checks out source, installs dependencies, or executes the package. Pull requests have read-only permissions and do not create attestations. Package publication remains disabled.

Download the artifact from the successful main-branch CI run, then verify it with the GitHub CLI:

```bash
gh attestation verify perfecxion-secure-mcp-server-2.0.0-alpha.1.tgz \
  --repo perfecxion-ai/secure-mcp \
  --signer-workflow perfecxion-ai/secure-mcp/.github/workflows/ci.yml \
  --source-ref refs/heads/main
gh attestation verify perfecxion-secure-mcp-server-2.0.0-alpha.1.tgz \
  --repo perfecxion-ai/secure-mcp \
  --predicate-type https://cyclonedx.org/bom \
  --signer-workflow perfecxion-ai/secure-mcp/.github/workflows/ci.yml \
  --source-ref refs/heads/main
```

Compare the attested source revision with the intended commit, not only the package version. Alpha builds can share an unreleased version number. Attestation binds a digest to its workflow and source; it does not prove that the code is secure, independently reviewed, or approved for release.

The dependency inventory describes the installed production dependency graph at build time. It is not a container OS inventory. Container signing and immutable release promotion remain separate release work.

The repository requires an up-to-date PR with the `Validate runtime` check from GitHub Actions, including for administrators. Force pushes and deletion of `main` are disabled. These settings supplement the workflow; contributors cannot change them by editing YAML.

References: [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) and the [attestation action](https://github.com/actions/attest).
