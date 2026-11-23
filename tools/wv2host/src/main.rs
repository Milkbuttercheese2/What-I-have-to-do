// 시험용 WebView2 창 — 앱과 같은 wry/tao(WebView2)로 주소 하나를 띄우고 앱처럼 웹뷰 배율(zoom)을 건다.
// 쓰기: wv2host <url> <zoom> <width> <height>   (CDP: 환경 변수 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=N)
use tao::{dpi::LogicalSize, event::{Event, WindowEvent}, event_loop::{ControlFlow, EventLoop}, window::WindowBuilder};
use wry::{WebContext, WebViewBuilder};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let url = a.get(1).cloned().unwrap_or_else(|| "about:blank".into());
    let zoom: f64 = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(1.0);
    let w: f64 = a.get(3).and_then(|s| s.parse().ok()).unwrap_or(1280.0);
    let h: f64 = a.get(4).and_then(|s| s.parse().ok()).unwrap_or(720.0);
    let data = std::env::current_exe().unwrap().parent().unwrap().join("wv2data");
    let event_loop = EventLoop::new();
    let window = WindowBuilder::new().with_title("wv2 probe").with_inner_size(LogicalSize::new(w, h)).build(&event_loop).unwrap();
    let mut ctx = WebContext::new(Some(data));
    let webview = WebViewBuilder::new_with_web_context(&mut ctx).with_url(&url).build(&window).unwrap();
    let _ = webview.zoom(zoom);
    event_loop.run(move |event, _, cf| {
        *cf = ControlFlow::Wait;
        let _ = &webview;
        if let Event::WindowEvent { event: WindowEvent::CloseRequested, .. } = event { *cf = ControlFlow::Exit; }
    });
}
