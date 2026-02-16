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
import { Logger, type ILogObj } from "tslog";

const classificationRules: ClassifierRule[] = [
  {
    type: "good-first-issue",
    description: `
      The GitHub issue is suitable for first-time contributors.
      Characteristics may include:
      - Small, well-scoped tasks that can be completed in a few hours or days.
      - Clear steps, examples, or instructions provided.
      - Low dependency on complex internal knowledge.
      - Low risk of breaking core functionality.
    `,
  },
  {
    type: "advanced",
    description: `
      The GitHub issue is advanced and not suitable for first-time contributors.
      Characteristics may include:
      - Large or complex tasks requiring deep understanding of the codebase.
      - Requires knowledge of advanced concepts or multiple systems.
      - Dependencies on ongoing work or external integrations.
      - High risk of regressions or breaking core functionality.
      - Tasks intended for experienced contributors or maintainers.
    `,
  },
];

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
  logger: Logger<ILogObj>,
): Promise<GoodFirstIssue> {
  logger.debug(`Starting to classify ${issue.number}`);
  const lock = await semaphore.acquire();
  try {
    const fileObj = await client.files.create({
      file: generateFile(issue),
      purpose: "classify",
    });
    logger.info(`Uploaded file with ID ${fileObj.id}`);
    const classifyResponse = await client.classifier.classify({
      file_ids: [fileObj.id],
      rules: classificationRules,
      mode: "FAST",
    });
    if (classifyResponse.items.length == 0) {
      logger.error("No result produced");
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
      logger.info(
        `Classified issue ${issue.number} as ${resultItem.result.type} with a confidence of ${resultItem.result.confidence * 100}%.`,
      );
      logger.silly(`Reasons: ${resultItem.result.reasoning}`);
      return {
        goodFirstIssue: resultItem.result.type === "good-first-issue",
        number: issue.number,
        labels: issue.labels,
      };
    }
    logger.info(`Issue ${issue.number} is not a good first issue`);
    return {
      number: issue.number,
      goodFirstIssue: false,
      labels: issue.labels,
    };
  } finally {
    lock.release();
  }
}

export async function classifyIssues(
  issues: GitHubIssue[],
  logger: Logger<ILogObj>,
): Promise<GoodFirstIssue[]> {
  logger.debug("Starting to classify issues.");
  const client = getLlamaCloudClient();
  const semaphore = new CountingSemaphore("classify", 5, logger);
  const results = await Promise.all(
    issues.map((issue) => isGoodFirstIssue(client, issue, semaphore, logger)),
  );
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
