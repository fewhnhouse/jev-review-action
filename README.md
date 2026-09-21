# JEV Review Action

A GitHub Action that reviews changed JavaScript and TypeScript with a bounded,
staged [JEV System One](https://typesafe.ai) workflow. It adds line annotations,
writes a job summary, emits machine-readable outputs, and saves a JSON report.

The design is inspired by
[`devagrawal09/jev-review`](https://github.com/devagrawal09/jev-review): code
owns discovery, thresholds, limits, and routing while JEV answers narrow,
structured questions about supplied evidence.

## Quick start

1. Create a TypeSafe API key and save it as the repository secret
   `TYPESAFE_API_KEY`.
2. Add this workflow:

```yaml
name: JEV review

on:
  pull_request:

permissions:
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
        with:
          fetch-depth: 0

      - id: jev
        uses: fewhnhouse/jev-review-action@v1
        with:
          typesafe-api-key: ${{ secrets.TYPESAFE_API_KEY }}
          fail-on-severity: "2"
```

`fetch-depth: 0` is important: the action must be able to resolve both ends of
the comparison. See the complete
[`examples/pull-request.yml`](examples/pull-request.yml).

## Review flow

1. Discover changed `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, and
   `.cts` files with `git diff base...head`.
2. Separate changed tests and provide compact test patches as context.
3. Screen each source patch for correctness, security, reliability,
   compatibility, and test-gap signals using JEV `noul` questions.
4. Follow only signals at or above `0.70`, capped at eight per run.
5. Ask JEV to select the strongest concrete diff hunk.
6. Classify the mechanism, score impact from `0` to `3`, and route significant
   findings to a reviewer specialty.
7. Keep only findings supported by selected evidence and emit annotations,
   summary data, outputs, and a JSON report.

The action does not ask a model for free-form review prose. Every retained
finding has a dimension, selected line, mechanism, confidence, and bounded
severity.

## Inputs

| Input | Required | Default | Why it exists |
| --- | --- | --- | --- |
| `typesafe-api-key` | Yes | — | Authenticates JEV requests. The action masks it and never stores it in reports. |
| `base-sha` | No | Event base | Supports manual and unusual events where a comparison base cannot be inferred. |
| `head-sha` | No | Event head / `GITHUB_SHA` | Makes the reviewed revision explicit and reproducible. |
| `paths` | No | `.` | Limits review to comma- or newline-separated Git pathspecs, such as `src,packages/api`. |
| `max-files` | No | `25` | Bounds cost and latency. Accepted range: `1`–`100`; excess source files are reported as skipped. |
| `fail-on-severity` | No | `none` | Optional policy gate. Set `1`, `2`, or `3` to fail at or above that impact score. |
| `report-path` | No | `jev-review-report.json` | Chooses where the structured report is stored inside the workspace. |

The screening threshold and eight-signal follow-up cap are deliberately code
policy rather than inputs. Keeping those fixed makes results comparable across
runs and prevents accidental cost expansion.

## Outputs

| Output | Meaning |
| --- | --- |
| `findings-count` | Findings that survived evidence selection and impact scoring |
| `blocking-findings-count` | Findings with severity `>= 2` |
| `reviewed-files` | Changed non-test source files screened |
| `report-path` | Absolute path of the generated JSON report |

The JSON report includes the compared revisions, policy values, screening
matrix, changed-test paths, skipped/truncated files, and structured findings.
It does not include source patches or the API key.

## Behavior and limits

- Documentation-only changes succeed with an empty report and make no JEV
  requests.
- Deleted files are ignored because annotations must target the changed file.
- Patches are capped at 24,000 characters per file; truncation is visible in
  the job summary and report.
- The first `max-files` source paths in Git's deterministic output are
  reviewed. Any remainder are listed, not silently discarded.
- Findings are review signals, not proof of a defect. Keep a human reviewer in
  the merge decision.
- This release reviews JavaScript and TypeScript changes only. It does not run
  compilers, linters, tests, or repository code.

## Security

Changed source patches are sent to the TypeSafe API. Confirm that this is
permitted by your organization's policy before enabling the action. Use a
read-only job token, never expose secrets to untrusted fork code, and pin
production actions to reviewed commit SHAs. See [SECURITY.md](SECURITY.md) for
the complete threat model and workflow guidance.

## Development

Requires Node.js 20 or newer.

```bash
npm ci
npm run check
npm run build
```

`dist/` is committed because JavaScript actions execute the bundled entry
point. CI rebuilds it and fails if the checked-in bundle is stale.

## License

[MIT](LICENSE)
