import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLES,
  can,
  isRole,
} from "./permissions";

describe("can()", () => {
  it("matches an exact grant", () => {
    expect(can(["order:read"], "order:read")).toBe(true);
    expect(can(["order:read"], "order:write")).toBe(false);
  });

  it("treats * as a whole-segment wildcard", () => {
    expect(can(["step:restart:*"], "step:restart:orderInProgress_Stage2")).toBe(true);
    expect(can(["step:advance:*"], "step:advance:orderPlaced")).toBe(true);
  });

  it("requires equal segment counts", () => {
    expect(can(["step:advance:*"], "step:advance")).toBe(false);
    expect(can(["step:advance:*:*"], "step:advance:orderPlaced")).toBe(false);
    expect(can(["*"], "order:read")).toBe(false);
  });

  it("does not wildcard across a different resource", () => {
    expect(can(["step:restart:*"], "step:advance:orderPlaced")).toBe(false);
  });

  it("returns false for an empty grant list", () => {
    expect(can([], "order:read")).toBe(false);
  });
});

describe("default role matrix", () => {
  it("declares all four roles", () => {
    expect(ROLES).toHaveLength(4);
    expect(isRole("store_manager")).toBe(true);
    expect(isRole("admin")).toBe(false);
  });

  it("gives the customer no staff permissions", () => {
    const customer = DEFAULT_ROLE_PERMISSIONS.customer;
    expect(can(customer, "order:read_public")).toBe(true);
    expect(can(customer, "order:read")).toBe(false);
    expect(can(customer, "step:advance:orderPlaced")).toBe(false);
    expect(can(customer, "input:submit")).toBe(true);
    expect(can(customer, "input:request")).toBe(false);
  });

  it("lets kitchen staff move a ticket from placed to prep but not dispatch it", () => {
    const kitchen = DEFAULT_ROLE_PERMISSIONS.kitchen_staff;
    expect(can(kitchen, "step:advance:orderPlaced")).toBe(true);
    expect(can(kitchen, "step:advance:orderInProgress_Stage2")).toBe(true);
    expect(can(kitchen, "step:advance:orderInProgress_Stage3")).toBe(false);
    expect(can(kitchen, "step:restart:orderInProgress_Stage2")).toBe(true);
  });

  it("scopes the driver to dispatch only", () => {
    const driver = DEFAULT_ROLE_PERMISSIONS.delivery_driver;
    expect(can(driver, "step:advance:orderInProgress_Stage3")).toBe(true);
    expect(can(driver, "step:advance:orderInProgress_Stage1")).toBe(false);
    expect(can(driver, "step:advance:orderComplete")).toBe(false);
    expect(can(driver, "order:cancel")).toBe(false);
  });

  it("gives the manager cancel and config rights", () => {
    const manager = DEFAULT_ROLE_PERMISSIONS.store_manager;
    expect(can(manager, "order:cancel")).toBe(true);
    expect(can(manager, "tenant:config:write")).toBe(true);
    expect(can(manager, "step:advance:orderInProgress_Stage3")).toBe(true);
  });

  it("never grants step permissions without a step qualifier", () => {
    for (const role of ROLES) {
      const grants = DEFAULT_ROLE_PERMISSIONS[role];
      expect(can(grants, "step:advance")).toBe(false);
      expect(can(grants, "step:restart")).toBe(false);
    }
  });
});
