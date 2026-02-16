import {
  classifyIssues,
  getLastWeekIssues,
  getLogger,
  getRepoDetails,
  labelIssues,
} from "./utils";

async function main(): Promise<void> {
  const firstArg = process.argv.at(2);
  if (firstArg && firstArg === "help") {
    console.log(
      "Start the issue classification task.\nArguments:\n\tLOG_LEVEL: the logging level to use (allowed values: 'silly', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'). Defaults to 'info'",
    );
    return;
  } else if (!firstArg) {
    console.log(
      "Welcome to issue-classifier.\nRun `bun run src/index.ts help` to know more about the options for this tool.",
    );
  }
  const logger = getLogger(firstArg ?? "info");
  const repoDetails = getRepoDetails();
  const issues = await getLastWeekIssues(repoDetails, logger);
  const goodFirstIssues = await classifyIssues(issues, logger);
  await labelIssues(goodFirstIssues, repoDetails, logger);
}

await main().catch(console.error);
