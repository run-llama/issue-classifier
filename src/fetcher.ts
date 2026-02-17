import { Octokit } from "octokit";
import {
  type RepoDetails,
  type GitHubIssue,
  type GoodFirstIssue,
  ClassifiedGitHubIssues,
} from "./types";
import LlamaCloud from "@llamaindex/llama-cloud";
import { Logger, type ILogObj } from "tslog";
import type { ExtractConfig } from "@llamaindex/llama-cloud/resources/extraction.js";
import {
  getOctokitClient,
  getOneWeekAgoDate,
  issueHasPr,
  extractDataToIssues,
  issuesToMap,
  generateFile,
} from "./helpers";

export const pageLength: number = 50;

const classificationSystemPrompt = `You are a GitHub issue classifier that helps identify which issues are suitable for first-time contributors versus those requiring experienced developers.

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

export async function getLastWeekIssuesSinglePage(
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

export async function areGoodFirstIssues(
  client: LlamaCloud,
  issues: GitHubIssue[],
  logger: Logger<ILogObj>,
): Promise<GoodFirstIssue[]> {
  logger.debug(
    `Starting to classify issues range: ${issues.at(0)!.number}-${issues.at(issues.length - 1)!.number}`,
  );
  const issuesMap = issuesToMap(issues);
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
      system_prompt: classificationSystemPrompt,
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
}

export async function labelIssue(
  octokit: Octokit,
  issue: GoodFirstIssue,
  repoDetails: RepoDetails,
): Promise<void> {
  const labels = [...issue.labels, "good first issue"];
  const response = await octokit.request(
    "PATCH /repos/{owner}/{repo}/issues/{issue_number}",
    {
      owner: repoDetails.owner,
      repo: repoDetails.name,
      issue_number: issue.number,
      labels: labels,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (response.status >= 299 || response.status < 200) {
    throw Error(`Non-ok status returned by response: ${response.status}`);
  }
}
