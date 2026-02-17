import { vi, describe, expect, it } from "vitest";
import * as helpers from "./helpers";
import * as fetcher from "./fetcher";
import LlamaCloud from "@llamaindex/llama-cloud";
import { type GitHubIssue, ClassifiedGitHubIssues } from "./types";
import { z } from "zod";

const mockResponseData = [
  {
    number: 101,
    body: "Fix null pointer exception in user authentication module",
    pull_request: undefined,
    created_at: new Date().toISOString(),
    labels: ["bug", "high-priority"],
  },
  {
    number: 102,
    body: "Add dark mode support to the dashboard",
    pull_request: undefined,
    created_at: new Date().toISOString(),
    labels: ["enhancement", "ui"],
  },
  {
    number: 103,
    body: null, // tests the `?? ""` fallback
    pull_request: { url: "https://github.com/..." }, // will be skipped
    created_at: new Date().toISOString(),
    labels: ["performance", "backend"],
  },
  {
    number: 104,
    body: "Write unit tests for payment processing service",
    pull_request: undefined,
    created_at: new Date(2024, 2, 17).toISOString(),
    labels: ["testing", "backend"],
  },
  {
    number: 105,
    body: "This is a good first issue to start with",
    pull_request: undefined,
    created_at: new Date().toISOString(),
    labels: [{ name: "good first issue" }, { name: "enhancement" }], // will be skipped
  },
];

const mockResponse = {
  status: 200,
  data: mockResponseData,
};

class MockOctokit {
  constructor() {}

  // eslint-disable-next-line
  public async request(...args: any) {
    return mockResponse;
  }
}

const mockFileId = "mock-file-id-123";

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

const mockLlamaCloudClient = {
  files: {
    create: vi.fn().mockResolvedValue({
      id: mockFileId,
    }),
  },
  extraction: {
    extract: vi.fn().mockResolvedValue({
      data: classifiedGitHubIssues,
    }),
  },
} as unknown as LlamaCloud;

vi.mock("./helpers", async () => {
  const actual = await vi.importActual<typeof import("./helpers")>("./helpers");
  return {
    ...actual,
    getOctokitClient: vi.fn(() => {
      return new MockOctokit();
    }),
    issueHasPr: vi.fn(async () => false),
    getLlamaCloudClient: vi.fn(() => mockLlamaCloudClient),
  };
});

describe("test GitHub fetchers", () => {
  it("test getLastWeekIssuesSinglePage", async () => {
    const issues = await fetcher.getLastWeekIssuesSinglePage(
      1,
      { owner: "run-llama", name: "llama_index" },
      helpers.getLogger("silly"),
    );
    expect(issues.length).toBe(2);
    expect(
      issues.filter((issue) => {
        return !issue.hasPr;
      }).length,
    ).toBe(2);
    expect(
      issues.filter((issue) => {
        return issue.number == 101 || issue.number == 102;
      }).length,
    ).toBe(2);
    expect(
      issues.filter((issue) => {
        return issue.labels.includes("good first issue");
      }).length,
    ).toBe(0);
  });
  it("test labelIssue", async () => {
    const client = helpers.getOctokitClient();
    const response = await fetcher.labelIssue(
      client,
      { number: 1, goodFirstIssue: true, labels: ["ui"] },
      { owner: "run-llama", name: "llama_index" },
    );
    // this returns void so this should be undefined if it did not throw
    expect(response).toBeUndefined();
  });
});

describe("test LlamaCloud fetcher", () => {
  it("test areGoodFirstIssues", async () => {
    const issuesMap = helpers.issuesToMap(githubIssues);
    const client = helpers.getLlamaCloudClient();
    const logger = helpers.getLogger("info");
    const goodFirstIssues = await fetcher.areGoodFirstIssues(
      client,
      githubIssues,
      logger,
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
});
