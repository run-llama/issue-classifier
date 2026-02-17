import {
  type GitHubIssue,
  type GoodFirstIssue,
  type RepoDetails,
} from "./types";
import { Logger, type ILogObj } from "tslog";
import {
  getLlamaCloudClient,
  getOctokitClient,
  batchIssues,
  flattenBatchedIssues,
} from "./helpers";
import {
  pageLength,
  getLastWeekIssuesSinglePage,
  areGoodFirstIssues,
  labelIssue,
} from "./fetcher";
import pLimit from "p-limit";

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

export async function classifyIssues(
  issues: GitHubIssue[],
  logger: Logger<ILogObj>,
): Promise<GoodFirstIssue[]> {
  logger.debug("Starting to classify issues.");
  const client = getLlamaCloudClient();
  const limit = pLimit(5);
  const batches = batchIssues(issues);
  const batchedResults = await Promise.all(
    batches.map((batch) =>
      limit(() => areGoodFirstIssues(client, batch, logger)),
    ),
  );
  const results = flattenBatchedIssues(batchedResults);
  const goodFirstIssues = results.filter((issue) => {
    return issue.goodFirstIssue;
  });
  logger.info(`Found ${goodFirstIssues.length} good first issues`);
  return goodFirstIssues;
}

export async function labelIssues(
  issues: GoodFirstIssue[],
  repoDetails: RepoDetails,
  logger: Logger<ILogObj>,
) {
  logger.debug("Starting to update issues with the 'good first issue' label");
  const octokit = getOctokitClient();
  const limit = pLimit(5);
  await Promise.all(
    issues.map((issue) => limit(() => labelIssue(octokit, issue, repoDetails))),
  );
  logger.info("Updated all issues with the 'good first issue' label");
}
