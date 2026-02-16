import { Octokit } from "octokit";
import {
  ClassifiedGitHubIssues,
  type CrossReferencedEvent,
  type GitHubIssue,
  type GoodFirstIssue,
  type RepoDetails,
} from "./types";
import LlamaCloud from "@llamaindex/llama-cloud";
import { CountingSemaphore } from "./semaphore";
import type { ExtractConfig } from "@llamaindex/llama-cloud/resources/extraction.js";
import { Logger, type ILogObj } from "tslog";

const issuesBatchSize = 10;

const classoficationSystemPrompt = `You are a GitHub issue classifier that helps identify which issues are suitable for first-time contributors versus those requiring experienced developers.

Your task is to analyze GitHub issues and classify each one into one of two categories:

**good-first-issue**: Issues that are human-approachable and suitable for first-time contributors to this project. These issues help new contributors get familiar with the codebase and contribution workflow. They may still be challenging but should be approachable without deep project-specific knowledge.

Characteristics include:
- Well-scoped tasks with clear boundaries and acceptance criteria
- Self-contained changes that don't require understanding multiple interconnected systems
- Clear context, examples, or pointers to relevant code sections provided
- Limited dependencies on other ongoing work or external integrations
- Changes isolated to a single feature or component, reducing risk to core functionality
- May involve meaningful work like bug fixes, feature additions, or refactoring, not just trivial changes

**advanced**: Issues that are highly complex and require experienced contributors familiar with the project. These issues involve multiple moving parts and deep architectural understanding.

Characteristics include:
- Large-scale changes spanning multiple systems, components, or layers of the application
- Requires deep understanding of core architecture, design patterns, or business logic
- Involves critical functionality where errors could cause widespread regressions or system failures
- Dependencies on multiple integrations, external services, or ongoing development efforts
- Requires coordination with maintainers or other contributors
- May need expertise in specific domains, technologies, or complex algorithms
- High risk of cascading effects across the codebase

For each issue provided, analyze it to determine the appropriate classification.`;

const pageLength = 50;

const logLevels = new Map<string, number>([
  ["silly", 0],
  ["trace", 1],
  ["debug", 2],
  ["info", 3],
  ["warn", 4],
  ["error", 5],
  ["fatal", 6],
]);

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

export function getLogger(level: string): Logger<ILogObj> {
  const log: Logger<ILogObj> = new Logger({
    minLevel: logLevels.get(level) ?? 1,
  });
  return log;
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
  logger: Logger<ILogObj>,
): Promise<GitHubIssue[]> {
  const octokit = getOctokitClient();
  const sinceDate = getOneWeekAgoDate();
  const response = await octokit.request("GET /repos/{owner}/{repo}/issues", {
    owner: repoDetails.owner,
    repo: repoDetails.name,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
    since: sinceDate.toISOString().split(".").at(0) + "Z",
    sort: "created",
    page: page,
    per_page: pageLength,
    state: "open",
  });
  const issues: GitHubIssue[] = [];
  if (response.status == 200 && response.data.length > 0) {
    for (const issue of response.data) {
      if (issue) {
        if (issue.pull_request) {
          logger.silly(`${issue.number} is a pull request, skipping`);
          continue;
        }
        const creationTime = Date.parse(issue.created_at);
        if (sinceDate.getTime() > creationTime) {
          logger.silly(
            `Issue ${issue.number} was created before ${sinceDate.toISOString()}, so it will be skipped`,
          );
          continue;
        }
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
          logger.silly(`Issue ${issue.number} has PR: ${hasPr}`);
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
  logger.debug(`Found ${issues.length} issues for page ${page}`);
  return issues;
}

export async function getLastWeekIssues(
  repoDetails: RepoDetails,
  logger: Logger<ILogObj>,
): Promise<GitHubIssue[]> {
  logger.debug("Starting to get last week's issues.");
  const page = 1;
  const allIssues = [];
  while (true) {
    logger.debug(`Retrieving issues for page ${page}`);
    const issues = await getLastWeekIssuesSinglePage(page, repoDetails, logger);
    const filteredIssues = issues.filter((issue) => {
      return !issue.hasPr;
    });
    allIssues.push(...filteredIssues);
    if (issues.length < pageLength) {
      break;
    }
  }
  logger.info(
    `Found ${allIssues.length} total issues that do not have associated PRs`,
  );
  return allIssues;
}

function generateFile(issues: GitHubIssue[]): File {
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

function issuesToMap(issues: GitHubIssue[]): Map<number, GitHubIssue> {
  const m: Map<number, GitHubIssue> = new Map();
  for (const issue of issues) {
    m.set(issue.number, issue);
  }
  return m;
}

function extractDataToIssues(
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

async function areGoodFirstIssues(
  client: LlamaCloud,
  issues: GitHubIssue[],
  semaphore: CountingSemaphore,
  logger: Logger<ILogObj>,
): Promise<GoodFirstIssue[]> {
  logger.debug(
    `Starting to classify issues range: ${issues.at(0)!.number}-${issues.at(issues.length - 1)!.number}`,
  );
  const lock = await semaphore.acquire();
  const issuesMap = issuesToMap(issues);
  try {
    const fileObj = await client.files.create({
      file: generateFile(issues),
      purpose: "extract",
    });
    logger.info(`Uploaded file with ID ${fileObj.id}`);
    const extractResponse = await client.extraction.extract({
      file_id: fileObj.id,
      data_schema: JSON.parse(
        JSON.stringify(ClassifiedGitHubIssues.toJSONSchema()),
      ),
      config: {
        extraction_mode: "BALANCED",
        system_prompt: classoficationSystemPrompt,
      } as ExtractConfig,
    });
    const firstIssues: GoodFirstIssue[] = [];
    if (!extractResponse.data) {
      return firstIssues;
    }
    const classifiedIssues: GoodFirstIssue[] = [];
    if (!Array.isArray(extractResponse.data)) {
      const extractedIssues = extractDataToIssues(
        extractResponse.data,
        issuesMap,
        logger,
      );
      classifiedIssues.push(...extractedIssues);
    } else {
      const data = extractResponse.data.at(0);
      if (data) {
        const extractedIssues = extractDataToIssues(data, issuesMap, logger);
        classifiedIssues.push(...extractedIssues);
      }
    }
    return classifiedIssues;
  } finally {
    lock.release();
  }
}

function batchIssues(issues: GitHubIssue[]): GitHubIssue[][] {
  const batches: GitHubIssue[][] = [];
  for (let i = 0; i < issues.length; i += issuesBatchSize) {
    batches.push(issues.slice(i, i + issuesBatchSize));
  }
  return batches;
}

function flattenBatchedIssues(batches: GoodFirstIssue[][]): GoodFirstIssue[] {
  const issues: GoodFirstIssue[] = [];
  for (const batch of batches) {
    for (const issue of batch) {
      issues.push(issue);
    }
  }
  return issues;
}

export async function classifyIssues(
  issues: GitHubIssue[],
  logger: Logger<ILogObj>,
): Promise<GoodFirstIssue[]> {
  logger.debug("Starting to classify issues.");
  const client = getLlamaCloudClient();
  const semaphore = new CountingSemaphore("classify", 5, logger);
  const batches = batchIssues(issues);
  const batchedResults = await Promise.all(
    batches.map((batch) =>
      areGoodFirstIssues(client, batch, semaphore, logger),
    ),
  );
  const results = flattenBatchedIssues(batchedResults);
  const goodFirstIssues = results.filter((issue) => {
    return issue.goodFirstIssue;
  });
  logger.info(`Found ${goodFirstIssues.length} good first issues`);
  return goodFirstIssues;
}

async function labelIssue(
  octokit: Octokit,
  issue: GoodFirstIssue,
  semaphore: CountingSemaphore,
  repoDetails: RepoDetails,
): Promise<void> {
  const labels = [...issue.labels, "good first issue"];
  const lock = await semaphore.acquire();
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
    lock.release();
  }
}

export async function labelIssues(
  issues: GoodFirstIssue[],
  repoDetails: RepoDetails,
  logger: Logger<ILogObj>,
) {
  logger.debug("Starting to update issues with the 'good first issue' label");
  const octokit = getOctokitClient();
  const semaphore = new CountingSemaphore("update-issues", 5, logger);
  await Promise.all(
    issues.map((issue) => labelIssue(octokit, issue, semaphore, repoDetails)),
  );
  logger.info("Updated all issues with the 'good first issue' label");
}
