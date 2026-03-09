import { initSync, init as cedarlingInit } from '@janssenproject/cedarling_wasm';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const wasmPath = join(
  dirname(fileURLToPath(import.meta.resolve('@janssenproject/cedarling_wasm'))),
  'cedarling_wasm_bg.wasm'
);
initSync({ module: readFileSync(wasmPath) });

// Use Jans:: namespace like the examples do
const schema = btoa(JSON.stringify({
  "Jans": {
    "entityTypes": {
      "Workload": { "shape": { "type": "Record", "attributes": {
        "name": { "type": "EntityOrCommon", "name": "String", "required": false }
      } } },
      "Tool": { "shape": { "type": "Record", "attributes": {
        "server": { "type": "EntityOrCommon", "name": "String", "required": false },
        "name": { "type": "EntityOrCommon", "name": "String", "required": false }
      } } }
    },
    "actions": {
      "call_tool": {
        "appliesTo": {
          "principalTypes": ["Workload"],
          "resourceTypes": ["Tool"],
          "context": { "type": "Record", "attributes": {} }
        }
      }
    }
  }
}));

const permitPolicy = btoa(`permit(
  principal is Jans::Workload,
  action == Jans::Action::"call_tool",
  resource == Jans::Tool::"filesystem/read_file"
);`);

const policyStore = JSON.stringify({
  "cedar_version": "v4.0.0",
  "policy_stores": {
    "mcp": {
      "name": "MCP",
      "description": "",
      "policies": {
        "permit-read": {
          "description": "Allow read_file",
          "creation_date": "2026-03-09",
          "policy_content": permitPolicy
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
  "CEDARLING_LOG_TYPE": "std_out",
  "CEDARLING_LOG_LEVEL": "TRACE",
  "CEDARLING_USER_AUTHZ": "disabled",
  "CEDARLING_WORKLOAD_AUTHZ": "enabled",
  "CEDARLING_JWT_SIG_VALIDATION": "disabled",
  "CEDARLING_JWT_SIGNATURE_ALGORITHMS_SUPPORTED": ["ES256"],
  "CEDARLING_ID_TOKEN_TRUST_MODE": "strict",
  "CEDARLING_MAPPING_WORKLOAD": "Jans::Workload",
  "CEDARLING_PRINCIPAL_BOOLEAN_OPERATION": {
    "or": [
      { "===": [{ "var": "Jans::Workload" }, "ALLOW"] },
      { "===": [{ "var": "Jans::Workload::\"openclaw\"" }, "ALLOW"] }
    ]
  }
};

const cedarling = await cedarlingInit(config);
console.log("✅ Cedarling created");

const result = await cedarling.authorize_unsigned({
  principals: [{
    cedar_entity_mapping: { entity_type: "Jans::Workload", id: "openclaw" },
    name: "openclaw"
  }],
  action: 'Jans::Action::"call_tool"',
  resource: {
    cedar_entity_mapping: { entity_type: "Jans::Tool", id: "filesystem/read_file" },
    server: "filesystem",
    name: "read_file"
  },
  context: {}
});

console.log("Decision:", result.decision);
console.log("Full result:", result.json_string());

// Get logs for debugging
const logs = cedarling.pop_logs();
for (const log of logs) {
  if (log.get) {
    console.log("Log:", JSON.stringify(Object.fromEntries(log)));
  } else {
    console.log("Log:", JSON.stringify(log));
  }
}
