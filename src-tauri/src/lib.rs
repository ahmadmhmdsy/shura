// [المهمة 2] سياسة المسار الأصلية (احتواء معجمي + اختبارات بلا لمس قرص المستخدم).
pub mod path_policy;
// [المهمة 9] مفاتيح المزودين في مخزن أسرار نظام التشغيل، لا في الإعدادات.
pub mod credentials;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            credentials::get_provider_key,
            credentials::set_provider_key,
            credentials::delete_provider_key,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}