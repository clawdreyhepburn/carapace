/**
 * PolicySource — exposes Carapace's deployment-level Cedar policies
 * so that OVID-ME can query the effective policy ceiling.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Interface matching @clawdreyhepburn/ovid-me's PolicySource.
 * Defined locally to avoid circular dependencies.
 */
export interface PolicySource {
  getEffectivePolicy(principal: string): Promise<string | null>;
}

/**
 * Reads all .cedar files from the policy directory and returns
 * the concatenated policy text. Carapace policies are deployment-wide
 * (not per-principal), so all policies apply to all principals.
 */
export class CarapacePolicySource implements PolicySource {
  private policyDir: string;

  constructor(policyDir?: string) {
    this.policyDir = (policyDir ?? "~/.openclaw/mcp-policies/").replace("~", homedir());
  }

  async getEffectivePolicy(_principal: string): Promise<string | null> {
    if (!existsSync(this.policyDir)) return null;

    const files = readdirSync(this.policyDir).filter(f => f.endsWith(".cedar"));
    if (files.length === 0) return null;

    const policies = files.map(f => readFileSync(join(this.policyDir, f), "utf-8"));
    return policies.join("\n\n");
  }
}
