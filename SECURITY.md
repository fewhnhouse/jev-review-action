# Security

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do
not include API keys, private source code, or other secrets in a public issue.

## Data and secret handling

- `typesafe-api-key` is masked with the GitHub Actions toolkit and passed
  directly to the TypeSafe SDK. It is never written to the JSON report.
- Changed JavaScript and TypeScript patches, plus compact changed-test context,
  are sent to the TypeSafe API for JEV System One evaluation. Confirm that this
  is permitted by your organization's source-code and data-processing policy.
- Reports contain paths, probabilities, classifications, line numbers, and
  severity metadata. They do not contain source patches.
- The report path must remain inside `GITHUB_WORKSPACE`; files are created with
  owner-only permissions (`0600`) on POSIX runners.
- Git revisions and pathspecs are validated and passed to Git without a shell.

## Safe workflow configuration

Give the job only read access:

```yaml
permissions:
  contents: read
```

Use `pull_request`, not `pull_request_target`, when checking contributions from
forks. GitHub withholds repository secrets from untrusted fork workflows by
default. Do not bypass that protection or expose a TypeSafe key to code from an
untrusted checkout.

For production workflows, pin this action and every third-party action to a
reviewed full commit SHA. The examples use a moving `v1` tag for readability;
replace it with a release commit after reviewing the source.

The action does not execute changed repository files. It invokes Git to read a
diff, sends bounded patch text to TypeSafe, writes annotations and a job
summary, and stores a local JSON report.
