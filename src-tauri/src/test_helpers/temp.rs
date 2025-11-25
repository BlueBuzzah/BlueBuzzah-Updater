use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

/// Test context with temporary directory management.
/// Automatically cleans up when dropped.
pub struct TestContext {
    temp_dir: TempDir,
}

impl TestContext {
    /// Create a new test context with a fresh temporary directory
    pub fn new() -> Self {
        Self {
            temp_dir: TempDir::new().expect("Failed to create temp dir"),
        }
    }

    /// Get the root path of the temporary directory
    pub fn root(&self) -> &Path {
        self.temp_dir.path()
    }

    /// Create a file with content at the given relative path
    pub fn create_file(&self, relative_path: &str, content: &str) -> PathBuf {
        let path = self.root().join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("Failed to create parent dirs");
        }
        fs::write(&path, content).expect("Failed to write file");
        path
    }

    /// Create a file with binary content at the given relative path
    pub fn create_file_bytes(&self, relative_path: &str, content: &[u8]) -> PathBuf {
        let path = self.root().join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("Failed to create parent dirs");
        }
        fs::write(&path, content).expect("Failed to write file");
        path
    }

    /// Create an empty file (touch)
    pub fn touch(&self, relative_path: &str) -> PathBuf {
        self.create_file(relative_path, "")
    }

    /// Create a directory at the given relative path
    pub fn create_dir(&self, relative_path: &str) -> PathBuf {
        let path = self.root().join(relative_path);
        fs::create_dir_all(&path).expect("Failed to create dir");
        path
    }

    /// Create a mock CircuitPython device structure
    pub fn create_mock_device(&self, name: &str) -> PathBuf {
        let device_path = self.create_dir(name);
        self.create_file(
            &format!("{}/boot_out.txt", name),
            "Adafruit CircuitPython 8.0.0 on 2023-01-01; BlueBuzzah with samd21e18",
        );
        device_path
    }

    /// Create a mock firmware directory structure
    pub fn create_mock_firmware(&self, version: &str) -> PathBuf {
        let firmware_dir = self.create_dir(&format!("firmware/{}", version));
        self.create_file(
            &format!("firmware/{}/code.py", version),
            "# Main firmware code\nprint('BlueBuzzah')",
        );
        self.create_file(
            &format!("firmware/{}/lib/helpers.py", version),
            "# Helper library",
        );
        firmware_dir
    }

    /// Get full path for a relative path
    pub fn path(&self, relative: &str) -> PathBuf {
        self.root().join(relative)
    }

    /// Check if a relative path exists
    pub fn exists(&self, relative: &str) -> bool {
        self.path(relative).exists()
    }

    /// Read file content at relative path
    pub fn read_file(&self, relative: &str) -> String {
        fs::read_to_string(self.path(relative)).expect("Failed to read file")
    }
}

impl Default for TestContext {
    fn default() -> Self {
        Self::new()
    }
}
