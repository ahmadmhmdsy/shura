//! [المهمة 2 — سياسة المسار الأصلية] فحص احتواء معجمي بلا لمس نظام الملفات: التطبيع يُسقط "."
//! ويحل ".." معجميًا، ثم يُقارن المترشح بالجذر على مستوى المقاطع كاملة (لا بادئة نصية، فـ
//! /rootish لا يمر فوق /root). هذا الاستدلال نفسه الذي يحاكيه حوض tauriSink.ts؛ وسلطة القرار
//! النهائية تبقى لنطاق capabilities في plugin-fs، وهذا طبقة دفاع إضافية لمهام الأرشيف
//! والاسترجاع القادمة.
use std::path::{Component, Path, PathBuf};

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
            Component::RootDir | Component::Prefix(_) => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

pub fn is_within_root(root: &Path, candidate: &Path) -> bool {
    let root = lexical_normalize(root);
    let candidate = lexical_normalize(candidate);
    candidate == root || candidate.starts_with(&root)
}

#[cfg(test)]
mod tests {
    use super::is_within_root;
    use std::path::Path;

    #[test]
    fn child_is_allowed_and_sibling_prefix_is_not() {
        assert!(is_within_root(
            Path::new("/root"),
            Path::new("/root/session")
        ));
        assert!(!is_within_root(
            Path::new("/root"),
            Path::new("/rootish/session")
        ));
    }

    #[test]
    fn traversal_is_rejected() {
        assert!(!is_within_root(
            Path::new("/root"),
            Path::new("/root/../other")
        ));
    }

    #[test]
    fn root_itself_is_allowed() {
        assert!(is_within_root(Path::new("/root"), Path::new("/root")));
        assert!(is_within_root(Path::new("/root"), Path::new("/root/")));
    }

    #[test]
    fn nested_dot_segments_are_normalized() {
        assert!(is_within_root(
            Path::new("/root"),
            Path::new("/root/./session/../session/file.md")
        ));
    }

    #[test]
    fn unrelated_absolute_path_is_rejected() {
        assert!(!is_within_root(
            Path::new("/root"),
            Path::new("/etc/shadow")
        ));
    }

    #[test]
    fn relative_candidate_outside_root_is_rejected() {
        assert!(!is_within_root(
            Path::new("/root"),
            Path::new("session/file.md")
        ));
    }

    #[test]
    fn relative_root_and_candidate_are_matched() {
        assert!(is_within_root(
            Path::new("root"),
            Path::new("root/session/file.md")
        ));
        assert!(!is_within_root(
            Path::new("root"),
            Path::new("rootish/session/file.md")
        ));
    }

    #[cfg(windows)]
    #[test]
    fn windows_separators_are_checked() {
        assert!(is_within_root(
            Path::new(r"C:\root"),
            Path::new(r"C:\root\session")
        ));
        assert!(!is_within_root(
            Path::new(r"C:\root"),
            Path::new(r"C:\rootish\session")
        ));
        assert!(!is_within_root(
            Path::new(r"C:\root"),
            Path::new(r"C:\root\..\other")
        ));
    }
}
