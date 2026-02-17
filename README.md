# issue-classifier

Classifier for open issues on a GitHub repository that uses [LlamaExtract](https://developers.llamaindex.ai/python/cloud/llamaextract/getting_started/) to label issues as `good first issue` (suitable for first time contributors).

## Setup and Usage

To install dependencies:

```bash
bun install
```

Export the necessary environment variables:

```bash
export LLAMA_CLOUD_API_KEY="..."
export GITHUB_TOKEN="..."
export REPOSITORY_OWNER="run-llama" # or whatever repository owner
export REPOSITORY_NAME="llama_index" # or whatever repository name
```

Or store them in a `.env` file.

To run:

```bash
bun run src/index.ts <LOG_LEVEL>
```

If not provided, `LOG_LEVEL` defaults to `info`.

## In GitHub CI/CD

Use the GitHub Action to run this script in your GitHub workflows:

```yaml
- name: Classify Issues as Good First Issues
  uses: run-llama/issue-classifier@v0.1.0
  with:
    llama-cloud-api-key: ${{ secrets.LLAMA_CLOUD_API_KEY }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    repository-owner: "run-llama"
    repository-name: "llama_index"
```

Since this action fetches issues from the previous week, it is recommended to run it as a chron job.
