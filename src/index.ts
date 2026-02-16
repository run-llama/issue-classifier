import {
  classifyIssues,
  getLastWeekIssues,
  getRepoDetails,
  labelIssues,
} from "./utils";

async function main(): Promise<void> {
  const repoDetails = getRepoDetails();
  const issues = await getLastWeekIssues(repoDetails);
  const goodFirstIssues = await classifyIssues(issues);
  await labelIssues(goodFirstIssues, repoDetails);
}

await main().catch(console.error);
