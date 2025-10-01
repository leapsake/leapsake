use std::path::PathBuf;
use std::collections::HashSet;

pub struct FileEntry {
    pub id: String,
    pub path: PathBuf,
    pub tags: HashSet<String>,
}

pub struct FileManager {
    // TODO
}

impl FileManager {
    pub fn new() -> Self {
        Self {}
    }

    pub fn tag_file(&mut self, path: &PathBuf, tags: Vec<String>) -> Result<(), String> {
        Ok(())
    }
}
