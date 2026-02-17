import { vi, describe, expect, it } from "vitest";
import * as helpers from "./helpers";
import * as utils from "./utils";

vi.mock("./fetcher", () => {
  return {
    getLastWeekIssuesSinglePage: vi.fn().mockResolvedValue([
      { content: "hello world", hasPr: false, labels: [], number: 1 },
      { content: "this is a test", hasPr: false, labels: [], number: 2 },
      { content: "ciao mondo", hasPr: false, labels: ["bug"], number: 3 },
      {
        content: "hallo welt",
        hasPr: true,
        labels: ["enhancement"],
        number: 4,
      },
    ]),
    pageLength: 50,
    areGoodFirstIssues: vi.fn().mockResolvedValue([
      { labels: [], number: 1, goodFirstIssue: false },
      { labels: ["bug"], number: 3, goodFirstIssue: true },
      { labels: ["bug"], number: 2, goodFirstIssue: true },
    ]),
    labelIssue: vi.fn().mockImplementation(async () => {}),
  };
});

vi.mock("./helpers", async () => {
  const actual = await vi.importActual<typeof import("./helpers")>("./helpers");
  return {
    ...actual,
    getOctokitClient: vi.fn(),
    getLlamaCloudClient: vi.fn(),
  };
});

describe("Get issues (mock) test", () => {
  it("Get issues", async () => {
    const response = await utils.getLastWeekIssues(
      { owner: "run-llama", name: "llama_index" },
      helpers.getLogger("info"),
    );
    expect(response.length).toBe(3);
    expect(
      response.filter((issue) => {
        return !issue.hasPr;
      }).length,
    ).toBe(3);
  });
});

describe("Classify issues (mock) test", () => {
  it("Classify issues", async () => {
    const response = await utils.classifyIssues(
      [
        { content: "hello world", hasPr: false, labels: [], number: 1 },
        { content: "this is a test", hasPr: false, labels: [], number: 2 },
        { content: "ciao mondo", hasPr: false, labels: ["bug"], number: 3 },
      ],
      helpers.getLogger("info"),
    );
    // three total, two good first issues
    expect(response.length).toBe(2);
  });
});

describe("Update issues (mock) test", () => {
  it("Update issues", async () => {
    const response = await utils.labelIssues(
      [
        { labels: ["bug"], number: 3, goodFirstIssue: true },
        { labels: ["bug"], number: 2, goodFirstIssue: true },
      ],
      { owner: "run-llama", name: "llama_index" },
      helpers.getLogger("info"),
    );
    // the function returns void so this should be undefined
    expect(response).toBeUndefined();
  });
});
