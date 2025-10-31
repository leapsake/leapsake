use std::fs;
use std::path::{Path, PathBuf};

/// Recursively collects all files from the given directories and their subdirectories.
///
/// # Arguments
/// * `dirs` - Array of directory paths to search
/// * `extensions` - Optional array of file extensions to filter by (e.g., ["jscontact", "json"])
///                  If None, all files are returned. Extensions should be specified without the leading dot.
///
/// # Returns
/// * `Result<Vec<PathBuf>, String>` - Vector of file paths, or error message
///
/// # Behavior
/// * Non-existent directories are skipped silently
/// * Hidden files (starting with '.') are included
/// * Symbolic links are followed
/// * Returns absolute paths that can be used with Rust I/O operations
///
/// # Examples
/// ```ignore
/// // Get all files
/// let files = get_files(&["/path/to/dir"], None)?;
///
/// // Get all .txt files
/// let files = get_files(&["/path/to/dir"], Some(&["txt"]))?;
/// ```
pub fn get_files<P: AsRef<Path>>(
    dirs: &[P],
    extensions: Option<&[&str]>,
) -> Result<Vec<PathBuf>, String> {
    dirs.iter()
        .filter_map(|dir| {
            let dir = dir.as_ref();
            if dir.exists() {
                Some(collect_files_recursive(dir, extensions))
            } else {
                None
            }
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|nested| nested.into_iter().flatten().collect())
}

/// Recursively collects and transforms files from the given directories and their subdirectories.
///
/// # Arguments
/// * `dirs` - Array of directory paths to search
/// * `extensions` - Optional array of file extensions to filter by (e.g., ["jscontact", "json"])
///                  If None, all files are returned. Extensions should be specified without the leading dot.
/// * `callback` - Function to transform each file path into the desired output type
///
/// # Returns
/// * `Result<Vec<T>, String>` - Vector of transformed results, or error message
///
/// # Behavior
/// * Non-existent directories are skipped silently
/// * Hidden files (starting with '.') are included
/// * Symbolic links are followed
///
/// # Examples
/// ```ignore
/// // Transform to file names using callback
/// let names = get_files_with(&["/path/to/dir"], None, |p: &PathBuf| {
///     p.file_name().unwrap().to_str().unwrap().to_string()
/// })?;
/// ```
pub fn get_files_with<P, F, T>(
    dirs: &[P],
    extensions: Option<&[&str]>,
    callback: F,
) -> Result<Vec<T>, String>
where
    P: AsRef<Path>,
    F: Fn(&PathBuf) -> T + Copy,
{
    dirs.iter()
        .filter_map(|dir| {
            let dir = dir.as_ref();
            if dir.exists() {
                Some(collect_files_with_callback(dir, extensions, callback))
            } else {
                None
            }
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|nested| nested.into_iter().flatten().collect())
}

fn collect_files_recursive(
    dir: &Path,
    extensions: Option<&[&str]>,
) -> Result<Vec<PathBuf>, String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    entries
        .map(|entry| {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();

            if path.is_dir() {
                // Recursively process subdirectories (follows symlinks)
                collect_files_recursive(&path, extensions)
            } else if path.is_file() {
                // Check if file matches extension filter (if provided)
                let matches_filter = match extensions {
                    Some(exts) => path
                        .extension()
                        .and_then(|s| s.to_str())
                        .map(|ext| exts.contains(&ext))
                        .unwrap_or(false),
                    None => true,
                };

                if matches_filter {
                    Ok(vec![path])
                } else {
                    Ok(vec![])
                }
            } else {
                Ok(vec![])
            }
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|nested| nested.into_iter().flatten().collect())
}

fn collect_files_with_callback<F, T>(
    dir: &Path,
    extensions: Option<&[&str]>,
    callback: F,
) -> Result<Vec<T>, String>
where
    F: Fn(&PathBuf) -> T + Copy,
{
    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    entries
        .map(|entry| {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();

            if path.is_dir() {
                // Recursively process subdirectories (follows symlinks)
                collect_files_with_callback(&path, extensions, callback)
            } else if path.is_file() {
                // Check if file matches extension filter (if provided)
                let matches_filter = match extensions {
                    Some(exts) => path
                        .extension()
                        .and_then(|s| s.to_str())
                        .map(|ext| exts.contains(&ext))
                        .unwrap_or(false),
                    None => true,
                };

                if matches_filter {
                    Ok(vec![callback(&path)])
                } else {
                    Ok(vec![])
                }
            } else {
                Ok(vec![])
            }
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|nested| nested.into_iter().flatten().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_get_files_no_filter() {
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path();

        // Create test files
        fs::File::create(temp_path.join("file1.txt")).unwrap();
        fs::File::create(temp_path.join("file2.json")).unwrap();
        fs::create_dir(temp_path.join("subdir")).unwrap();
        fs::File::create(temp_path.join("subdir/file3.txt")).unwrap();

        let files = get_files(&[temp_path], None).unwrap();
        assert_eq!(files.len(), 3);
    }

    #[test]
    fn test_get_files_with_extension_filter() {
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path();

        // Create test files
        fs::File::create(temp_path.join("file1.txt")).unwrap();
        fs::File::create(temp_path.join("file2.json")).unwrap();
        fs::File::create(temp_path.join("file3.txt")).unwrap();

        let files = get_files(&[temp_path], Some(&["txt"])).unwrap();
        assert_eq!(files.len(), 2);
    }

    #[test]
    fn test_get_files_skips_nonexistent_dirs() {
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path();
        let nonexistent = temp_path.join("does_not_exist");

        fs::File::create(temp_path.join("file1.txt")).unwrap();

        let files = get_files(&[temp_path, &nonexistent], None).unwrap();
        assert_eq!(files.len(), 1);
    }

    #[test]
    fn test_get_files_includes_hidden_files() {
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path();

        fs::File::create(temp_path.join(".hidden")).unwrap();
        fs::File::create(temp_path.join("visible.txt")).unwrap();

        let files = get_files(&[temp_path], None).unwrap();
        assert_eq!(files.len(), 2);
    }

    #[test]
    fn test_get_files_multiple_directories() {
        let temp_dir1 = TempDir::new().unwrap();
        let temp_dir2 = TempDir::new().unwrap();

        fs::File::create(temp_dir1.path().join("file1.txt")).unwrap();
        fs::File::create(temp_dir2.path().join("file2.txt")).unwrap();

        let files = get_files(&[temp_dir1.path(), temp_dir2.path()], None).unwrap();
        assert_eq!(files.len(), 2);
    }


    #[test]
    fn test_get_files_with_callback() {
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path();

        fs::File::create(temp_path.join("file1.txt")).unwrap();
        fs::File::create(temp_path.join("file2.txt")).unwrap();

        // Use callback to extract just the file names
        let callback = |path: &PathBuf| {
            path.file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string()
        };

        let file_names: Vec<String> = get_files_with(&[temp_path], None, callback).unwrap();
        assert_eq!(file_names.len(), 2);
        assert!(file_names.contains(&"file1.txt".to_string()));
        assert!(file_names.contains(&"file2.txt".to_string()));
    }

    #[test]
    fn test_get_files_with_transformation() {
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path();

        fs::File::create(temp_path.join("file1.txt")).unwrap();
        fs::File::create(temp_path.join("file2.txt")).unwrap();

        // Use callback to return path lengths
        let callback = |path: &PathBuf| path.to_string_lossy().len();

        let lengths: Vec<usize> = get_files_with(&[temp_path], None, callback).unwrap();
        assert_eq!(lengths.len(), 2);
        assert!(lengths.iter().all(|&len| len > 0));
    }
}


