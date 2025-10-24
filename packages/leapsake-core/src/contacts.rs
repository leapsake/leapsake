use std::fs;
use std::path::{Path, PathBuf};
use crate::utils::get_files_with;

#[derive(serde::Serialize, Clone, Debug)]
pub struct JSContactData {
    pub content: String,
    pub file_name: String,
    pub path: String,
}

pub fn get_contacts<P: AsRef<Path>>(contact_dirs: &[P]) -> Result<Vec<JSContactData>, String> {
    // Create directories if they don't exist
    for dir in contact_dirs {
        let dir = dir.as_ref();
        if !dir.exists() {
            fs::create_dir_all(dir)
                .map_err(|e| format!("Failed to create contacts directory: {}", e))?;
        }
    }

    // Get all .jscontact files and transform them into JSContactData
    let callback = |path: &PathBuf| -> Result<JSContactData, String> {
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;

        Ok(JSContactData {
            content,
            file_name: path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string(),
            path: path.to_string_lossy().to_string(),
        })
    };

    let contact_results: Vec<Result<JSContactData, String>> =
        get_files_with(contact_dirs, Some(&["jscontact"]), None, callback)?;

    // Collect results, propagating any errors
    contact_results.into_iter().collect()
}
