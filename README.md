# JEV Review Action

A GitHub Action that reviews changed JavaScript and TypeScript with a bounded,
staged [JEV System One](https://typesafe.ai) workflow. It adds line annotations,
writes a job summary, posts a dashboard-style sticky pull request comment, emits
machine-readable outputs for follow-up steps, and saves a JSON report.

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
  pull-requests: write

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
          api-key: ${{ secrets.TYPESAFE_API_KEY }}
          fail-on-severity: "2"

      - name: Branch on the review conclusion
        if: always() && steps.jev.outputs.has-findings == 'true'
        run: |
          echo "conclusion=${{ steps.jev.outputs.conclusion }}"
          echo "blocking=${{ steps.jev.outputs.blocking-findings-count }}"
          echo "comment=${{ steps.jev.outputs.comment-url }}"
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
4. Profile the highest-signal files (change category and review priority).
5. Follow only signals at or above `0.70`, capped at eight per run.
6. Ask JEV to select the strongest concrete diff hunk.
7. Classify the mechanism, score impact from `0` to `3`, and route significant
   findings to a reviewer specialty.
8. Keep only findings supported by selected evidence and emit annotations, a
   dashboard comment, outputs, and a JSON report.

The action does not ask a model for free-form review prose. The sticky comment
is a GitHub-flavored dashboard of those fields: headline stats, the workflow
funnel, file profiles, a NOUL heatmap, and retained findings.

## Pluggable API

The TypeSafe SDK is configured through `api-key`, optional `api-base-url`, and
optional `api-model`. Use this when JEV is reached through a reverse proxy or a
Vercel-hosted TypeSafe-compatible gateway.

```yaml
- id: jev
  uses: fewhnhouse/jev-review-action@v1
  with:
    api-key: ${{ secrets.JEV_API_KEY }}
    api-base-url: ${{ vars.JEV_API_BASE_URL }}
    api-model: jev-latest
```

`api-base-url` must speak the TypeSafe System One HTTP API (the same routes as
`https://api.typesafe.ai`). OpenAI chat-completions URLs such as
`https://ai-gateway.vercel.sh/v1` will not work unless that gateway exposes
TypeSafe System One. To use JEV through Vercel, point `api-base-url` at a
TypeSafe-compatible proxy you host on Vercel or at a gateway route that
forwards TypeSafe requests.

`typesafe-api-key` remains as an alias when `api-key` is omitted.

## Inputs

| Input | Required | Default | Why it exists |
| --- | --- | --- | --- |
| `api-key` | One of `api-key` or `typesafe-api-key` | — | Authenticates JEV requests. The action masks it and never stores it in reports. |
| `typesafe-api-key` | Alias for `api-key` | — | Backward-compatible name for the same secret. |
| `api-base-url` | No | TypeSafe default | Overrides the System One API root for a proxy or Vercel-hosted gateway. |
| `api-model` | No | Endpoint default | Sets the TypeSafe SDK `defaultModel`. |
| `base-sha` | No | Event base | Supports manual and unusual events where a comparison base cannot be inferred. |
| `head-sha` | No | Event head / `GITHUB_SHA` | Makes the reviewed revision explicit and reproducible. |
| `paths` | No | `.` | Limits review to comma- or newline-separated Git pathspecs, such as `src,packages/api`. |
| `max-files` | No | `25` | Bounds cost and latency. Accepted range: `1`–`100`; excess source files are reported as skipped. |
| `fail-on-severity` | No | `none` | Optional policy gate. Set `1`, `2`, or `3` to fail at or above that impact score. |
| `report-path` | No | `jev-review-report.json` | Chooses where the structured report is stored inside the workspace. |
| `github-token` | No | `${{ github.token }}` | Creates or updates the sticky pull request summary comment. |
| `post-comment` | No | `true` | Set `false` to keep findings on the check run only. |

The screening threshold, eight-signal follow-up cap, and five-file profile cap
are deliberately code policy rather than inputs. Keeping those fixed makes
results comparable across runs and prevents accidental cost expansion.

## Outputs

Every output is a string so later steps can use `if:` and `${{ steps.jev.outputs.* }}`.
Outputs are written before `fail-on-severity` can fail the job, so a follow-up
step with `if: always()` still sees them.

| Output | Meaning |
| --- | --- |
| `findings-count` | Findings that survived evidence selection and impact scoring |
| `blocking-findings-count` | Findings with severity `>= 2` |
| `request-changes-count` | Findings with action `request_changes` |
| `comment-findings-count` | Findings with action `comment` |
| `reviewed-files` | Changed non-test source files screened |
| `changed-tests` | Changed test files used as screening context |
| `followed-signals` | Signals inspected after the follow-up cap |
| `located-findings` | Signals that produced a supported finding |
| `routed-findings` | Findings routed to a reviewer specialty |
| `skipped-files-count` | Source files skipped because they exceeded `max-files` |
| `has-findings` | `true` or `false` |
| `has-blocking-findings` | `true` or `false` |
| `conclusion` | `success`, `comment`, or `request_changes` |
| `highest-severity` | Highest finding severity, or empty |
| `comment-url` | Sticky comment URL, or empty when none was posted |
| `report-path` | Absolute path of the generated JSON report |

Pass values to another job with job outputs:

```yaml
jobs:
  review:
    outputs:
      conclusion: ${{ steps.jev.outputs.conclusion }}
      report-path: ${{ steps.jev.outputs.report-path }}
```

The JSON report includes the compared revisions, policy values, screening
matrix, file profiles, workflow funnel, changed-test paths, skipped/truncated
files, and structured findings. It does not include source patches or the API
key.

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
- On pull requests, the action upserts one sticky comment tagged
  `<!-- jev-review-action -->`. Comment failures are warnings, not job failures.
- This release reviews JavaScript and TypeScript changes only. It does not run
  compilers, linters, tests, or repository code.

## Security

Changed source patches are sent to the configured JEV endpoint. Confirm that
this is permitted by your organization's policy before enabling the action.
Grant the job `contents: read` and `pull-requests: write` so it can comment; do
not expose secrets to untrusted fork code, and pin production actions to
reviewed commit SHAs. See [SECURITY.md](SECURITY.md) for the complete threat
model and workflow guidance.

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
