export const CIRCUIT_BREAKER_CONFIG = {
  timeout: 15_000,
  errorThresholdPercentage: 50,
  resetTimeout: 30_000,
  volumeThreshold: 5,
};
