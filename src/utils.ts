import { Octokit } from "octokit";
import type {
  CrossReferencedEvent,
  GitHubIssue,
  GoodFirstIssue,
  RepoDetails,
} from "./types";
import LlamaCloud from "@llamaindex/llama-cloud";
import { CountingSemaphore } from "./semaphore";
import type { ClassifierRule } from "@llamaindex/llama-cloud/resources/classifier.js";

const classificationRules: ClassifierRule[] = [
  {
    type: "good-first-issue",
    description: "the GitHub issue is suitable for first-time contributors",
  },
  {
    type: "advanced",
    description:
      "the GitHub issue is advanced and not suitable for first-time contributors",
  },
];

function getOctokitClient(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN not found within environment");
  }
  const octokit = new Octokit({ auth: token });
  return octokit;
}

function getLlamaCloudClient(): LlamaCloud {
  const apiKey = process.env.LLAMA_CLOUD_API_KEY;
  if (!apiKey) {
    throw new Error("LLAMA_CLOUD_API_KEY not found within environment");
  }
  const client = new LlamaCloud({ apiKey: apiKey });
  return client;
}

function getOneWeekAgoDate(): Date {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  return oneWeekAgo;
}

export function getRepoDetails(): RepoDetails {
  const owner = process.env.REPOSITORY_OWNER;
  const name = process.env.REPOSITORY_NAME;
  if (!owner || !name) {
    throw new Error(
      "REPOSITORY_NAME or REPOSITORY_OWNER not found within environment",
    );
  }
  return { owner, name };
}

async function issueHasPr(
  client: Octokit,
  issue_number: number,
  repoDetails: RepoDetails,
): Promise<boolean> {
  const response = await client.request(
    "GET /repos/{owner}/{repo}/issues/{issue_number}/timeline",
    {
      owner: repoDetails.owner,
      repo: repoDetails.name,
      issue_number: issue_number,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (response.status != 200) {
    return false;
  }
  if (response.data.length == 0) {
    return false;
  }
  const filteredEvents: CrossReferencedEvent[] = response.data.filter(
    (event): event is CrossReferencedEvent => {
      return event.event === "cross-referenced";
    },
  );
  for (const event of filteredEvents) {
    if (event.source.issue) {
      if (event.source.issue.pull_request) {
        return true;
      }
    }
  }
  return false;
}

async function getLastWeekIssuesSinglePage(
  page: number,
  repoDetails: RepoDetails,
): Promise<GitHubIssue[]> {
  const octokit = getOctokitClient();
  const response = await octokit.request("GET /repos/{owner}/{repo}/issues", {
    owner: repoDetails.owner,
    repo: repoDetails.name,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
    since: getOneWeekAgoDate().toISOString(),
    page: page,
    per_page: 50,
  });
  const issues: GitHubIssue[] = [];
  if (response.status == 200 && response.data.length > 0) {
    for (const issue of response.data) {
      if (issue) {
        let isGoodFirstIssue: boolean = false;
        const labs = [];
        for (const label of issue.labels) {
          if (typeof label === "string") {
            if (
              label.toLowerCase().includes("good") &&
              label.toLowerCase().includes("first") &&
              label.toLowerCase().includes("issue")
            ) {
              isGoodFirstIssue = true;
            }
            labs.push(label);
          } else {
            if (
              label.name &&
              label.name.toLowerCase().includes("good") &&
              label.name.toLowerCase().includes("first") &&
              label.name.toLowerCase().includes("issue")
            ) {
              isGoodFirstIssue = true;
            }
            if (label.name) {
              labs.push(label.name);
            }
          }
        }
        if (!isGoodFirstIssue) {
          const hasPr = await issueHasPr(octokit, issue.number, repoDetails);
          issues.push({
            number: issue.number,
            content: issue.body ?? "",
            hasPr,
            labels: labs,
          });
        } else {
          continue;
        }
      }
    }
  }
  return issues;
}

export async function getLastWeekIssues(
  repoDetails: RepoDetails,
): Promise<GitHubIssue[]> {
  const page = 1;
  const allIssues = [];
  while (true) {
    const issues = await getLastWeekIssuesSinglePage(page, repoDetails);
    if (issues.length == 0) {
      break;
    }
    allIssues.push(...issues);
  }
  return allIssues;
}

function generateFile(issue: GitHubIssue): File {
  const file = new File([issue.content], `issue-${issue.number}.txt`, {
    type: "text/plain",
  });
  return file;
}

async function isGoodFirstIssue(
  client: LlamaCloud,
  issue: GitHubIssue,
  semaphore: CountingSemaphore,
): Promise<GoodFirstIssue> {
  await semaphore.acquire();

  try {
    const fileObj = await client.files.create({
      file: generateFile(issue),
      purpose: "classify",
    });
    const classifyResponse = await client.classifier.classify({
      file_ids: [fileObj.id],
      rules: classificationRules,
      mode: "FAST",
    });
    if (classifyResponse.items.length == 0) {
      return {
        number: issue.number,
        goodFirstIssue: false,
        labels: issue.labels,
      };
    }
    const resultItem = classifyResponse.items[0];
    if (
      resultItem &&
      resultItem.result &&
      resultItem.result.type &&
      resultItem.result.confidence > 0.5
    ) {
      return {
        goodFirstIssue: resultItem.result.type === "good-first-issue",
        number: issue.number,
        labels: issue.labels,
      };
    }
    return {
      number: issue.number,
      goodFirstIssue: false,
      labels: issue.labels,
    };
  } finally {
    semaphore.release();
  }
}

export async function classifyIssues(
  issues: GitHubIssue[],
): Promise<GoodFirstIssue[]> {
  const client = getLlamaCloudClient();
  const semaphore = new CountingSemaphore(5);
  const results = await Promise.all(
    issues.map((issue) => isGoodFirstIssue(client, issue, semaphore)),
  );
  const goodFirstIssues = results.filter((issue) => {
    return issue.goodFirstIssue;
  });
  return goodFirstIssues;
}

async function labelIssue(
  octokit: Octokit,
  issue: GoodFirstIssue,
  semaphore: CountingSemaphore,
  repoDetails: RepoDetails,
): Promise<void> {
  const labels = [...issue.labels, "good first issue"];
  await semaphore.acquire();
  try {
    await octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
      owner: repoDetails.owner,
      repo: repoDetails.name,
      issue_number: issue.number,
      labels: labels,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } finally {
    semaphore.release();
  }
}

export async function labelIssues(
  issues: GoodFirstIssue[],
  repoDetails: RepoDetails,
) {
  const octokit = getOctokitClient();
  const semaphore = new CountingSemaphore(5);
  await Promise.all(
    issues.map((issue) => labelIssue(octokit, issue, semaphore, repoDetails)),
  );
}
