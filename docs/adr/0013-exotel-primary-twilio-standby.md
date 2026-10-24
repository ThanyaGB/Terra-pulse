# ADR-13: Exotel primary telephony, Twilio standby

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Exotel places outbound IVR calls; Twilio is a hot standby behind the same adapter. Calls are enabled only after gate G1 (telecom compliance).

## Implementation

`integrations/telephony`: Exotel and Twilio providers, signed webhooks, failover after 3 failed health checks, calling hours from `config/telephony.yaml`. `Settings.telephony_primary` defaults to `exotel`. `/calls/trigger` returns 503 while `TELEPHONY_ENABLED` is off.
