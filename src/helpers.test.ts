import { vi, describe, expect, it } from "vitest";
import {
  batchIssues,
  extractDataToIssues,
  flattenBatchedIssues,
  generateFile,
  getLlamaCloudClient,
  getLogger,
  getOctokitClient,
  getOneWeekAgoDate,
  getRepoDetails,
  issuesToMap,
} from "./helpers";
import type { GitHubIssue, GoodFirstIssue } from "./types";
import { ClassifiedGitHubIssues } from "./types";
import { z } from "zod";

describe("Test getter methods", () => {
  it("test getOneWeekAgoDate", () => {
    const mockDate = new Date(2025, 2, 17);
    vi.setSystemTime(mockDate);
    const oneWeekAgo = getOneWeekAgoDate();
    expect(oneWeekAgo.getDate()).toBe(mockDate.getDate() - 7);
    // reset mocked time
    vi.useRealTimers();
  });
  it("test getOctokitClient with set env variable", () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    // does not throw
    getOctokitClient();
  });
  it("test getOctokitClient with unset env variable", () => {
    vi.stubEnv("GITHUB_TOKEN", undefined);
    // does not throw
    expect(() => getOctokitClient()).toThrow(
      "GITHUB_TOKEN not found within environment",
    );
  });
  it("test getLlamaCloudClient with set env variable", () => {
    vi.stubEnv("LLAMA_CLOUD_API_KEY", "test-api-key");
    // does not throw
    getLlamaCloudClient();
  });
  it("test getLlamaCloudClient with unset env variable", () => {
    vi.stubEnv("LLAMA_CLOUD_API_KEY", undefined);
    // does not throw
    expect(() => getLlamaCloudClient()).toThrow(
      "LLAMA_CLOUD_API_KEY not found within environment",
    );
  });
  it("test getRepoDetails with set env variables", () => {
    vi.stubEnv("REPOSITORY_OWNER", "run-llama");
    vi.stubEnv("REPOSITORY_NAME", "llama_index");
    // does not throw
    getRepoDetails();
  });
  it("test getRepoDetails with unset owner env variable", () => {
    vi.stubEnv("REPOSITORY_OWNER", undefined);
    vi.stubEnv("REPOSITORY_NAME", "llama_index");
    // does not throw
    expect(() => getRepoDetails()).toThrow(
      "REPOSITORY_NAME or REPOSITORY_OWNER not found within environment",
    );
  });
  it("test getRepoDetails with unset name env variable", () => {
    vi.stubEnv("REPOSITORY_OWNER", "run-llama");
    vi.stubEnv("REPOSITORY_NAME", undefined);
    // does not throw
    expect(() => getRepoDetails()).toThrow(
      "REPOSITORY_NAME or REPOSITORY_OWNER not found within environment",
    );
  });
  it("test getRepoDetails with unset envs variable", () => {
    vi.stubEnv("REPOSITORY_OWNER", undefined);
    vi.stubEnv("REPOSITORY_NAME", undefined);
    // does not throw
    expect(() => getRepoDetails()).toThrow(
      "REPOSITORY_NAME or REPOSITORY_OWNER not found within environment",
    );
  });
  it("test getLogger with known level", () => {
    const logger = getLogger("silly");
    expect(logger.settings.minLevel).toBe(0);
  });
  it("test getLogger with unknow level", () => {
    const logger = getLogger("unknown");
    expect(logger.settings.minLevel).toBe(3);
  });
});

const githubIssues: GitHubIssue[] = [
  {
    number: 101,
    content: "Fix null pointer exception in user authentication module",
    hasPr: false,
    labels: ["bug", "high-priority"],
  },
  {
    number: 102,
    content: "Add dark mode support to the dashboard",
    hasPr: true,
    labels: ["enhancement", "ui"],
  },
  {
    number: 103,
    content: "Improve performance of database queries in reports page",
    hasPr: false,
    labels: ["performance", "backend"],
  },
  {
    number: 104,
    content: "Write unit tests for payment processing service",
    hasPr: false,
    labels: ["testing", "backend"],
  },
  {
    number: 105,
    content: "Refactor legacy code in the notification system",
    hasPr: true,
    labels: ["refactor", "tech-debt"],
  },
  {
    number: 106,
    content: "Add pagination to the user list endpoint",
    hasPr: false,
    labels: ["enhancement", "api"],
  },
  {
    number: 107,
    content: "Fix broken link on the 'About Us' page",
    hasPr: true,
    labels: ["bug", "ui"],
  },
  {
    number: 108,
    content: "Implement OAuth2 login with Google",
    hasPr: false,
    labels: ["feature", "auth"],
  },
  {
    number: 109,
    content: "Update dependencies to resolve security vulnerabilities",
    hasPr: false,
    labels: ["security", "dependencies"],
  },
  {
    number: 110,
    content: "Add loading skeleton to the product listing page",
    hasPr: true,
    labels: ["ui", "enhancement"],
  },
  {
    number: 111,
    content: "Fix CSV export including incorrect date format",
    hasPr: false,
    labels: ["bug", "data"],
  },
  {
    number: 112,
    content: "Document the REST API endpoints with Swagger",
    hasPr: false,
    labels: ["documentation", "api"],
  },
  {
    number: 113,
    content: "Add role-based access control to admin panel",
    hasPr: true,
    labels: ["feature", "auth", "backend"],
  },
  {
    number: 114,
    content: "Fix mobile layout breaking on screens under 375px",
    hasPr: false,
    labels: ["bug", "ui", "responsive"],
  },
  {
    number: 115,
    content: "Set up CI/CD pipeline with GitHub Actions",
    hasPr: false,
    labels: ["devops", "ci-cd"],
  },
];

const classifiedGitHubIssues: z.infer<typeof ClassifiedGitHubIssues> = {
  issues: [
    { issue_number: 101, classification: "advanced" },
    { issue_number: 102, classification: "good-first-issue" },
    { issue_number: 103, classification: "advanced" },
    { issue_number: 104, classification: "good-first-issue" },
    { issue_number: 105, classification: "advanced" },
    { issue_number: 106, classification: "good-first-issue" },
    { issue_number: 107, classification: "good-first-issue" },
    { issue_number: 108, classification: "advanced" },
    { issue_number: 109, classification: "advanced" },
    { issue_number: 110, classification: "good-first-issue" },
    { issue_number: 111, classification: "good-first-issue" },
    { issue_number: 112, classification: "good-first-issue" },
    { issue_number: 113, classification: "advanced" },
    { issue_number: 114, classification: "good-first-issue" },
    { issue_number: 115, classification: "advanced" },
  ],
};

const goodFirstIssues: GoodFirstIssue[][] = [
  [
    {
      number: 201,
      goodFirstIssue: true,
      labels: ["good first issue", "documentation"],
    },
    {
      number: 202,
      goodFirstIssue: true,
      labels: ["good first issue", "bug", "ui"],
    },
    {
      number: 203,
      goodFirstIssue: true,
      labels: ["good first issue", "enhancement"],
    },
    {
      number: 204,
      goodFirstIssue: true,
      labels: ["good first issue", "testing"],
    },
    {
      number: 205,
      goodFirstIssue: true,
      labels: ["good first issue", "typo"],
    },
  ],
  [
    {
      number: 206,
      goodFirstIssue: false,
      labels: ["good first issue", "refactor"],
    },
    {
      number: 207,
      goodFirstIssue: true,
      labels: ["good first issue", "ui", "css"],
    },
    {
      number: 208,
      goodFirstIssue: false,
      labels: ["good first issue", "backend"],
    },
    {
      number: 209,
      goodFirstIssue: true,
      labels: ["good first issue", "api", "documentation"],
    },
    {
      number: 210,
      goodFirstIssue: true,
      labels: ["good first issue", "performance"],
    },
  ],
];

describe("Test data transformation methods", () => {
  it("test batchIssues", () => {
    const batches = batchIssues(githubIssues);
    expect(batches.length).toBe(2);
    expect(batches.at(0)?.length).toBe(10);
    expect(batches.at(1)?.length).toBe(5);
    expect(batches.at(0)?.at(0)?.number).toBe(101);
    expect(batches.at(0)?.at(9)?.number).toBe(110);
    expect(batches.at(1)?.at(0)?.number).toBe(111);
    expect(batches.at(1)?.at(4)?.number).toBe(115);
  });
  it("test flattenBatchedIssues", () => {
    const fullList = flattenBatchedIssues(goodFirstIssues);
    expect(fullList.length).toBe(10);
    expect(fullList.at(0)?.number).toBe(201);
    expect(fullList.at(9)?.number).toBe(210);
  });
  it("test issuesToMap", () => {
    const issuesMap = issuesToMap(githubIssues);
    expect(issuesMap.size).toBe(15);
    expect(issuesMap.get(101)?.number).toBe(101);
    expect(issuesMap.get(101)?.content).toBe(
      "Fix null pointer exception in user authentication module",
    );
    expect(issuesMap.get(101)?.hasPr).toBeFalsy();
    expect(issuesMap.get(101)?.labels.length).toBe(2);
    expect(issuesMap.get(116)).toBeUndefined();
  });
  it("test extractDataToIssues", () => {
    const issuesMap = issuesToMap(githubIssues);
    const goodFirstIssues = extractDataToIssues(
      classifiedGitHubIssues,
      issuesMap,
      getLogger("info"),
    );
    expect(
      goodFirstIssues.filter((issue) => {
        return issue.goodFirstIssue;
      }).length,
    ).toBe(8);
    expect(
      goodFirstIssues.filter((issue) => {
        return !issue.goodFirstIssue;
      }).length,
    ).toBe(7);
    const firstIssue = goodFirstIssues.at(0);
    expect(issuesMap.get(firstIssue!.number)?.labels).toBe(firstIssue?.labels);
  });
  it("test generateFile", async () => {
    const file = generateFile(githubIssues);
    expect(file.name).toBe(
      `issues-${githubIssues.at(0)!.number}-${githubIssues.at(githubIssues.length - 1)!.number}.txt`,
    );
    expect(file.type).toBe("text/plain");
    const content = await file.text();
    expect(
      content.includes(
        `## Issue ${githubIssues.at(0)!.number}\n\n${githubIssues.at(0)!.content}`,
      ),
    );
  });
});
