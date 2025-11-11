export const PRIMARY_CONFIG = `# BlueBuzzah2 Primary Configuration
import board
import busio

# Device Role
DEVICE_ROLE = "PRIMARY"

# I2C Configuration
i2c = busio.I2C(board.SCL, board.SDA)

# Primary-specific settings
IS_COORDINATOR = True
BROADCAST_ENABLED = True
LISTEN_FOR_SECONDARY = True

# Network Configuration
NETWORK_TIMEOUT = 5000  # milliseconds
MAX_RETRIES = 3

print(f"BlueBuzzah2 configured as {DEVICE_ROLE}")
`;

export const SECONDARY_CONFIG = `# BlueBuzzah2 Secondary Configuration
import board
import busio

# Device Role
DEVICE_ROLE = "SECONDARY"

# I2C Configuration
i2c = busio.I2C(board.SCL, board.SDA)

# Secondary-specific settings
IS_COORDINATOR = False
BROADCAST_ENABLED = False
LISTEN_FOR_PRIMARY = True

# Network Configuration
NETWORK_TIMEOUT = 5000  # milliseconds
MAX_RETRIES = 3

print(f"BlueBuzzah2 configured as {DEVICE_ROLE}")
`;

export function getConfigForRole(role: 'PRIMARY' | 'SECONDARY'): string {
  return role === 'PRIMARY' ? PRIMARY_CONFIG : SECONDARY_CONFIG;
}
