# Changelog

## [0.4.0] - 2026-03-23

### Breaking Changes
- Removed agent hierarchy (OvidToken registration, agent context injection)
- Removed three-valued decisions (allow-proven/allow-unproven). All decisions are binary allow/deny.
- Removed `src/agent-context.ts` and `src/attenuation.ts`

### Added
- `CarapacePolicySource` implementing PolicySource interface for OVID-ME integration
- `/api/policy-source` endpoint on GUI server

### Changed
- Cedar evaluation simplified to binary allow/deny
- LLM proxy no longer injects agent context into Cedar evaluation

For per-agent mandate evaluation, see @clawdreyhepburn/ovid-me.

## [0.3.2] - 2026-03-19
- Agent hierarchy, three-valued decisions, OVID integration (now removed)
