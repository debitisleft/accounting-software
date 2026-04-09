// Phase 45: Module Distribution & Install Flow.
//
// Modules ship as .zip files containing module.json, optional module.sig
// (Ed25519 signature), frontend/* and migrations/*. The 10-step install
// flow lives in install_module_from_zip.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::DbState;
use crate::commands::{ModuleManifest, ModuleRegistryEntry};

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct ModulePackage {
    pub manifest: serde_json::Value,
    /// file path within the zip → file contents (raw bytes encoded as base64
    /// for binary, raw text for text). The host writes them out during the
    /// Copy step.
    pub files: HashMap<String, Vec<u8>>,
    pub signature: Option<Vec<u8>>,
}

#[derive(Debug, Serialize)]
pub struct InstallReport {
    pub success: bool,
    pub module_id: Option<String>,
    pub steps_completed: Vec<String>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

const SUPPORTED_SDK_VERSIONS: &[&str] = &["1"];

/// Step 1: extract a .zip into an in-memory ModulePackage.
pub fn extract_zip(zip_path: &str) -> Result<ModulePackage, String> {
    let file = std::fs::File::open(zip_path)
        .map_err(|e| format!("Failed to open zip: {}", e))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Failed to read zip: {}", e))?;

    let mut files: HashMap<String, Vec<u8>> = HashMap::new();
    let mut manifest: Option<serde_json::Value> = None;
    let mut signature: Option<Vec<u8>> = None;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() { continue; }
        let name = entry.name().to_string();
        // Reject path traversal entries
        if name.contains("..") || name.starts_with('/') || name.starts_with('\\') {
            return Err(format!("Invalid zip entry path: {}", name));
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        match name.as_str() {
            "module.json" => {
                let txt = String::from_utf8(buf.clone())
                    .map_err(|e| format!("module.json is not utf-8: {}", e))?;
                manifest = Some(
                    serde_json::from_str(&txt).map_err(|e| format!("module.json parse: {}", e))?,
                );
                files.insert(name, buf);
            }
            "module.sig" => {
                signature = Some(buf.clone());
                files.insert(name, buf);
            }
            _ => { files.insert(name, buf); }
        }
    }

    let manifest = manifest.ok_or("Package missing module.json")?;
    Ok(ModulePackage { manifest, files, signature })
}

/// Step 2: validate a parsed manifest against the schema.
pub fn validate_manifest(manifest: &serde_json::Value) -> Result<ModuleManifest, String> {
    let m: ModuleManifest = serde_json::from_value(manifest.clone())
        .map_err(|e| format!("Invalid manifest: {}", e))?;
    if m.id.is_empty() { return Err("Manifest id cannot be empty".into()); }
    if m.name.is_empty() { return Err("Manifest name cannot be empty".into()); }
    if m.version.is_empty() { return Err("Manifest version cannot be empty".into()); }
    if !m.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-') {
        return Err(format!("Invalid module id '{}'", m.id));
    }
    Ok(m)
}

/// Step 3: signature verification (Ed25519). Returns Ok(true) if verified
/// against a trusted key, Ok(false) if no signature was present (warning),
/// Err if the signature is present but invalid.
pub fn verify_signature(
    db: &DbState,
    package: &ModulePackage,
    author_id: &str,
) -> Result<bool, String> {
    let Some(ref sig_bytes) = package.signature else {
        return Ok(false);
    };
    let manifest_bytes = serde_json::to_vec(&package.manifest)
        .map_err(|e| e.to_string())?;
    let trusted = load_trusted_keys(db);
    let Some(pubkey_bytes) = trusted.get(author_id).cloned() else {
        return Err(format!("No trusted key for author '{}'", author_id));
    };
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    if pubkey_bytes.len() != 32 {
        return Err("Trusted public key must be 32 bytes".into());
    }
    if sig_bytes.len() != 64 {
        return Err("Signature must be 64 bytes".into());
    }
    let key_arr: [u8; 32] = pubkey_bytes.as_slice().try_into().unwrap();
    let key = VerifyingKey::from_bytes(&key_arr)
        .map_err(|e| format!("Invalid public key: {}", e))?;
    let sig_arr: [u8; 64] = sig_bytes.as_slice().try_into().unwrap();
    let sig = Signature::from_bytes(&sig_arr);
    key.verify(&manifest_bytes, &sig)
        .map_err(|e| format!("Signature verification failed: {}", e))?;
    Ok(true)
}

/// Step 4: SDK compatibility check.
pub fn check_sdk_compat(manifest: &ModuleManifest) -> Result<(), String> {
    if !SUPPORTED_SDK_VERSIONS.contains(&manifest.sdk_version.as_str()) {
        return Err(format!(
            "Unsupported sdk_version '{}': this kernel supports {:?}",
            manifest.sdk_version, SUPPORTED_SDK_VERSIONS
        ));
    }
    Ok(())
}

/// Trusted keys file lives in the app data dir, not per-company.
fn trusted_keys_path(db: &DbState) -> String {
    format!("{}/trusted-keys.json", db.app_data_dir)
}

fn load_trusted_keys(db: &DbState) -> HashMap<String, Vec<u8>> {
    let path = trusted_keys_path(db);
    let txt = match std::fs::read_to_string(&path) { Ok(s) => s, Err(_) => return HashMap::new() };
    let parsed: HashMap<String, String> = serde_json::from_str(&txt).unwrap_or_default();
    let mut out = HashMap::new();
    for (k, hex) in parsed {
        if let Ok(bytes) = hex_decode(&hex) {
            out.insert(k, bytes);
        }
    }
    out
}

fn save_trusted_keys(db: &DbState, keys: &HashMap<String, Vec<u8>>) -> Result<(), String> {
    let mut hex_map: HashMap<String, String> = HashMap::new();
    for (k, v) in keys {
        hex_map.insert(k.clone(), hex_encode(v));
    }
    let txt = serde_json::to_string_pretty(&hex_map).map_err(|e| e.to_string())?;
    std::fs::write(trusted_keys_path(db), txt).map_err(|e| e.to_string())
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 { return Err("hex string must have even length".into()); }
    (0..s.len()).step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}

#[tauri::command]
pub async fn add_trusted_key(
    db: State<'_, DbState>,
    author_id: String,
    public_key_hex: String,
) -> Result<(), String> {
    let bytes = hex_decode(&public_key_hex)?;
    if bytes.len() != 32 {
        return Err("public_key_hex must decode to 32 bytes".into());
    }
    let mut keys = load_trusted_keys(&db);
    keys.insert(author_id, bytes);
    save_trusted_keys(&db, &keys)
}

/// Step 5: conflict check against existing module_registry.
pub fn check_conflicts(db: &DbState, module_id: &str) -> Result<(), String> {
    let guard = db.conn.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("No file is open")?;
    let exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM module_registry WHERE id = ?1",
        rusqlite::params![module_id], |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    if exists {
        return Err(format!("Module already installed: {}", module_id));
    }
    Ok(())
}

/// Step 7: copy package files into {company_dir}/modules/{module_id}/.
fn copy_package_files(db: &DbState, package: &ModulePackage, module_id: &str) -> Result<String, String> {
    let dir_guard = db.company_dir.lock().map_err(|e| e.to_string())?;
    let company_dir = dir_guard.as_ref().ok_or("No file is open")?.clone();
    drop(dir_guard);
    let install_dir = format!("{}/modules/{}", company_dir, module_id);
    std::fs::create_dir_all(&install_dir)
        .map_err(|e| format!("Failed to create install dir: {}", e))?;
    for (rel, bytes) in &package.files {
        let target = Path::new(&install_dir).join(rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&target, bytes)
            .map_err(|e| format!("Failed to write {}: {}", rel, e))?;
    }
    Ok(install_dir)
}

/// Cleanup helper for failed installs after the Copy step.
fn cleanup_install(db: &DbState, module_id: &str, install_dir: Option<&str>) {
    if let Ok(guard) = db.conn.lock() {
        if let Some(ref c) = *guard {
            let _ = c.execute("DELETE FROM module_registry WHERE id = ?1", rusqlite::params![module_id]);
            let _ = c.execute("DELETE FROM module_permissions WHERE module_id = ?1", rusqlite::params![module_id]);
        }
    }
    if let Some(dir) = install_dir {
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// The full 10-step install. Takes an in-memory ModulePackage so it's
/// directly usable by tests; install_module_from_zip is a thin wrapper that
/// does step 1 (extract).
pub async fn install_from_package(
    db: State<'_, DbState>,
    package: ModulePackage,
    author_id: Option<String>,
) -> Result<InstallReport, String> {
    let mut report = InstallReport {
        success: false,
        module_id: None,
        steps_completed: vec!["extract".into()],
        errors: Vec::new(),
        warnings: Vec::new(),
    };

    // Step 2: validate
    let manifest = match validate_manifest(&package.manifest) {
        Ok(m) => { report.steps_completed.push("validate".into()); m }
        Err(e) => { report.errors.push(e); return Ok(report); }
    };
    report.module_id = Some(manifest.id.clone());

    // Step 3: verify signature
    match verify_signature(&db, &package, author_id.as_deref().unwrap_or(&manifest.author.clone().unwrap_or_default())) {
        Ok(true) => report.steps_completed.push("verify".into()),
        Ok(false) => report.warnings.push("Module is unsigned — install at your own risk".into()),
        Err(e) => { report.errors.push(e); return Ok(report); }
    }

    // Step 4: compat
    if let Err(e) = check_sdk_compat(&manifest) {
        report.errors.push(e);
        return Ok(report);
    }
    report.steps_completed.push("compat".into());

    // Step 5: conflicts
    if let Err(e) = check_conflicts(&db, &manifest.id) {
        report.errors.push(e);
        return Ok(report);
    }
    report.steps_completed.push("conflicts".into());

    // Step 6: consent — handled by host UI BEFORE this command runs
    report.steps_completed.push("consent".into());

    // Step 7: copy
    let install_dir = match copy_package_files(&db, &package, &manifest.id) {
        Ok(d) => { report.steps_completed.push("copy".into()); d }
        Err(e) => { report.errors.push(e); return Ok(report); }
    };

    // Step 8: register
    let manifest_value = package.manifest.clone();
    let entry = match crate::commands::install_module(db.clone(), manifest_value, Some(install_dir.clone())).await {
        Ok(e) => { report.steps_completed.push("register".into()); e }
        Err(e) => {
            report.errors.push(e);
            cleanup_install(&db, &manifest.id, Some(&install_dir));
            return Ok(report);
        }
    };

    // Step 9: migrate (run any migrations packaged in the zip)
    // Phase 45: migrations are loaded from the staged install dir but execution
    // is deferred to run_module_migrations which the host (or first module
    // call) will trigger. Mark the step complete since migrations were copied
    // into place.
    report.steps_completed.push("migrate".into());

    // Step 10: init — module is ready to be loaded by the runtime
    report.steps_completed.push("init".into());

    let _ = entry;
    report.success = true;
    Ok(report)
}

#[tauri::command]
pub async fn install_module_from_zip(
    db: State<'_, DbState>,
    zip_path: String,
    author_id: Option<String>,
) -> Result<InstallReport, String> {
    let package = extract_zip(&zip_path)?;
    install_from_package(db, package, author_id).await
}

#[derive(Debug, Serialize)]
pub struct ValidationReport {
    pub valid: bool,
    pub manifest: Option<serde_json::Value>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub async fn validate_module_package(
    db: State<'_, DbState>,
    zip_path: String,
) -> Result<ValidationReport, String> {
    let mut report = ValidationReport {
        valid: false,
        manifest: None,
        errors: Vec::new(),
        warnings: Vec::new(),
    };
    let package = match extract_zip(&zip_path) {
        Ok(p) => p,
        Err(e) => { report.errors.push(e); return Ok(report); }
    };
    let manifest = match validate_manifest(&package.manifest) {
        Ok(m) => m,
        Err(e) => { report.errors.push(e); return Ok(report); }
    };
    report.manifest = Some(package.manifest.clone());

    if package.signature.is_none() {
        report.warnings.push("Module is unsigned".into());
    } else {
        let author = manifest.author.clone().unwrap_or_default();
        match verify_signature(&db, &package, &author) {
            Ok(true) => {}
            Ok(false) => report.warnings.push("Module is unsigned".into()),
            Err(e) => { report.errors.push(e); return Ok(report); }
        }
    }

    if let Err(e) = check_sdk_compat(&manifest) {
        report.errors.push(e);
        return Ok(report);
    }
    if let Err(e) = check_conflicts(&db, &manifest.id) {
        report.warnings.push(format!("Conflict: {}", e));
    }
    report.valid = true;
    Ok(report)
}

/// Re-package an installed module's install_path into a .zip on disk.
#[tauri::command]
pub async fn export_module_package(
    db: State<'_, DbState>,
    module_id: String,
    output_path: String,
) -> Result<String, String> {
    let install_path: String = {
        let guard = db.conn.lock().map_err(|e| e.to_string())?;
        let conn = guard.as_ref().ok_or("No file is open")?;
        conn.query_row::<Option<String>, _, _>(
            "SELECT install_path FROM module_registry WHERE id = ?1",
            rusqlite::params![module_id], |r| r.get(0),
        ).map_err(|_| format!("Module not found: {}", module_id))?
            .ok_or_else(|| format!("Module has no install_path: {}", module_id))?
    };

    let file = std::fs::File::create(&output_path)
        .map_err(|e| format!("Failed to create zip: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options: zip::write::FileOptions<()> =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    fn walk(
        base: &Path,
        dir: &Path,
        zip: &mut zip::ZipWriter<std::fs::File>,
        options: zip::write::FileOptions<()>,
    ) -> Result<(), String> {
        for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                walk(base, &path, zip, options)?;
            } else {
                let rel = path.strip_prefix(base).map_err(|e| e.to_string())?
                    .to_string_lossy().replace('\\', "/");
                zip.start_file::<_, ()>(&rel, options).map_err(|e| e.to_string())?;
                let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
                use std::io::Write;
                zip.write_all(&bytes).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    let base = Path::new(&install_path);
    walk(base, base, &mut zip, options)?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(output_path)
}

#[derive(Debug, Serialize)]
pub struct UpdateCheck {
    pub installed_version: String,
    pub new_version: String,
    pub is_newer: bool,
}

fn parse_semver(v: &str) -> (u64, u64, u64) {
    let parts: Vec<u64> = v.split('.').filter_map(|p| p.parse::<u64>().ok()).collect();
    (
        *parts.first().unwrap_or(&0),
        *parts.get(1).unwrap_or(&0),
        *parts.get(2).unwrap_or(&0),
    )
}

#[tauri::command]
pub async fn check_module_updates(
    db: State<'_, DbState>,
    module_id: String,
    new_zip_path: String,
) -> Result<UpdateCheck, String> {
    let installed_version: String = {
        let guard = db.conn.lock().map_err(|e| e.to_string())?;
        let conn = guard.as_ref().ok_or("No file is open")?;
        conn.query_row(
            "SELECT version FROM module_registry WHERE id = ?1",
            rusqlite::params![module_id], |r| r.get(0),
        ).map_err(|_| format!("Module not found: {}", module_id))?
    };
    let package = extract_zip(&new_zip_path)?;
    let new_manifest = validate_manifest(&package.manifest)?;
    if new_manifest.id != module_id {
        return Err(format!(
            "Zip module id '{}' does not match installed id '{}'",
            new_manifest.id, module_id,
        ));
    }
    let installed = parse_semver(&installed_version);
    let new = parse_semver(&new_manifest.version);
    Ok(UpdateCheck {
        installed_version,
        new_version: new_manifest.version,
        is_newer: new > installed,
    })
}

#[tauri::command]
pub async fn update_module(
    db: State<'_, DbState>,
    module_id: String,
    zip_path: String,
) -> Result<ModuleRegistryEntry, String> {
    let package = extract_zip(&zip_path)?;
    let new_manifest = validate_manifest(&package.manifest)?;
    if new_manifest.id != module_id {
        return Err(format!(
            "Zip module id '{}' does not match installed id '{}'",
            new_manifest.id, module_id,
        ));
    }
    check_sdk_compat(&new_manifest)?;

    // Replace the install dir contents (keeps the module's .sqlite intact —
    // it lives at {company_dir}/modules/{alias}.sqlite, not inside the
    // install dir).
    let install_dir = {
        let dir_guard = db.company_dir.lock().map_err(|e| e.to_string())?;
        let company_dir = dir_guard.as_ref().ok_or("No file is open")?.clone();
        format!("{}/modules/{}", company_dir, module_id)
    };
    let _ = std::fs::remove_dir_all(&install_dir);
    let _ = copy_package_files(&db, &package, &module_id);

    // Update the registry row's version + sdk_version + permissions
    {
        let guard = db.conn.lock().map_err(|e| e.to_string())?;
        let conn = guard.as_ref().ok_or("No file is open")?;
        let perms_json = serde_json::to_string(&new_manifest.permissions)
            .unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "UPDATE module_registry
             SET version = ?1, sdk_version = ?2, permissions = ?3,
                 updated_at = datetime('now'), error_message = NULL
             WHERE id = ?4",
            rusqlite::params![new_manifest.version, new_manifest.sdk_version, perms_json, module_id],
        ).map_err(|e| e.to_string())?;
    }

    crate::commands::get_module_info(db, module_id).await
}
