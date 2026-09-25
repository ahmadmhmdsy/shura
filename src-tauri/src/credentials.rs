// [المهمة 9] مخزن مفاتيح المزودين في مخزن أسرار نظام التشغيل.
// لا يُسجَّل أي مفتاح ولا خطأ خام: كل ما يخرج من هنا رسالة قصيرة موجّهة للمستخدم.
use std::sync::{Mutex, OnceLock};

use keyring::Entry;
use tauri::State;

const SERVICE: &str = "app.shura.local";
const PROVIDERS: [&str; 4] = ["openrouter", "google", "minimax", "opencodego"];

// وصول مخزن أسرار ويندوز غير آمن للاستخدام المتزامن، فكل وصول يُسلسل بقفل واحد.
static STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    STORE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "تعذر الوصول إلى مخزن المفاتيح".to_string())
}

fn validate_provider(provider_id: &str) -> Result<(), String> {
    if PROVIDERS.contains(&provider_id) {
        Ok(())
    } else {
        Err("مزود غير معروف".to_string())
    }
}

fn map_keyring_error(error: keyring::Error) -> String {
    match error {
        keyring::Error::NoEntry => NO_ENTRY.to_string(),
        keyring::Error::PlatformFailure(_) => "تعذر الوصول إلى مخزن مفاتيح النظام".to_string(),
        _ => "تعذر تنفيذ عملية على مخزن المفاتيح".to_string(),
    }
}

const NO_ENTRY: &str = "لا يوجد مفتاح محفوظ لهذا المزود";

fn entry(provider_id: &str) -> Result<Entry, String> {
    validate_provider(provider_id)?;
    Entry::new(SERVICE, provider_id).map_err(map_keyring_error)
}

#[tauri::command]
pub fn get_provider_key(provider_id: String) -> Result<Option<String>, String> {
    let entry = entry(&provider_id)?;
    let _guard = lock()?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(error) => {
            let message = map_keyring_error(error);
            if message == NO_ENTRY {
                Ok(None)
            } else {
                Err(message)
            }
        }
    }
}

#[tauri::command]
pub fn set_provider_key(provider_id: String, value: String) -> Result<(), String> {
    if value.is_empty() {
        return Err("قيمة المفتاح فارغة".to_string());
    }
    let entry = entry(&provider_id)?;
    let _guard = lock()?;
    entry.set_password(&value).map_err(map_keyring_error)
}

#[tauri::command]
pub fn delete_provider_key(provider_id: String) -> Result<(), String> {
    let entry = entry(&provider_id)?;
    let _guard = lock()?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(error) => {
            let message = map_keyring_error(error);
            if message == NO_ENTRY {
                Ok(())
            } else {
                Err(message)
            }
        }
    }
}

#[allow(dead_code)]
fn _state_is_linked(_: Option<State<()>>) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_provider_before_touching_the_store() {
        assert!(validate_provider("evil").is_err());
        assert!(validate_provider("openrouter").is_ok());
        assert!(validate_provider("").is_err());
        assert!(validate_provider("OpenRouter").is_err());
    }

    #[test]
    fn errors_never_echo_the_secret_or_a_raw_platform_message() {
        let message = map_keyring_error(keyring::Error::PlatformFailure(Box::new(
            std::io::Error::other("secret-value C:\\Users\\name"),
        )));
        assert!(!message.contains("secret-value"));
        assert!(!message.contains("Users"));
    }

    #[test]
    fn a_missing_entry_is_not_an_error_for_delete() {
        assert_eq!(map_keyring_error(keyring::Error::NoEntry), NO_ENTRY);
    }
}
