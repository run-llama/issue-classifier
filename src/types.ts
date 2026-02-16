import type { components } from "@octokit/openapi-types";
import { z } from "zod";

export type CrossReferencedEvent =
  components["schemas"]["timeline-cross-referenced-event"];

export type GitHubIssue = {
  number: number;
  content: string;
  hasPr: boolean;
  labels: string[];
};

export type GoodFirstIssue = {
  number: number;
  goodFirstIssue: boolean;
  labels: string[];
};

export type RepoDetails = {
  owner: string;
  name: string;
};

export const GitHubIssueClassification = z.object({
  issue_number: z.number().describe("Number of the issue"),
  classification: z
    .enum(["good-first-issue", "advanced"])
    .describe(
      "The issue is human-approachable and suitable for first-time contributors (good-first-issue) or the issue is advanced and includes many parts that touch core functionalities (advanced)",
    ),
});

export const ClassifiedGitHubIssues = z.object({
  issues: z
    .array(GitHubIssueClassification)
    .describe("List of classified GitHub issues"),
});
