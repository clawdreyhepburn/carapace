import { describe, it, expect } from "vitest";
import { CarapacePolicySource, type PolicySource } from "../src/policy-source.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("CarapacePolicySource", () => {
  it("returns null for empty directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "carapace-ps-"));
    try {
      const ps = new CarapacePolicySource(dir);
      const result = await ps.getEffectivePolicy("any-principal");
      expect(result).toBeNull();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("returns null for non-existent directory", async () => {
    const ps = new CarapacePolicySource("/tmp/nonexistent-carapace-test-dir");
    const result = await ps.getEffectivePolicy("any-principal");
    expect(result).toBeNull();
  });

  it("returns concatenated policies from .cedar files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "carapace-ps-"));
    try {
      writeFileSync(join(dir, "allow-git.cedar"), 'permit(\n  principal,\n  action == Action::"exec_command",\n  resource == Shell::"git"\n);');
      writeFileSync(join(dir, "deny-rm.cedar"), 'forbid(\n  principal,\n  action == Action::"exec_command",\n  resource == Shell::"rm"\n);');
      writeFileSync(join(dir, "schema.json"), "{}"); // not a .cedar file, should be ignored

      const ps = new CarapacePolicySource(dir);
      const result = await ps.getEffectivePolicy("any-principal");
      expect(result).not.toBeNull();
      expect(result).toContain("git");
      expect(result).toContain("rm");
      expect(result).not.toContain("schema");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("CarapacePolicySource implements PolicySource interface", () => {
    // Type compatibility check — if ovid-me's PolicySource drifts,
    // this will fail to compile. CarapacePolicySource must satisfy
    // the local PolicySource interface which mirrors ovid-me's.
    const source: PolicySource = new CarapacePolicySource("/tmp/nonexistent");
    expect(source.getEffectivePolicy).toBeTypeOf("function");
  });

  it("returns same policies regardless of principal (deployment-wide)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "carapace-ps-"));
    try {
      writeFileSync(join(dir, "test.cedar"), 'permit(principal, action, resource);');

      const ps = new CarapacePolicySource(dir);
      const r1 = await ps.getEffectivePolicy("agent-a");
      const r2 = await ps.getEffectivePolicy("agent-b");
      expect(r1).toBe(r2);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
