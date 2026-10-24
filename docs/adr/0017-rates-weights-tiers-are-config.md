# ADR-17: Partner rates, risk weights, and GRAP tiers are configuration

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Floor prices, subsidy rates, risk weights and GRAP tiers live in versioned config. Farmer-facing rates are rendered only from an active contract.

## Implementation

`config/partner_rates.yaml`, `config/risk_weights.yaml`, `config/grap_tiers.yaml`; `domain/partners.py` returns no rate unless a contract is `active`; `render_script` omits a priced line without one; tables `partner_contract` and `partner_rate` in migration 0002.
