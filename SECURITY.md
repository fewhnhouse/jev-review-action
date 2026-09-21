# Security

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do
not include API keys, private source code, or other secrets in a public issue.

## Data and secret handling

- `api-key` / `typesafe-api-key` is masked with the GitHub Actions toolkit and
  passed directly to the TypeSafe SDK. It is never written to the JSON report.
- `api-base-url` must be an http(s) URL without embedded credentials. The action
  sends patches to that TypeSafe System One endpoint instead of the default
  `https://api.typesafe.ai`. Confirm that the gateway is trusted before pointing
  production reviews at it.
- Changed JavaScript and TypeScript patches, plus compact changed-test context,
  are sent to the configured JEV endpoint for System One evaluation. Confirm that
  this is permitted by your organization's source-code and data-processing policy.
- Reports contain paths, probabilities, classifications, line numbers, and
  severity metadata. They do not contain source patches. The sticky pull
  request comment is rendered from the same fields.
- The report path must remain inside `GITHUB_WORKSPACE`; files are created with
  owner-only permissions (`0600`) on POSIX runners.
- Git revisions and pathspecs are validated and passed to Git without a shell.

## Safe workflow configuration

Give the job read access to contents and write access to pull requests so it
can upsert one sticky summary comment:

```yaml
permissions:
  contents: read
  pull-requests: write
```

Set `post-comment: false` if you want annotations and the job summary without
a conversation comment.

Use `pull_request`, not `pull_request_target`, when checking contributions from
forks. GitHub withholds repository secrets from untrusted fork workflows by
default. Do not bypass that protection or expose a TypeSafe key to code from an
untrusted checkout.

For production workflows, pin this action and every third-party action to a
reviewed full commit SHA. The examples use a moving `v1` tag for readability;
replace it with a release commit after reviewing the source.

The action does not execute changed repository files. It invokes Git to read a
diff, sends bounded patch text to the configured JEV endpoint, writes
annotations, a job summary, an optional sticky pull request comment, and a local
JSON report. Follow-up steps can read `steps.<id>.outputs.*` even when
`fail-on-severity` or a per-category `fail-on-*` screening bar fails the review
step. Confidence floors (`min-confidence`, `confidence-on-*`) ignore replies
that do not clear the bar. The 0.70 follow-up threshold is not a CI fail bar.
