from hypothesis import HealthCheck, settings

# property tests must not flake on a busy CI runner or laptop
settings.register_profile("default", deadline=None, suppress_health_check=[HealthCheck.too_slow])
settings.load_profile("default")
