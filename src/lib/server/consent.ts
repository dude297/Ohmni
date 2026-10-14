// AI consent gate. REQUIRE_AI_CONSENT=1 makes routes that send user content to third-party models refuse
// requests without explicit consent (JSON `aiConsent: true`, multipart field `aiConsent=true`). Unset: no gate.
export const consentMissing = (given: boolean) => process.env.REQUIRE_AI_CONSENT === '1' && !given;

export const CONSENT_MESSAGE = 'Consent is required before your circuit is sent to third-party AI providers (see docs/PRIVACY.md)';
