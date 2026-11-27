//! 성능 재기(점검 라운드 2) — 지어낸 큰 DB 로 `load_all`·저장(`save_all` 경로)·자동 백업·빠른 검색이 걸리는 시간을 잰다.
//!
//! 평소 `cargo test --lib` 에서는 돌지 않는다(#[ignore]). 돌리기:
//!   cargo test --release --lib --offline --locked perf_big_db -- --ignored --nocapture
//! (배포 exe 와 같은 최적화로 재려면 --release. 디버그 빌드는 SQLite 도 최적화 없이 컴파일돼 몇 배 느리다.)
//!
//! 자료는 프런트 도구 `tools/perf-check.mjs` 와 같은 모양으로 짓는다: 진행 중/완료 = 50/500 · 300/3,000 · 1,000/10,000,
//! 업무마다 하위 업무 0~5·관련인 0~3(전화번호부 1,000명 중)·식별정보 0~3·파일 0~2, 메모 길이는 짧음 60% · 중간 30% · 긺(3천 자) 9% · 아주 긺(2만~5만 자) 1%.
//! 단언은 하지 않는다(PC 마다 속도가 달라 흔들리므로) — 가운데값을 찍기만 한다.

use std::collections::HashMap;
use std::time::Instant;

use super::model::*;
use super::{backup, items, phonebook};

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

const WORDS: &[&str] = &[
    "입찰공고", "정정", "사유서", "계약", "검수", "납품", "확인", "회신", "요청", "협조", "자료", "취합", "규격", "대조표", "예산",
    "집행", "결재", "보고", "시설과", "총무과", "공문", "발송", "접수", "검토", "의견", "통화", "내일", "오전", "오후", "마감",
];

fn sentence(r: &mut Rng, n: usize) -> String {
    (0..n).map(|_| WORDS[r.below(WORDS.len() as u64) as usize]).collect::<Vec<_>>().join(" ")
}

fn memo(r: &mut Rng, i: usize) -> String {
    let p = r.below(100);
    let head = format!("업무 {i} — {}", sentence(r, 4));
    if p < 60 {
        return head;
    }
    let lines = if p < 90 { 3 + r.below(6) as usize } else if p < 99 { 60 } else { 400 + r.below(600) as usize };
    let mut s = head;
    for k in 0..lines {
        s.push('\n');
        if k % 12 == 5 {
            s.push_str(&format!("[구역 {k}]"));
        } else {
            let n = 6 + r.below(8) as usize;
            s.push_str(&sentence(r, n));
        }
    }
    s
}

fn iso(day_off: i64, hh: i64) -> String {
    // 기준 2026-11-27 — 날짜만 대충(정확한 달력은 필요 없다: 문자열 길이·모양만 같으면 된다)
    let d = 27 + day_off;
    let (m, dd) = if d < 1 { (10, (d + 30).max(1)) } else if d > 30 { (12, (d - 30).min(28)) } else { (11, d) };
    format!("2026-{m:02}-{dd:02}T{hh:02}:00:00.000Z")
}

fn perf_phonebook() -> Vec<PhonebookEntry> {
    (0..1000)
        .map(|k| PhonebookEntry {
            id: 900_000 + k,
            who: format!("관련인{k:04}"),
            org: format!("제{}부서", k % 60),
            phone: format!("02-{:03}-{:04}", 100 + k % 800, 1000 + k),
            email: if k % 3 == 0 { format!("p{k}@example.go.kr") } else { String::new() },
        })
        .collect()
}

fn perf_items(active: usize, done: usize) -> Vec<Item> {
    let mut r = Rng(0x9E37_79B9_7F4A_7C15);
    let book = perf_phonebook();
    let mut out = Vec::with_capacity(active + done);
    for i in 1..=(active + done) {
        let is_done = i > active;
        let mut f = HashMap::new();
        f.insert("received".to_string(), iso(-(r.below(20) as i64), 9));
        if r.below(10) < 7 {
            f.insert("due".to_string(), iso(r.below(14) as i64 - 4, 9 + r.below(9) as i64));
        }
        let contacts = (0..r.below(4))
            .map(|_| {
                let e = &book[r.below(book.len() as u64) as usize];
                Contact { who: e.who.clone(), org: e.org.clone(), phone: e.phone.clone(), email: e.email.clone() }
            })
            .collect();
        let ids = (0..r.below(4)).map(|k| Identifier { kind: if k == 0 { "공고번호".into() } else { "계약번호".into() }, val: format!("R26BK{:08}", i * 7 + k as usize) }).collect();
        let subs = (0..r.below(6))
            .map(|k| SubTask {
                id: (i * 100 + k as usize) as i64,
                title: sentence(&mut r, 3),
                owner: if k % 3 == 1 { "박조달 주무관".into() } else { String::new() },
                mid: if r.below(3) > 0 { iso(r.below(14) as i64 - 4, 10 + k as i64) } else { String::new() },
                done: is_done || r.below(3) == 0,
                al: AlarmMap::new(),
            })
            .collect();
        let files = (0..r.below(3)).map(|k| format!("C:\\업무\\2026\\{i}\\첨부{k}.hwpx")).collect();
        out.push(Item {
            id: i as i64,
            memo: memo(&mut r, i),
            owner: String::new(),
            f,
            contacts,
            ids,
            subs,
            files,
            done: is_done,
            // 완료는 최근 몇 년에 흩어지게(하루 ~10건)
            done_at: if is_done { Some(1_795_000_000_000 - (i - active) as i64 * 8_640_000) } else { None },
            staged: false,
            al: AlarmMap::new(),
            recur_id: None,
            recur: None,
        });
    }
    out
}

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[v.len() / 2]
}

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

#[test]
#[ignore]
fn perf_big_db() {
    const RUNS: usize = 7;
    println!("\n| 자료(진행/완료) | DB 크기 | load_all(읽기) | load_all JSON 만들기 | 저장(카드 하나 고침) | 저장(하나 완료 처리) | 자동 백업 복사 | 빠른 검색 '협조' | 빠른 검색 '없는말' |");
    println!("|---|---|---|---|---|---|---|---|---|");
    for (active, done) in [(50usize, 500usize), (300, 3000), (1000, 10000)] {
        let dir = std::env::temp_dir().join(format!("wmhh_perf_{}_{}", std::process::id(), active));
        let _ = std::fs::remove_dir_all(&dir);
        let db_path = dir.join("data").join("wmhh.sqlite");
        let backups_dir = dir.join("backups");
        let mut conn = super::open(&db_path).unwrap();
        let all = perf_items(active, done);
        items::save_items(&mut conn, &all).unwrap();
        phonebook::save_phonebook(&mut conn, &perf_phonebook()).unwrap();
        let size_mb = std::fs::metadata(&db_path).unwrap().len() as f64 / 1_048_576.0;

        // load_all = load_app_state + (Tauri 가 하는) JSON 직렬화
        let mut t_load = vec![];
        let mut t_json = vec![];
        let mut json_mb = 0.0;
        for _ in 0..RUNS {
            let t = Instant::now();
            let st = backup::load_app_state(&conn).unwrap();
            t_load.push(ms(t));
            let t = Instant::now();
            let s = serde_json::to_string(&st).unwrap();
            t_json.push(ms(t));
            json_mb = s.len() as f64 / 1_048_576.0;
            assert_eq!(st.items.len(), active + done);
        }

        // 저장 = 프런트가 보내는 것(진행 중 전부, 완료는 안 보냄) — save_items_guarded 가 실제 경로
        let mut act: Vec<Item> = all.iter().filter(|it| !it.done).cloned().collect();
        let mut t_save = vec![];
        for k in 0..RUNS {
            let n = act.len();
            act[k % n].memo.push('.');
            let v = super::meta::read_version(&conn).unwrap();
            let t = Instant::now();
            let o = super::save_items_guarded(&mut conn, &db_path, &backups_dir, &act, &[], 20, Some(v)).unwrap();
            t_save.push(ms(t));
            assert!(matches!(o, super::SaveOutcome::Saved { .. }));
        }
        // 하나 완료 처리: 그 업무가 done=true 로 실려 간다(다음 저장부터는 안 보냄)
        let mut t_done = vec![];
        for _ in 0..RUNS {
            let mut it = act.pop().unwrap();
            it.done = true;
            it.done_at = Some(1_796_000_000_000);
            let mut batch = act.clone();
            batch.push(it);
            let v = super::meta::read_version(&conn).unwrap();
            let t = Instant::now();
            super::save_items_guarded(&mut conn, &db_path, &backups_dir, &batch, &[], 20, Some(v)).unwrap();
            t_done.push(ms(t));
        }

        // 자동 백업(저장 뒤 회전 — 30분 스로틀을 넘었을 때 하는 일): 파일 복사 + 정리
        let mut t_bak = vec![];
        for k in 0..5 {
            let t = Instant::now();
            super::rotate_backup(&db_path, &backups_dir, &format!("20261127_1200{k:02}"), 20).unwrap();
            t_bak.push(ms(t));
        }

        let mut t_q1 = vec![];
        let mut t_q2 = vec![];
        for _ in 0..RUNS {
            let t = Instant::now();
            let hits = items::quick_search(&conn, "협조", 100).unwrap();
            t_q1.push(ms(t));
            assert!(!hits.is_empty());
            let t = Instant::now();
            let none = items::quick_search(&conn, "없는말쯔쯔", 100).unwrap();
            t_q2.push(ms(t));
            assert!(none.is_empty());
        }

        println!(
            "| {active}/{done} | {size_mb:.1}MB (JSON {json_mb:.1}MB) | {:.1}ms | {:.1}ms | {:.1}ms | {:.1}ms | {:.1}ms | {:.1}ms | {:.1}ms |",
            median(t_load), median(t_json), median(t_save), median(t_done), median(t_bak), median(t_q1), median(t_q2)
        );
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
