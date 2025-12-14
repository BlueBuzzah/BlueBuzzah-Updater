//! Advanced therapy settings with persistence and serial command generation.
//!
//! This module provides:
//! - `AdvancedSettings` struct for therapy device configuration
//! - Persistence to JSON file in app data directory
//! - Generation of serial commands to send before profile configuration
//!
//! ## Extensibility
//!
//! To add a new setting:
//! 1. Add the field to `AdvancedSettings` struct with `#[serde(default)]`
//! 2. Add command generation logic to `to_pre_profile_commands()`
//! 3. Update the TypeScript `AdvancedSettings` interface to match

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Advanced therapy settings that can generate serial commands.
///
/// Each boolean/value field maps to a potential device command that will be
/// sent BEFORE the SET_PROFILE command during therapy configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedSettings {
    /// When true, sends THERAPY_LED_OFF:true before SET_PROFILE.
    /// When false, sends THERAPY_LED_OFF:false.
    /// Controls whether device LEDs are active during therapy sessions.
    #[serde(default)]
    pub disable_led_during_therapy: bool,

    /// When true, sends DEBUG:true before SET_PROFILE.
    /// When false, sends DEBUG:false.
    /// Enables debug output from the device during therapy sessions.
    #[serde(default)]
    pub debug_mode: bool,

    // =========================================================================
    // EXTENSIBILITY: Add new settings below
    // =========================================================================
    // Example future settings:
    //
    // /// Custom vibration intensity override (0-100).
    // #[serde(default)]
    // pub vibration_intensity: Option<u8>,
    //
    // /// Enable low-power mode for extended battery life.
    // #[serde(default)]
    // pub low_power_mode: bool,
}

impl AdvancedSettings {
    /// Generate the list of serial commands to send BEFORE SET_PROFILE.
    ///
    /// Commands are returned in the order they should be sent.
    /// Each command includes the newline terminator.
    ///
    /// These commands configure device behavior but do NOT trigger a reboot.
    /// The SET_PROFILE command (sent after these) triggers the reboot.
    pub fn to_pre_profile_commands(&self) -> Vec<String> {
        let mut commands = Vec::new();

        // THERAPY_LED_OFF setting - always send explicit value
        let led_command = format!(
            "THERAPY_LED_OFF:{}\n",
            if self.disable_led_during_therapy {
                "true"
            } else {
                "false"
            }
        );
        commands.push(led_command);

        // DEBUG setting - always send explicit value
        let debug_command = format!(
            "DEBUG:{}\n",
            if self.debug_mode { "true" } else { "false" }
        );
        commands.push(debug_command);

        // =====================================================================
        // EXTENSIBILITY: Add new command mappings below
        // =====================================================================
        // Example:
        //
        // if let Some(intensity) = self.vibration_intensity {
        //     commands.push(format!("VIBRATION_INTENSITY:{}\n", intensity));
        // }

        commands
    }

    /// Check if these settings differ from defaults.
    /// Useful for logging/debugging to show when non-default settings are applied.
    pub fn has_non_default_settings(&self) -> bool {
        *self != Self::default()
    }
}

/// Settings file name stored in app data directory.
const SETTINGS_FILENAME: &str = "advanced_settings.json";

/// Manages persistence of advanced settings to JSON file.
pub struct SettingsManager {
    settings_file_path: PathBuf,
}

impl SettingsManager {
    /// Create a new settings manager for the given app data directory.
    pub fn new(app_data_dir: &Path) -> Self {
        let settings_file_path = app_data_dir.join(SETTINGS_FILENAME);
        Self { settings_file_path }
    }

    /// Load settings from disk, returning defaults if file doesn't exist.
    pub fn load(&self) -> Result<AdvancedSettings, String> {
        if !self.settings_file_path.exists() {
            return Ok(AdvancedSettings::default());
        }

        let contents = fs::read_to_string(&self.settings_file_path)
            .map_err(|e| format!("Failed to read settings file: {}", e))?;

        // Handle empty file gracefully
        if contents.trim().is_empty() {
            return Ok(AdvancedSettings::default());
        }

        serde_json::from_str(&contents)
            .map_err(|e| format!("Failed to parse settings JSON: {}", e))
    }

    /// Save settings to disk.
    pub fn save(&self, settings: &AdvancedSettings) -> Result<(), String> {
        // Ensure parent directory exists
        if let Some(parent) = self.settings_file_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create settings directory: {}", e))?;
        }

        let contents = serde_json::to_string_pretty(settings)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;

        fs::write(&self.settings_file_path, contents)
            .map_err(|e| format!("Failed to write settings file: {}", e))?;

        Ok(())
    }

    /// Get the path where settings are stored.
    pub fn settings_path(&self) -> &Path {
        &self.settings_file_path
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_default_settings() {
        let settings = AdvancedSettings::default();
        assert!(!settings.disable_led_during_therapy);
        assert!(!settings.debug_mode);
    }

    #[test]
    fn test_to_pre_profile_commands_default() {
        let settings = AdvancedSettings::default();
        let commands = settings.to_pre_profile_commands();

        assert_eq!(commands.len(), 2);
        assert_eq!(commands[0], "THERAPY_LED_OFF:false\n");
        assert_eq!(commands[1], "DEBUG:false\n");
    }

    #[test]
    fn test_to_pre_profile_commands_led_disabled() {
        let settings = AdvancedSettings {
            disable_led_during_therapy: true,
            debug_mode: false,
        };
        let commands = settings.to_pre_profile_commands();

        assert_eq!(commands.len(), 2);
        assert_eq!(commands[0], "THERAPY_LED_OFF:true\n");
        assert_eq!(commands[1], "DEBUG:false\n");
    }

    #[test]
    fn test_to_pre_profile_commands_debug_enabled() {
        let settings = AdvancedSettings {
            disable_led_during_therapy: false,
            debug_mode: true,
        };
        let commands = settings.to_pre_profile_commands();

        assert_eq!(commands.len(), 2);
        assert_eq!(commands[0], "THERAPY_LED_OFF:false\n");
        assert_eq!(commands[1], "DEBUG:true\n");
    }

    #[test]
    fn test_to_pre_profile_commands_all_enabled() {
        let settings = AdvancedSettings {
            disable_led_during_therapy: true,
            debug_mode: true,
        };
        let commands = settings.to_pre_profile_commands();

        assert_eq!(commands.len(), 2);
        assert_eq!(commands[0], "THERAPY_LED_OFF:true\n");
        assert_eq!(commands[1], "DEBUG:true\n");
    }

    #[test]
    fn test_settings_persistence() {
        let dir = tempdir().unwrap();
        let manager = SettingsManager::new(dir.path());

        // Initially returns defaults
        let loaded = manager.load().unwrap();
        assert_eq!(loaded, AdvancedSettings::default());

        // Save custom settings
        let settings = AdvancedSettings {
            disable_led_during_therapy: true,
            debug_mode: true,
        };
        manager.save(&settings).unwrap();

        // Load returns saved settings
        let loaded = manager.load().unwrap();
        assert_eq!(loaded, settings);
    }

    #[test]
    fn test_has_non_default_settings() {
        let default = AdvancedSettings::default();
        assert!(!default.has_non_default_settings());

        let custom_led = AdvancedSettings {
            disable_led_during_therapy: true,
            debug_mode: false,
        };
        assert!(custom_led.has_non_default_settings());

        let custom_debug = AdvancedSettings {
            disable_led_during_therapy: false,
            debug_mode: true,
        };
        assert!(custom_debug.has_non_default_settings());
    }

    #[test]
    fn test_serde_camel_case() {
        let settings = AdvancedSettings {
            disable_led_during_therapy: true,
            debug_mode: true,
        };
        let json = serde_json::to_string(&settings).unwrap();

        // Should use camelCase for JSON (matches TypeScript)
        assert!(json.contains("disableLedDuringTherapy"));
        assert!(!json.contains("disable_led_during_therapy"));
        assert!(json.contains("debugMode"));
        assert!(!json.contains("debug_mode"));
    }
}
