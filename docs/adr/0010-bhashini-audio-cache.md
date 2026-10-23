# ADR-10: Bhashini for speech, with an audio cache

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Bhashini ASR/TTS handles Punjabi and Hindi; generated audio is cached by SHA-256 of the normalised script.

## Implementation

`integrations/bhashini`. Needs an API key and confirmation of dialect coverage (open question 3); until then the simulator voices lines with the browser speech synthesis.
