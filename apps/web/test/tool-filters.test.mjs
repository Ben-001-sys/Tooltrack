import assert from "node:assert/strict";
import { test } from "node:test";
import { filterTools } from "../src/lib/tools.ts";

const finance = { id: "finance" };
const hr = { id: "hr" };
const operations = { id: "operations" };
const tools = [
  {
    name: "Excel",
    description: "Reporting",
    accessType: "SUBSCRIPTION",
    categoryId: "productivity",
    tags: [finance],
  },
  {
    name: "Sheets",
    description: "Reporting",
    accessType: "SUBSCRIPTION",
    categoryId: "productivity",
    tags: [hr],
  },
  {
    name: "Calc",
    description: "Reporting",
    accessType: "FREE",
    categoryId: "productivity",
    tags: [finance],
  },
  {
    name: "Warehouse",
    description: "Reporting",
    accessType: "SUBSCRIPTION",
    categoryId: "productivity",
    tags: [operations],
  },
  {
    name: "Dashboard",
    description: "Reporting",
    accessType: "SUBSCRIPTION",
    categoryId: "other",
    tags: [finance, hr],
  },
  {
    name: "Calendar",
    description: null,
    accessType: "SUBSCRIPTION",
    categoryId: "productivity",
    tags: [hr],
  },
  {
    name: "Notes",
    description: null,
    accessType: "FREE",
    categoryId: "productivity",
    tags: [],
  },
];

test("matches any selected department and combines it with every other filter", () => {
  assert.deepEqual(
    filterTools(tools, " REPORTING ", "SUBSCRIPTION", "productivity", [
      finance.id,
      hr.id,
    ]),
    tools.slice(0, 2),
  );
  assert.deepEqual(filterTools(tools, "", "ALL", "ALL", [operations.id]), [
    tools[3],
  ]);
  assert.deepEqual(filterTools(tools, "Notes", "ALL", "ALL", [finance.id]), []);
});

test("no selected departments keeps tagged and untagged tools eligible", () => {
  assert.deepEqual(filterTools(tools, "", "ALL", "ALL", []), tools);
  assert.deepEqual(filterTools(tools, "", "FREE", "productivity", []), [
    tools[2],
    tools[6],
  ]);
});
