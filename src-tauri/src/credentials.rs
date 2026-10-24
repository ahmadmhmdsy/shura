// [المهمة 9] مخزن مفاتيح المزودين في مخزن أسرار نظام التشغيل.
// لا يُسجَّل أي مفتاح ولا خطأ خام: كل ما يخرج من هنا رمز خطأ ثابت يترجمه الواجهة.
use std::sync::{Mutex, OnceLock};

use keyring::Entry;

const SERVICE: &str = "app.shura.local";
const PROVIDERS: [&str; 4] = ["openrouter", "google", "minimax", "opencodego"];

// Errors are stable codes, not display text: the frontend maps each one to a resource
// key in the reader's language (credentialBackend.ts), so nothing here is localized.
const LOCK_FAILED: &str = "keychain.lockFailed";
const UNKNOWN_PROVIDER: &str = "keychain.unknownProvider";
const PLATFORM_FAILURE: &str = "keychain.platformFailure";
const OPERATION_FAILED: &str = "keychain.operationFailed";
const EMPTY_VALUE: &str = "keychain.emptyValue";

// وصول مخزن أسرار ويندوز غير آمن للاستخدام المتزامن، فكل وصول يُسلسل بقفل واحد.
static STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    STORE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| LOCK_FAILED.to_string())
}

fn validate_provider(provider_id: &str) -> Result<(), String> {
    if PROVIDERS.contains(&provider_id) {
        Ok(())
    } else {
        Err(UNKNOWN_PROVIDER.to_string())
    }
}

fn map_keyring_error(error: keyring::Error) -> String {
    match error {
        keyring::Error::PlatformFailure(_) => PLATFORM_FAILURE.to_string(),
        _ => OPERATION_FAILED.to_string(),
    }
}

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
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(map_keyring_error(error)),
    }
}

#[tauri::command]
pub fn set_provider_key(provider_id: String, value: String) -> Result<(), String> {
    if value.is_empty() {
        return Err(EMPTY_VALUE.to_string());
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
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(map_keyring_error(error)),
    }
}

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
    fn errors_are_stable_codes_the_frontend_can_map() {
        assert_eq!(validate_provider("evil"), Err(UNKNOWN_PROVIDER.to_string()));
        let message = map_keyring_error(keyring::Error::PlatformFailure(Box::new(
            std::io::Error::other("boom"),
        )));
        assert_eq!(message, PLATFORM_FAILURE);
        assert_eq!(map_keyring_error(keyring::Error::NoEntry), OPERATION_FAILED);
    }
}
