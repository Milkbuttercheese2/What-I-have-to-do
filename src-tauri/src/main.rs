// 배포 빌드에서는 콘솔 창을 띄우지 않는다(Windows).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    myeot_lib::run()
}
