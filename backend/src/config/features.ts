/**
 * Feature flags — mirrors Chatwoot's config/features.yml
 * Manages which premium/enterprise features are enabled.
 */

export interface FeatureFlags {
  /** Slice-level flags */
  captain: boolean;
  captainAssistants: boolean;
  captainCopilot: boolean;
  captainCustomTools: boolean;
  sla: boolean;
  customRoles: boolean;
  auditLogs: boolean;
  advancedSearch: boolean;
  enterprise: boolean;
  saml: boolean;
  voice: boolean;
  helpCenterEmbeddingSearch: boolean;
  assignmentV2: boolean;
}

const defaults: FeatureFlags = {
  captain: true,
  captainAssistants: true,
  captainCopilot: true,
  captainCustomTools: false,       // premium
  sla: false,                       // premium
  customRoles: false,               // enterprise
  auditLogs: false,                 // enterprise
  advancedSearch: false,            // enterprise
  enterprise: false,
  saml: false,                      // enterprise
  voice: false,                     // premium
  helpCenterEmbeddingSearch: false, // premium
  assignmentV2: false,              // feature flag
};

let overrides: Partial<FeatureFlags> = {};

export function initFeatures(flags?: Partial<FeatureFlags>): void {
  overrides = flags ?? {};
}

export function isFeatureEnabled(feature: keyof FeatureFlags): boolean {
  return overrides[feature] ?? defaults[feature];
}

export function getAllFeatures(): FeatureFlags {
  return { ...defaults, ...overrides };
}
