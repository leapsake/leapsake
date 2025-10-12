use std::fs;
use std::path::Path;

#[derive(serde::Serialize, Clone, Debug)]
pub struct VCardData {
    pub content: String,
    pub file_name: String,
    pub path: String,
}

pub fn get_vcards_from_directory<P: AsRef<Path>>(contacts_dir: P) -> Result<Vec<VCardData>, String> {
    let contacts_dir = contacts_dir.as_ref();

    if !contacts_dir.exists() {
        fs::create_dir_all(contacts_dir)
            .map_err(|e| format!("Failed to create contacts directory: {}", e))?;
    }

    let entries = fs::read_dir(contacts_dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut vcards = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) == Some("vcf") {
            let content = fs::read_to_string(&path)
                .map_err(|e| e.to_string())?;

            vcards.push(VCardData {
                content,
                file_name: path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string(),
                path: path.to_string_lossy().to_string(),
            });
        }
    }

    Ok(vcards)
}