import { describe, it, expect } from 'vitest';
import { getConfigForRole, PRIMARY_CONFIG, SECONDARY_CONFIG } from './config-templates';

describe('getConfigForRole', () => {
  it('returns PRIMARY_CONFIG for PRIMARY role', () => {
    expect(getConfigForRole('PRIMARY')).toBe(PRIMARY_CONFIG);
  });

  it('returns SECONDARY_CONFIG for SECONDARY role', () => {
    expect(getConfigForRole('SECONDARY')).toBe(SECONDARY_CONFIG);
  });
});

describe('PRIMARY_CONFIG', () => {
  it('contains PRIMARY device role', () => {
    expect(PRIMARY_CONFIG).toContain('DEVICE_ROLE = "PRIMARY"');
  });

  it('has IS_COORDINATOR set to True', () => {
    expect(PRIMARY_CONFIG).toContain('IS_COORDINATOR = True');
  });

  it('has BROADCAST_ENABLED set to True', () => {
    expect(PRIMARY_CONFIG).toContain('BROADCAST_ENABLED = True');
  });

  it('has LISTEN_FOR_SECONDARY set to True', () => {
    expect(PRIMARY_CONFIG).toContain('LISTEN_FOR_SECONDARY = True');
  });

  it('contains I2C configuration', () => {
    expect(PRIMARY_CONFIG).toContain('import busio');
    expect(PRIMARY_CONFIG).toContain('i2c = busio.I2C');
  });

  it('contains network configuration', () => {
    expect(PRIMARY_CONFIG).toContain('NETWORK_TIMEOUT');
    expect(PRIMARY_CONFIG).toContain('MAX_RETRIES');
  });
});

describe('SECONDARY_CONFIG', () => {
  it('contains SECONDARY device role', () => {
    expect(SECONDARY_CONFIG).toContain('DEVICE_ROLE = "SECONDARY"');
  });

  it('has IS_COORDINATOR set to False', () => {
    expect(SECONDARY_CONFIG).toContain('IS_COORDINATOR = False');
  });

  it('has BROADCAST_ENABLED set to False', () => {
    expect(SECONDARY_CONFIG).toContain('BROADCAST_ENABLED = False');
  });

  it('has LISTEN_FOR_PRIMARY set to True', () => {
    expect(SECONDARY_CONFIG).toContain('LISTEN_FOR_PRIMARY = True');
  });

  it('contains I2C configuration', () => {
    expect(SECONDARY_CONFIG).toContain('import busio');
    expect(SECONDARY_CONFIG).toContain('i2c = busio.I2C');
  });

  it('contains network configuration', () => {
    expect(SECONDARY_CONFIG).toContain('NETWORK_TIMEOUT');
    expect(SECONDARY_CONFIG).toContain('MAX_RETRIES');
  });
});

describe('config differences', () => {
  it('PRIMARY and SECONDARY configs have different roles', () => {
    expect(PRIMARY_CONFIG).not.toBe(SECONDARY_CONFIG);
    expect(PRIMARY_CONFIG).toContain('PRIMARY');
    expect(SECONDARY_CONFIG).toContain('SECONDARY');
  });

  it('PRIMARY is coordinator, SECONDARY is not', () => {
    expect(PRIMARY_CONFIG).toContain('IS_COORDINATOR = True');
    expect(SECONDARY_CONFIG).toContain('IS_COORDINATOR = False');
  });
});
