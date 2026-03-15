import { initSync, init as cedarlingInit } from '@janssenproject/cedarling_wasm';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';

// Load WASM manually for Node.js using initSync
const require = createRequire(import.meta.url);
const wasmPath = join(
  dirname(require.resolve('@janssenproject/cedarling_wasm')),
  'cedarling_wasm_bg.wasm'
);
const wasmBytes = readFileSync(wasmPath);

try {
  initSync({ module: wasmBytes });
  console.log("✅ WASM loaded successfully!");
  
  // Now try to create a Cedarling instance with a minimal policy store
  // Schema and policies are base64-encoded
  const schema = btoa(JSON.stringify({
    "McpProxy": {
      "entityTypes": {
        "Agent": { "shape": { "type": "Record", "attributes": {} } },
        "Tool": { "shape": { "type": "Record", "attributes": {
          "server": { "type": "EntityOrCommon", "name": "String", "required": false },
          "name": { "type": "EntityOrCommon", "name": "String", "required": false }
        } } }
      },
      "actions": {
        "call_tool": {
          "appliesTo": {
            "principalTypes": ["Agent"],
            "resourceTypes": ["Tool"],
            "context": { "type": "Record", "attributes": {} }
          }
        }
      }
    }
  }));

  const permitPolicy = btoa(`permit(
    principal is McpProxy::Agent,
    action == McpProxy::Action::"call_tool",
    resource == McpProxy::Tool::"filesystem/read_file"
  );`);

  const forbidPolicy = btoa(`forbid(
    principal,
    action == McpProxy::Action::"call_tool",
    resource == McpProxy::Tool::"filesystem/write_file"
  );`);

  const policyStore = JSON.stringify({
    "cedar_version": "v4.0.0",
    "policy_stores": {
      "mcp": {
        "name": "MCP Proxy",
        "description": "MCP Cedar Proxy policies",
        "policies": {
          "permit-read": {
            "description": "Allow read_file",
            "creation_date": "2026-03-09",
            "policy_content": permitPolicy
          },
          "forbid-write": {
            "description": "Deny write_file",
            "creation_date": "2026-03-09",
            "policy_content": forbidPolicy
          }
        },
        "schema": schema,
        "trusted_issuers": {}
      }
    }
  });

  const config = {
    "CEDARLING_APPLICATION_NAME": "MCP Cedar Proxy",
    "CEDARLING_POLICY_STORE_LOCAL": policyStore,
    "CEDARLING_LOG_TYPE": "off",
    "CEDARLING_USER_AUTHZ": "disabled",
    "CEDARLING_WORKLOAD_AUTHZ": "enabled",
    "CEDARLING_JWT_SIG_VALIDATION": "disabled",
    "CEDARLING_JWT_SIGNATURE_ALGORITHMS_SUPPORTED": ["ES256"],
    "CEDARLING_ID_TOKEN_TRUST_MODE": "strict",
  };

  console.log("Creating Cedarling instance...");
  const cedarling = await cedarlingInit(config);
  console.log("✅ Cedarling instance created!");

  // Test authorize_unsigned for read_file (should ALLOW)
  const readResult = await cedarling.authorize_unsigned({
    principals: [{
      cedar_entity_mapping: { entity_type: "McpProxy::Agent", id: "openclaw" },
    }],
    action: 'McpProxy::Action::"call_tool"',
    resource: {
      cedar_entity_mapping: { entity_type: "McpProxy::Tool", id: "filesystem/read_file" },
      server: "filesystem",
      name: "read_file"
    },
    context: {}
  });
  console.log("read_file decision:", readResult.decision, "request_id:", readResult.request_id);

  // Test authorize_unsigned for write_file (should DENY)
  const writeResult = await cedarling.authorize_unsigned({
    principals: [{
      cedar_entity_mapping: { entity_type: "McpProxy::Agent", id: "openclaw" },
    }],
    action: 'McpProxy::Action::"call_tool"',
    resource: {
      cedar_entity_mapping: { entity_type: "McpProxy::Tool", id: "filesystem/write_file" },
      server: "filesystem",
      name: "write_file"
    },
    context: {}
  });
  console.log("write_file decision:", writeResult.decision, "request_id:", writeResult.request_id);

  // Test authorize_unsigned for an unknown tool (should DENY - no matching policy)
  const unknownResult = await cedarling.authorize_unsigned({
    principals: [{
      cedar_entity_mapping: { entity_type: "McpProxy::Agent", id: "openclaw" },
    }],
    action: 'McpProxy::Action::"call_tool"',
    resource: {
      cedar_entity_mapping: { entity_type: "McpProxy::Tool", id: "filesystem/move_file" },
      server: "filesystem",
      name: "move_file"
    },
    context: {}
  });
  console.log("move_file decision:", unknownResult.decision, "request_id:", unknownResult.request_id);

  console.log("\n=== Summary ===");
  console.log("read_file:", readResult.decision ? "ALLOW ✅" : "DENY ❌");
  console.log("write_file:", writeResult.decision ? "ALLOW ❌ (expected DENY)" : "DENY ✅");
  console.log("move_file:", unknownResult.decision ? "ALLOW ❌ (expected DENY)" : "DENY ✅");

} catch (err) {
  console.error("❌ Error:", err);
}
