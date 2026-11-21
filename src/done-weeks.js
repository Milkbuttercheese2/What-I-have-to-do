/* =========================================================================
   완료 업무 묶음 (v3.8.0) — 순수 모듈(상태·DOM·Tauri 없음)
   묶음: 오늘 / 이번 주 / 그 이전은 주별(월요일 시작). 완료 시각(doneAt, epoch ms)이 없으면 '날짜 모름'.
   묶음 키·이름표는 표시용 파생값이다(저장하지 않는다).
   ========================================================================= */
const DOW=['일','월','화','수','목','금','토'];

/* 그 시각이 든 주의 월요일 0시 (지역 시각) */
export function weekStart(ts){
  const d=new Date(ts); d.setHours(0,0,0,0); d.setDate(d.getDate()-((d.getDay()+6)%7)); return d.getTime();
}
export function mdDow(ts){ const d=new Date(ts); return `${d.getMonth()+1}.${d.getDate()}(${DOW[d.getDay()]})`; }
/* 지난 주 이름표: 11.9(월)~11.15(일). 그 주 월요일의 해가 지금과 다르면 앞에 'YYYY년 ' */
export function weekLabel(mon, now){
  const sun=new Date(mon); sun.setDate(sun.getDate()+6);
  const y=new Date(mon).getFullYear();
  return `${y!==new Date(now).getFullYear()?y+'년 ':''}${mdDow(mon)}~${mdDow(sun.getTime())}`;
}
export function doneGroupOf(doneAt, now){
  if(!doneAt) return {key:'nodate', label:'완료 날짜 모름', order:-1};
  now=now||Date.now();
  const d0=new Date(now); d0.setHours(0,0,0,0); const today=d0.getTime();
  const week=weekStart(now);
  if(doneAt>=today) return {key:'today', label:'오늘', order:1e15, mon:week};
  if(doneAt>=week) return {key:'week', label:'이번 주', order:1e15-1, mon:week};
  const mon=weekStart(doneAt);
  return {key:`w${mon}`, label:weekLabel(mon, now), order:mon, mon};
}
/* 펼침 기본값: 모두 펼침(v3.8.1 소유자 지정 — 예전엔 지난 주를 접었다). 머리줄을 누르면 접는다 */
export function groupOpenByDefault(){ return true; }

