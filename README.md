# Pull PR Merge Commitlint

<!-- prettier-ignore -->
This action checks if PR titles conform commitlint header and the body conforms to commitlint body.

## Usage

Create a config file `.github/pr-merge-commitlint.json` like this one below:

```json
{
  "LABEL": {
    "name": "title/description needs formatting",
    "color": "EEEEEE"
  },
  "CHECKS": {
    "prefixes": ["fix: ", "feat: "],
    "regexp": "docs\\(v[0-9]\\): ",
    "regexpFlags": "i",
    "ignoreLabels" : ["dont-check-PRs-with-this-label", "meta"]
  },
  "MESSAGES": {
    "success": "All OK",
    "failure": "Failing CI test",
    "notice": ""
  }
}
```

## Create Workflow

Create a workflow file (eg: `.github/workflows/pr-title-checker.yml`) with the following content:

```yaml
name: "PR Commitlint Checker"
on:
  pull_request_target:
    types:
      - opened
      - edited
      - synchronize
      - labeled
      - unlabeled

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: AlexisTM/pr-merge-commitlint@v1.0.0
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          pass_on_octokit_error: false
          configuration_path: .github/pr-merge-commitlint.json #(optional. defaults to .github/pr-merge-commitlint.json)
```
