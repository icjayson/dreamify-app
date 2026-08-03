import { describe, expect, it } from "vitest";

import {
  DashboardConfigurationSchema,
  SandboxProfileResultSchema,
} from "@dreamify/contracts";

import { DEMO_DASHBOARD, SALES_PROFILE, SALES_RUN_CONTEXT } from "../src/index.js";

describe("demo fixtures", () => {
  it("stay inside the production contracts", () => {
    expect(SandboxProfileResultSchema.parse(SALES_PROFILE).datasets[0]?.row_count).toBe(6);
    expect(DashboardConfigurationSchema.parse(DEMO_DASHBOARD).components).toHaveLength(2);
    expect(SALES_RUN_CONTEXT.assets).toHaveLength(1);
    expect(SALES_RUN_CONTEXT.owner_id).toBe("demo_user");
  });
});
