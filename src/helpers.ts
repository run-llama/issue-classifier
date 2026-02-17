import { Octokit } from "octokit";
import {
  type CrossReferencedEvent,
  type RepoDetails,
  type GitHubIssue,
  type GoodFirstIssue,
  ClassifiedGitHubIssues,
} from "./types";
import LlamaCloud from "@llamaindex/llama-cloud";
import { Logger, type ILogObj } from "tslog";
import { File } from "buffer";

const logLevels = new Map<string, number>([
  ["silly", 0],
  ["trace", 1],
  ["debug", 2],
  ["info", 3],
  ["warn", 4],
  ["error", 5],
  ["fatal", 6],
]);

const issuesBatchSize = 10;

export function getOctokitClient(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN not found within environment");
  }
  const octokit = new Octokit({ auth: token });
  return octokit;
}

export function getLlamaCloudClient(): LlamaCloud {
  const apiKey = process.env.LLAMA_CLOUD_API_KEY;
  if (!apiKey) {
    throw new Error("LLAMA_CLOUD_API_KEY not found within environment");
  }
  const client = new LlamaCloud({ apiKey: apiKey });
  return client;
}

export function getOneWeekAgoDate(): Date {
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

export function getLogger(level: string): Logger<ILogObj> {
  const log: Logger<ILogObj> = new Logger({
    minLevel: logLevels.get(level) ?? 3,
  });
  return log;
}

export async function issueHasPr(
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

export function batchIssues(issues: GitHubIssue[]): GitHubIssue[][] {
  const batches: GitHubIssue[][] = [];
  for (let i = 0; i < issues.length; i += issuesBatchSize) {
    batches.push(issues.slice(i, i + issuesBatchSize));
  }
  return batches;
}

export function flattenBatchedIssues(
  batches: GoodFirstIssue[][],
): GoodFirstIssue[] {
  const issues: GoodFirstIssue[] = [];
  for (const batch of batches) {
    for (const issue of batch) {
      issues.push(issue);
    }
  }
  return issues;
}

export function issuesToMap(issues: GitHubIssue[]): Map<number, GitHubIssue> {
  const m: Map<number, GitHubIssue> = new Map();
  for (const issue of issues) {
    m.set(issue.number, issue);
  }
  return m;
}

export function extractDataToIssues(
  data: {
    [key: string]:
      | string
      | number
      | boolean
      | unknown[]
      | {
          [key: string]: unknown;
        }
      | null;
  },
  issuesMap: Map<number, GitHubIssue>,
  logger: Logger<ILogObj>,
): GoodFirstIssue[] {
  const parsedData = ClassifiedGitHubIssues.parse(data);
  const issues: GoodFirstIssue[] = [];
  for (const issue of parsedData.issues) {
    logger.debug(
      `Issue ${issue.issue_number} classified as ${issue.classification}`,
    );
    const ghIssue = issuesMap.get(issue.issue_number);
    if (ghIssue) {
      issues.push({
        labels: ghIssue.labels,
        number: issue.issue_number,
        goodFirstIssue: issue.classification === "good-first-issue",
      });
    }
  }
  return issues;
}

export function generateFile(issues: GitHubIssue[]): File {
  let content: string = "";
  for (const issue of issues) {
    if (issue.content != "") {
      content += `## Issue ${issue.number}\n\n${issue.content}`;
    }
  }
  const file = new File(
    [content],
    `issues-${issues.at(0)!.number}-${issues.at(issues.length - 1)!.number}.txt`,
    {
      type: "text/plain",
    },
  );
  return file;
}
