# JEV Review Action

A GitHub Action that reviews changed JavaScript and TypeScript with a bounded,
staged [JEV System One](https://typesafe.ai) workflow. It adds line annotations,
writes a job summary, posts a compact sticky pull request comment, emits
machine-readable outputs for follow-up steps, and saves a JSON report.

The design is inspired by
[`devagrawal09/jev-review`](https://github.com/devagrawal09/jev-review): code
owns discovery, thresholds, limits, and routing while JEV answers narrow,
structured questions about supplied evidence. JEV never writes review prose.

Please note: This is just a demo, and not meant to be used for production. Jev is a System One model, and not necessarily fit to judge code, which might require complex decision making.

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
          fail-on-security: "0.7"
          min-confidence: "0.8"
```

`fetch-depth: 0` is important: the action must be able to resolve both ends of
the comparison. See the complete
[`examples/pull-request.yml`](examples/pull-request.yml).

## How it works

1. Discover changed `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, and
   `.cts` files with `git diff base...head`.
2. Separate changed tests and provide compact test patches as context.
3. Screen each source patch with JEV `noul` questions for five categories:
   correctness, security, reliability, compatibility, and test gap. Each cell
   is the probability (0–1) that the patch introduces that problem.
4. Profile the highest-signal files (`choice` change type and `score` review
   priority, 0–3).
5. Follow signals at or above `0.70`, capped at eight per run. That 0.70 value
   is an inspect bar, not a CI fail bar.
6. Ask JEV to select the strongest concrete diff hunk (`choice`).
7. Classify the mechanism, score impact from 0 to 3, and route significant
   findings to a reviewer specialty.
8. Keep only findings supported by selected evidence.

There is no combined overall score. Each category has its own peak. The job
stays green unless you set `fail-on-severity` and/or a per-category
`fail-on-*` bar, and a reply actually clears those bars (and any confidence
floor).

The screening threshold, eight-signal follow-up cap, and five-file profile cap
are code policy rather than inputs so results stay comparable and cost stays
bounded.

## Sticky comment

On pull requests the action upserts one comment tagged
`<!-- jev-review-action -->`. It is a scan of this review, not a primer:

- Check passed or failed, with fail reasons only when a bar was crossed
- Peak probability and confidence per category, with the file and configured
  bars
- Highest finding severity
- Counts: files, tests, followed, findings, request changes
- Workflow funnel: cells → signals → inspected → located → routed
- File profiles: type, priority, confidence
- Risk matrix: probability (bold if ≥ 0.70) with confidence underneath
- Findings: concern, severity, confidence, owner, action

How the stages, noul values, and bars work lives in this README, not in the
comment. Comment failures are warnings, not job failures. Set
`post-comment: false` to skip it.

## Fail bars and confidence

`fail-on-severity` (`none`, `1`, `2`, or `3`) fails the job when a finding's
impact reaches that score.

`fail-on-correctness`, `fail-on-security`, `fail-on-reliability`,
`fail-on-compatibility`, and `fail-on-test-gap` (`none` or `0`–`1`) fail when
any file's screening probability in that category is at or above the bar.

JEV **noul** answers are a yes-probability only; the official System One API
does not send a separate `confidence` on those cells. Choice and Score answers
(profiles, hunk selection, mechanism, severity, owner) do.

This action still lets you require confidence before a fail bar counts:

| Input | Applies to |
| --- | --- |
| `min-confidence` | Default floor for every category |
| `confidence-on-correctness` (and the other four) | Override for that category |

A screening cell uses the endpoint's noul `confidence` when present. Otherwise
it uses binary concentration `2 × |noul − 0.5|` (0 at a coin-flip, 1 at a
definite yes or no). Findings use the lowest of location, mechanism, severity,
and owner confidence. A bar only fires when both the score and the confidence
floor are met. `none` (the default) respects every reply.

```yaml
with:
  api-key: ${{ secrets.TYPESAFE_API_KEY }}
  fail-on-severity: "2"
  fail-on-security: "0.7"
  fail-on-correctness: "0.85"
  min-confidence: "0.8"
  confidence-on-test-gap: "0.6"
```

`check-passed` is `true` when no configured bar was crossed. Outputs are
written before a fail bar can fail the job, so a follow-up step with
`if: always()` still sees them.

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
| `fail-on-severity` | No | `none` | Fail the job when a finding's impact score is at or above `1`, `2`, or `3`. |
| `fail-on-correctness` | No | `none` | Fail when any file's correctness probability is at or above this `0`–`1` value. |
| `fail-on-security` | No | `none` | Fail when any file's security probability is at or above this `0`–`1` value. |
| `fail-on-reliability` | No | `none` | Fail when any file's reliability probability is at or above this `0`–`1` value. |
| `fail-on-compatibility` | No | `none` | Fail when any file's compatibility probability is at or above this `0`–`1` value. |
| `fail-on-test-gap` | No | `none` | Fail when any file's test-gap probability is at or above this `0`–`1` value. |
| `min-confidence` | No | `none` | Minimum confidence required before any fail bar counts. |
| `confidence-on-correctness` | No | `none` | Correctness confidence floor; overrides `min-confidence`. |
| `confidence-on-security` | No | `none` | Security confidence floor; overrides `min-confidence`. |
| `confidence-on-reliability` | No | `none` | Reliability confidence floor; overrides `min-confidence`. |
| `confidence-on-compatibility` | No | `none` | Compatibility confidence floor; overrides `min-confidence`. |
| `confidence-on-test-gap` | No | `none` | Test-gap confidence floor; overrides `min-confidence`. |
| `report-path` | No | `jev-review-report.json` | Chooses where the structured report is stored inside the workspace. |
| `github-token` | No | `${{ github.token }}` | Creates or updates the sticky pull request summary comment. |
| `post-comment` | No | `true` | Set `false` to keep findings on the check run only. |

## Outputs

Every output is a string so later steps can use `if:` and `${{ steps.jev.outputs.* }}`.

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
| `check-passed` | `true` when no configured fail bar was crossed |
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
matrix (probabilities and confidences), file profiles, workflow funnel,
changed-test paths, skipped/truncated files, and structured findings. It does
not include source patches or the API key.

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
