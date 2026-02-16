import type { components } from "@octokit/openapi-types";

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
