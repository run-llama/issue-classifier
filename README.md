# issue-classifier

Classifier for open issues on the `run-llama/llama_index` repository that uses [LlamaClassify](https://developers.llamaindex.ai/python/cloud/llamaclassify/getting_started/) to label issues as `good-first-issue` (suitable for first time contributors).

## Setup

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run src/index.ts <LOG_LEVEL>
```

If not provided, `LOG_LEVEL` defaults to `info`.
