# ADR-10: Audio library first, Bhashini optional

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Farmer call audio comes from a library of pre-recorded Punjabi and Hindi clips keyed by script hash. Bhashini TTS is optional behind `TTS_PROVIDER=bhashini`, cached by SHA-256 of the normalised script. There is no speech recognition.

## Implementation

`integrations/audio` (library, static DTMF prompts, provider choice) and `integrations/bhashini` (TTS adapter and cache). The clips themselves are recorded by native speakers before the pilot; until then `AudioLibrary.coverage` lists what is missing.
