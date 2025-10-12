use std::fs;
use std::path::Path;

#[derive(serde::Serialize, Clone, Debug)]
pub struct VCardData {
    pub content: String,
    pub file_name: String,
    pub path: String,
}

pub fn get_contacts<P: AsRef<Path>>(contact_dirs: &[P]) -> Result<Vec<VCardData>, String> {
    contact_dirs
        .iter()
        .map(|dir| {
            let dir = dir.as_ref();

            if !dir.exists() {
                fs::create_dir_all(dir)
                    .map_err(|e| format!("Failed to create contacts directory: {}", e))?;
            }

            collect_vcards_recursive(dir)
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|nested| nested.into_iter().flatten().collect())
}

fn collect_vcards_recursive(dir: &Path) -> Result<Vec<VCardData>, String> {
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    entries
        .map(|entry| {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();

            if path.is_dir() {
                // Recursively process subdirectories
                collect_vcards_recursive(&path)
            } else if path.extension().and_then(|s| s.to_str()) == Some("vcf") {
                let content = fs::read_to_string(&path)
                    .map_err(|e| e.to_string())?;

                Ok(vec![VCardData {
                    content,
                    file_name: path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_string(),
                    path: path.to_string_lossy().to_string(),
                }])
            } else {
                Ok(vec![])
            }
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|nested| nested.into_iter().flatten().collect())
}
