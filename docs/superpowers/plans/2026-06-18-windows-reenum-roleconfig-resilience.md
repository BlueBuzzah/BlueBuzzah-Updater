# Windows Re-Enumeration Role-Config Resilience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the updater survive the Windows USB CDC re-enumeration *readiness* race in the post-flash role-configuration step, so a successful firmware flash is never reported as a failure or thrown away and re-flashed.

**Architecture:** The DFU transfer already succeeds; the failure is entirely in Step 10 (role configuration), where the freshly-rebooted device's COM port appears in enumeration before Windows has bound its CDC pipes. The current code (a) misclassifies the resulting `ERROR_SEM_TIMEOUT` as fatal, and (b) on that "fatal" error re-runs the *entire* DFU (erase + 212 KB transfer). This plan ships diagnostic instrumentation to capture a definitive field trace, then applies three fixes: classify the semaphore-timeout error as transient, stop re-flashing on any post-transfer role-config failure, and (gated on what the instrumentation shows) bound the Windows serial I/O so a wedged pipe can't block for minutes.

**Tech Stack:** Rust + Tauri 2.0, `serialport` crate, `thiserror`. Tests via `cargo test`. Frontend is untouched.

## Global Constraints

- Target hardware: Adafruit Feather nRF52840 (VID `0x239A`). No behavior change on macOS/Linux — all new bounding/guard logic is `#[cfg(target_os = "windows")]` or proven no-op elsewhere.
- Root cause is **firmware-version-independent** (confirmed: the only beta.8 code change is one I2C register read). Do not gate any fix on firmware version.
- Device is tracked by **USB serial number** (`DeviceIdentifier::Serial`); the serial is stable across firmware and modes. Do not weaken serial tracking.
- All Rust changes must keep `cargo test` green (existing: 88 tests) and `cargo clippy` clean.
- No new dependencies (`serialport`, `thiserror`, std only).
- Instrumentation logging is **permanent** (ships in release) and goes through the existing progress `DfuStage::Log` channel and/or `eprintln!`, matching current patterns.

---

## Background: the exact failure path (from the customer log + code trace)

Reference for implementers — read before starting.

1. `flash_dfu_firmware` (`src-tauri/src/commands/dfu.rs:289`) wraps the whole operation in a retry loop (`dfu.rs:310`, `MAX_OPERATION_RETRIES = 2`).
2. Inside, the DFU sequence transfers firmware successfully, the device reboots, and `wait_for_application_flexible` (`src-tauri/src/dfu/device.rs:415`) returns the device on `COM5` after 2 consecutive enumeration hits (~500 ms). **This proves the port exists, not that it is openable.**
3. Step 10 calls `configure_device_role_flexible` (`src-tauri/src/dfu/protocol.rs:690`) → `_inner` (`protocol.rs:727`) → `SerialTransport::open` (`src-tauri/src/dfu/transport.rs:66`).
4. On Windows the open/IO hits a half-bound CDC pipe and the OS returns `ERROR_SEM_TIMEOUT` → `serialport::Error` with message `"The semaphore timeout period has expired"`, surfaced as `DfuError::Serial` → Display `"Serial port error: The semaphore timeout period has expired"` (`src-tauri/src/dfu/error.rs:16`).
5. **Misclassification #1:** `is_transient_port_error` (`transport.rs:323`) has no case for it, and the open-retry's extra guard checks `"timed out"` (the string is `"timeout"`), so the open-retry loop does not treat it as transient.
6. **Misclassification #2:** `DfuError::is_retriable` Serial branch (`error.rs:145`) also checks `"timed out"`, so the inner role-config retry loop (`MAX_CONFIG_RETRIES`) does not retry it.
7. **Re-flash bug:** the error string bubbles up to `is_operation_retriable(error: &str)` (`dfu.rs:48`), which matches `contains("timeout")` → returns `true` → the operation loop **re-flashes the entire device**.
8. macOS is immune: `open_port_with_timeout` opens directly there (`transport.rs:381`), `/dev/cu.*` nodes are created only when ready and fail *fast* (ENOENT / "resource busy") which already classifies as transient and recovers in ms.

---

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `src-tauri/src/dfu/transport.rs` | Serial open/read/write; add OS-error detail logging + (Task 5) bounded read guard | 1, 3, 5 |
| `src-tauri/src/dfu/error.rs` | `DfuError`; classify semaphore-timeout as retriable in `is_retriable` | 3 |
| `src-tauri/src/dfu/protocol.rs` | DFU sequence; instrument Step 9–10, tag role-config-phase failures | 2, 4, 5 |
| `src-tauri/src/dfu/device.rs` | Device enumeration; add enumeration-snapshot helper for instrumentation | 2 |
| `src-tauri/src/commands/dfu.rs` | Operation retry loop; stop re-flashing on role-config-phase failures | 4 |

---

## Task 1: Capture raw OS error codes in serial open/read failures (instrumentation)

**Why:** The single remaining evidence gap is *which* op blocks (the `CreateFile` open vs. a post-open `SetCommTimeouts`/`PurgeComm`/read) and the *raw* Win32 code. `serialport::Error`'s Display loses the numeric code; `std::io::Error::raw_os_error()` keeps it. This logging is permanent and is what we ship to the customer.

**Files:**
- Modify: `src-tauri/src/dfu/transport.rs` (add helper near `is_transient_port_error`, ~line 323; call it in `open_port_with_retry` error arm ~line 428 and in `read` error arm ~line 257)
- Test: `src-tauri/src/dfu/transport.rs` (inline `#[cfg(test)] mod tests`)

**Interfaces:**
- Produces: `fn describe_serial_error(context: &str, err: &serialport::Error) -> String` — returns a single-line diagnostic like `"[role-config open] kind=Io(TimedOut) os_code=121 msg=The semaphore timeout period has expired"`. Used by later tasks' log calls.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `transport.rs`:

```rust
#[test]
fn describe_serial_error_includes_context_and_message() {
    let err = serialport::Error::new(
        serialport::ErrorKind::Io(std::io::ErrorKind::TimedOut),
        "The semaphore timeout period has expired",
    );
    let out = describe_serial_error("role-config open", &err);
    assert!(out.contains("role-config open"), "missing context: {out}");
    assert!(out.contains("semaphore timeout period has expired"), "missing msg: {out}");
    assert!(out.contains("kind="), "missing kind: {out}");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test describe_serial_error_includes_context_and_message`
Expected: FAIL — `cannot find function describe_serial_error`.

- [ ] **Step 3: Write minimal implementation**

Add near `is_transient_port_error` in `transport.rs`:

```rust
/// Build a one-line diagnostic for a serial error, preserving the raw OS code.
///
/// `serialport::Error`'s Display drops the numeric OS error (e.g. Windows
/// ERROR_SEM_TIMEOUT = 121). This recovers it for field diagnostics.
fn describe_serial_error(context: &str, err: &serialport::Error) -> String {
    let os_code = match &err.kind() {
        serialport::ErrorKind::Io(_) => std::io::Error::last_os_error()
            .raw_os_error()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "?".to_string()),
        _ => "n/a".to_string(),
    };
    format!(
        "[{context}] kind={:?} os_code={os_code} msg={}",
        err.kind(),
        err
    )
}
```

> Note: `serialport::Error` does not expose `raw_os_error()` directly; `std::io::Error::last_os_error()` is the pragmatic recovery on the same thread immediately after the failing call. The log call sites in Tasks 2/5 invoke this right after the failing op so `last_os_error()` is still valid.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test describe_serial_error_includes_context_and_message`
Expected: PASS.

- [ ] **Step 5: Wire it into the open-retry error arm**

In `open_port_with_retry` (`transport.rs`, the `Err(e) =>` arm ~line 428), add before the transient check:

```rust
eprintln!("[DFU] {}", describe_serial_error(&format!("open {display_port} attempt {}/{}", attempt + 1, max_retries), &e));
```

- [ ] **Step 6: Run the suite and commit**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets`
Expected: all pass, no clippy warnings.

```bash
git add src-tauri/src/dfu/transport.rs
git commit -m "feat(dfu): log raw OS error code on serial open failures"
```

---

## Task 2: Instrument the post-flash role-config phase (enumeration snapshot + timing)

**Why:** Confirm whether `COM5` was the live freshly-bound device or a dying pre-DFU instance, and time each sub-step so we see exactly where the ~4 minutes go. This is the trace we ask the customer to reproduce with.

**Files:**
- Modify: `src-tauri/src/dfu/device.rs` (add `snapshot_ports()` helper after `find_nrf52_devices`, ~line 237)
- Modify: `src-tauri/src/dfu/protocol.rs` (Step 9–10 block, ~lines 559–574)
- Test: `src-tauri/src/dfu/device.rs` (inline tests)

**Interfaces:**
- Consumes: `find_nrf52_devices() -> Vec<Nrf52Device>` (existing, `device.rs:205`).
- Produces: `pub fn snapshot_ports() -> String` — comma-joined `"<port>(pid=0x{pid:04X},serial={serial},boot={bool})"` for every compatible device currently enumerated. Used by `protocol.rs` log calls.

- [ ] **Step 1: Write the failing test**

Add to `device.rs` tests:

```rust
#[test]
fn snapshot_ports_returns_string_without_panicking() {
    // No device attached in CI: must return a string (possibly "none"), never panic.
    let s = snapshot_ports();
    assert!(!s.is_empty());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test snapshot_ports_returns_string`
Expected: FAIL — `cannot find function snapshot_ports`.

- [ ] **Step 3: Write minimal implementation**

Add after `find_nrf52_devices` in `device.rs`:

```rust
/// One-line snapshot of all compatible devices currently enumerated.
///
/// Diagnostic only — used to capture the COM/serial/mode landscape at the
/// moment of a post-reboot port open, where Windows re-enumeration races live.
pub fn snapshot_ports() -> String {
    let devices = find_nrf52_devices();
    if devices.is_empty() {
        return "none".to_string();
    }
    devices
        .iter()
        .map(|d| {
            format!(
                "{}(pid=0x{:04X},serial={},boot={})",
                d.port,
                d.pid,
                d.serial_number.as_deref().unwrap_or("?"),
                d.in_bootloader
            )
        })
        .collect::<Vec<_>>()
        .join(", ")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test snapshot_ports_returns_string`
Expected: PASS.

- [ ] **Step 5: Add timed logging around Step 9–10 in `protocol.rs`**

Replace the Step 9–10 block (currently `protocol.rs:559-574`) so each sub-step logs a snapshot + elapsed time. Use the existing `on_progress(DfuStage::Log { message })` pattern and `std::time::Instant`:

```rust
    // Step 9: Wait for device to reboot into application mode
    on_progress(DfuStage::WaitingForReboot);
    std::thread::sleep(Duration::from_millis(get_reboot_settle_delay()));
    on_progress(DfuStage::Log {
        message: format!("Post-reboot port snapshot: {}", crate::dfu::device::snapshot_ports()),
    });
    on_progress(DfuStage::Log {
        message: format!("Scanning for device in application mode (timeout: {}ms)...", get_reboot_timeout()),
    });
    let app_device = wait_for_application_flexible(&device_identifier, get_reboot_timeout())?;
    on_progress(DfuStage::Log {
        message: format!("Device found on port {} | snapshot: {}", app_device.port, crate::dfu::device::snapshot_ports()),
    });

    // Step 10: Configure device role (instrumented)
    on_progress(DfuStage::ConfiguringRole);
    let role_started = std::time::Instant::now();
    let role_result = configure_device_role_flexible(&app_device.port, device_role, &device_identifier);
    on_progress(DfuStage::Log {
        message: format!(
            "Role config finished in {}ms (ok={}) | snapshot: {}",
            role_started.elapsed().as_millis(),
            role_result.is_ok(),
            crate::dfu::device::snapshot_ports()
        ),
    });
    role_result?;
```

> This preserves existing behavior (`?` still propagates) while emitting timing + before/after enumeration snapshots. Confirm `crate::dfu::device::snapshot_ports` is the correct module path for this crate; adjust to `super::device::snapshot_ports` if `protocol.rs` already imports `device` items that way.

- [ ] **Step 6: Run the suite and commit**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets`
Expected: all pass.

```bash
git add src-tauri/src/dfu/device.rs src-tauri/src/dfu/protocol.rs
git commit -m "feat(dfu): instrument post-flash role-config with port snapshots and timing"
```

- [ ] **Step 7: Field-capture checkpoint (manual, gates Task 5)**

Build a Windows binary with Tasks 1–2, have the customer reproduce, and collect the new log lines. **Decision:** if the trace shows the multi-minute block is entirely in the `open` (`os_code=121` from `CreateFile`), Task 5's read-guard is unnecessary (YAGNI) — Tasks 3+4 plus the existing open-retry loop suffice. If a post-open read/`PurgeComm` blocks, implement Task 5. Record the decision in the PR description.

---

## Task 3: Classify the semaphore-timeout error as transient/retriable

**Why:** Fixes both misclassifications (#1 open-retry, #2 inner role-config retry). With this, the existing bounded open-retry loop will retry the readiness race instead of failing fatally.

**Files:**
- Modify: `src-tauri/src/dfu/transport.rs` — `is_transient_port_error` (~line 323)
- Modify: `src-tauri/src/dfu/error.rs` — `is_retriable` Serial branch (~line 145)
- Test: both files' inline `tests` modules

**Interfaces:**
- Modifies behavior of existing `is_transient_port_error(&str) -> bool` and `DfuError::is_retriable(&self) -> bool`. No signature change.

- [ ] **Step 1: Write the failing tests**

In `transport.rs` tests:

```rust
#[test]
fn semaphore_timeout_is_transient_port_error() {
    // Windows ERROR_SEM_TIMEOUT surfaces as this exact message.
    assert!(is_transient_port_error("the semaphore timeout period has expired"));
}
```

In `error.rs` tests (near `test_error_is_retriable`, ~line 236):

```rust
#[test]
fn semaphore_timeout_serial_error_is_retriable() {
    let err = DfuError::Serial(serialport::Error::new(
        serialport::ErrorKind::Io(std::io::ErrorKind::TimedOut),
        "The semaphore timeout period has expired",
    ));
    assert!(err.is_retriable(), "ERROR_SEM_TIMEOUT must be treated as transient");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test semaphore_timeout`
Expected: both FAIL (assertion failed — currently classified non-transient).

- [ ] **Step 3: Implement the classification**

In `is_transient_port_error` (`transport.rs`), add to the `||` chain:

```rust
        // Windows ERROR_SEM_TIMEOUT (121): the USB CDC pipe is not yet bound /
        // is being torn down during re-enumeration. Resolves on retry.
        || err_str.contains("semaphore timeout")
        || err_str.contains("timeout period has expired")
```

In `error.rs`, `is_retriable`'s `DfuError::Serial` branch, add to the `||` chain (alongside `msg.contains("timed out")`):

```rust
                    || msg.contains("semaphore timeout")
                    || msg.contains("timeout period has expired")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test semaphore_timeout`
Expected: both PASS.

- [ ] **Step 5: Run the suite and commit**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets`
Expected: all pass.

```bash
git add src-tauri/src/dfu/transport.rs src-tauri/src/dfu/error.rs
git commit -m "fix(dfu): treat Windows ERROR_SEM_TIMEOUT as a transient serial error"
```

---

## Task 4: Never re-flash after a successful transfer — tag role-config-phase failures

**Why:** This is the most damaging behavior: a role-config failure re-runs erase + 212 KB transfer (`is_operation_retriable("...timeout...")` → `true`). The flash already succeeded; the correct recovery is to retry role config, not the device flash. We tag every error from Step 10 as a role-config-phase failure and make the operation loop refuse to re-flash on it.

**Files:**
- Modify: `src-tauri/src/dfu/protocol.rs` — wrap Step 10 errors in `DfuError::RoleConfigFailed` (the `role_result` from Task 2, ~line 574)
- Modify: `src-tauri/src/commands/dfu.rs` — `is_operation_retriable(&str)` (~line 48): exclude role-config-phase failures
- Test: `src-tauri/src/commands/dfu.rs` inline tests

**Interfaces:**
- Consumes: `DfuError::RoleConfigFailed { reason }` Display = `"Failed to configure device role: {reason}"` (`error.rs:96`).
- Produces: `is_operation_retriable("Failed to configure device role: ...") == false` — the marker the operation loop uses to skip re-flash.

- [ ] **Step 1: Write the failing test**

Add to `dfu.rs` tests (find or create `#[cfg(test)] mod tests`):

```rust
#[test]
fn role_config_failure_does_not_trigger_reflash() {
    // A role-config-phase failure means the flash already succeeded.
    // It must NOT be operation-retriable (which would re-erase + re-transfer).
    let msg = "Failed to configure device role: Serial port error: The semaphore timeout period has expired";
    assert!(!is_operation_retriable(msg), "role-config failure must not re-flash");
}

#[test]
fn genuine_bootloader_timeout_still_retriable() {
    // Regression guard: real flash-phase failures must still retry.
    assert!(is_operation_retriable("Bootloader not found within 30000ms"));
}
```

- [ ] **Step 2: Run tests to verify the first fails**

Run: `cd src-tauri && cargo test role_config_failure_does_not_trigger_reflash`
Expected: FAIL — current `is_operation_retriable` matches `contains("timeout")` → returns `true`.

- [ ] **Step 3: Exclude role-config-phase failures in `is_operation_retriable`**

In `dfu.rs:48`, add an early guard at the top of the function (before the `contains` chain):

```rust
fn is_operation_retriable(error: &str) -> bool {
    let e = error.to_lowercase();

    // Role-configuration failures occur AFTER a successful firmware transfer.
    // Re-running the operation would needlessly re-erase + re-flash a device
    // that is already updated. These are recovered by role-config's own retry,
    // not by a full operation retry.
    if e.contains("failed to configure device role") {
        return false;
    }

    e.contains("timeout")
        || e.contains("bootloader")
        // ... (rest unchanged)
```

- [ ] **Step 4: Tag Step 10 errors as role-config-phase in `protocol.rs`**

So that *any* error from `configure_device_role_flexible` (including a raw `DfuError::Serial` from the open) carries the role-config marker, map it in the Step 10 block from Task 2:

```rust
    let role_result = configure_device_role_flexible(&app_device.port, device_role, &device_identifier)
        .map_err(|e| DfuError::RoleConfigFailed {
            reason: e.to_string(),
        });
```

> This guarantees the Display string starts with `"Failed to configure device role:"`, which is exactly what `is_operation_retriable`'s new guard keys on. The inner `reason` still contains the original error for diagnostics.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test role_config_failure_does_not_trigger_reflash genuine_bootloader_timeout_still_retriable`
Expected: both PASS.

- [ ] **Step 6: Run the suite and commit**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets`
Expected: all pass.

```bash
git add src-tauri/src/dfu/protocol.rs src-tauri/src/commands/dfu.rs
git commit -m "fix(dfu): never re-flash after a successful transfer when role config fails"
```

> After this task, role-config still retries internally (`MAX_CONFIG_RETRIES`, now effective because Task 3 made the error retriable), but a *final* role-config failure surfaces to the user as "firmware updated, role not configured" without destroying the good flash. If a dedicated user-facing "retry role only" affordance is wanted, that's a frontend follow-up, out of scope here.

---

## Task 5: Bound Windows serial reads so a wedged pipe can't block for minutes (GATED on Task 2 Step 7)

**Why:** Only implement if the Task 2 field trace shows the multi-minute block is in a *post-open* op (read / `PurgeComm`), not the already-guarded `CreateFile`. `serialport`'s read honors `COMMTIMEOUTS` only when the pipe is healthy; a wedged USB pipe blocks until the driver's own multi-minute semaphore timeout. This mirrors the existing `open_port_with_timeout` thread-guard (`transport.rs:343`) for reads.

**Files:**
- Modify: `src-tauri/src/dfu/transport.rs` — add `read_with_guard`, use it in `drain_boot_output`'s first read
- Modify: `src-tauri/src/dfu/protocol.rs` — `drain_boot_output` (~line 811) first-read path
- Test: `src-tauri/src/dfu/transport.rs` inline tests

**Interfaces:**
- Produces: a bounded first-read so `drain_boot_output` returns a transient error (retriable via Task 3) instead of blocking, when the pipe is wedged.

- [ ] **Step 1: Write the failing test (timing bound on the guard)**

```rust
#[test]
fn guarded_read_respects_wall_clock_bound() {
    // The guard must return within ~2x the bound even if the inner read would
    // block far longer. We simulate with a closure that sleeps.
    use std::time::{Duration, Instant};
    let start = Instant::now();
    let result = run_with_windows_timeout(Duration::from_millis(200), || {
        std::thread::sleep(Duration::from_millis(5000));
        Ok::<(), ()>(())
    });
    assert!(start.elapsed() < Duration::from_millis(1500), "guard did not bound the call");
    assert!(result.is_err(), "guard must report timeout as error");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test guarded_read_respects_wall_clock_bound`
Expected: FAIL — `cannot find function run_with_windows_timeout`.

- [ ] **Step 3: Extract the existing thread-timeout pattern into a reusable guard**

Add to `transport.rs` (generalize the body of `open_port_with_timeout`'s Windows branch):

```rust
/// Run a potentially-blocking serial op on a worker thread with a wall-clock
/// bound. On timeout the worker is orphaned (it completes when the OS unblocks)
/// and an error is returned, so a wedged USB pipe cannot stall the caller.
///
/// Non-Windows: runs inline (these ops do not block on macOS/Linux).
fn run_with_windows_timeout<T, F>(bound: Duration, f: F) -> Result<T, ()>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, ()> + Send + 'static,
{
    #[cfg(target_os = "windows")]
    {
        use std::sync::mpsc;
        let (tx, rx) = mpsc::channel();
        let _handle = std::thread::spawn(move || {
            let _ = tx.send(f());
        });
        match rx.recv_timeout(bound) {
            Ok(r) => r,
            Err(_) => Err(()),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = bound;
        f()
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test guarded_read_respects_wall_clock_bound`
Expected: PASS.

- [ ] **Step 5: Apply the guard to the first drain read**

In `drain_boot_output` (`protocol.rs`), the concern is the *first* read after open against a not-yet-ready pipe. Bound just that first read; once data flows the pipe is healthy. Implementation detail: because `SerialTransport` is not `Send`-cloneable, do not move the transport into the thread — instead probe readiness on a throwaway open inside the guard before draining. Concretely, before the drain loop, add:

```rust
    // Windows readiness gate: ensure the pipe answers a settings query within a
    // bound before we trust blocking reads. A wedged CDC pipe (ERROR_SEM_TIMEOUT)
    // returns a transient error here, which the caller retries (see is_retriable).
    #[cfg(target_os = "windows")]
    {
        let healthy = transport.is_port_healthy(); // existing, transport.rs:300
        if !healthy {
            return Err(DfuError::Serial(serialport::Error::new(
                serialport::ErrorKind::Io(std::io::ErrorKind::TimedOut),
                "Port not ready after reboot (semaphore timeout window)",
            )));
        }
    }
```

> `is_port_healthy` (`transport.rs:300`) reads `baud_rate()` (a `GetCommState` call) — fast and non-blocking even on a half-bound pipe, returning `false` rather than hanging. The returned error message contains `"semaphore timeout"`, so Task 3's classification makes it retriable; the role-config retry then re-opens after `CONFIG_RETRY_DELAY_MS`. If the field trace shows `is_port_healthy` itself blocks, wrap it via `run_with_windows_timeout` instead.

- [ ] **Step 6: Run the suite and commit**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets`
Expected: all pass.

```bash
git add src-tauri/src/dfu/transport.rs src-tauri/src/dfu/protocol.rs
git commit -m "fix(dfu): bound Windows readiness check before role-config reads"
```

---

## Task 6: End-to-end verification on Windows hardware (manual)

**Why:** The root cause is OS + hardware timing; unit tests cover the classification/retry logic but not the live race. This is the acceptance gate.

**Files:** none (verification only).

- [ ] **Step 1:** Build a Windows release: `npm run tauri:build`.
- [ ] **Step 2:** On a Windows machine with a Feather nRF52840, flash a firmware build (any version — the bug is firmware-independent) from a clean/un-configured device so role config runs.
- [ ] **Step 3:** Confirm in the log: transfer completes, role config succeeds (possibly after 1–2 internal retries), and the run ends in success. **No "Attempt N failed ... re-flash"**, no multi-minute hang.
- [ ] **Step 4:** Force the race (reproduce the original): if it still surfaces, capture the Task 1–2 trace and confirm the bound now caps role-config time (target: well under 60 s) and the flash is never repeated.
- [ ] **Step 5:** Regression: run a normal macOS flash to confirm zero behavior change there.
- [ ] **Step 6:** Update `BlueBuzzah-Updater/CLAUDE.md` Troubleshooting table with a row: `"Semaphore timeout" on Windows after flash | Fixed — role config now retries readiness without re-flashing`. Commit.

```bash
git add BlueBuzzah-Updater/CLAUDE.md
git commit -m "docs: note Windows post-flash role-config resilience fix"
```

---

## Self-Review

**Spec coverage:**
- Instrumentation (raw OS code + enumeration snapshot + timing) → Tasks 1, 2. ✓
- Misclassification #1 (open-retry) and #2 (inner role-config retry) → Task 3. ✓
- Re-flash bug → Task 4. ✓
- Multi-minute hang → Task 5 (gated) + the bounded open-retry that Task 3 unlocks. ✓
- macOS no-regression → Tasks 3/5 are no-ops or proven-fast off-Windows; Task 6 Step 5. ✓
- Firmware-independence → Global Constraints; Task 6 uses any version. ✓

**Placeholder scan:** No TBD/TODO; every code step shows concrete code and exact `cargo test` invocations. ✓

**Type consistency:** `describe_serial_error` (Task 1), `snapshot_ports` (Task 2), `run_with_windows_timeout` (Task 5) names are used consistently. `is_operation_retriable` keys on the `DfuError::RoleConfigFailed` Display prefix `"Failed to configure device role:"` produced in Task 4 Step 4 — matched verbatim in Task 4 Step 3's guard. ✓

**Known soft spots flagged for the implementer:**
- Task 1's `std::io::Error::last_os_error()` recovery is best-effort and must be called immediately after the failing op (noted inline).
- Task 5 is explicitly gated on the Task 2 field trace — do not build it speculatively.
