use std::process::Output;

#[cfg(test)]
use mockall::automock;

/// Abstraction over external command execution (diskutil, etc.)
/// This allows mocking OS-level commands in tests.
#[cfg_attr(test, automock)]
pub trait CommandExecutor: Send + Sync {
    /// Execute an external command with the given arguments
    fn execute(&self, program: &str, args: Vec<String>) -> Result<Output, String>;
}

/// Real implementation that delegates to std::process::Command
#[derive(Default)]
pub struct RealCommandExecutor;

impl CommandExecutor for RealCommandExecutor {
    fn execute(&self, program: &str, args: Vec<String>) -> Result<Output, String> {
        std::process::Command::new(program)
            .args(&args)
            .output()
            .map_err(|e| format!("Failed to execute {}: {}", program, e))
    }
}
