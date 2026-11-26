/* =========================================================================
   메모 구역 제목 (소유자 지정, 2026-11-27) — 순수 모듈(상태·DOM·Tauri 없음).
   양식 메모 칸·2쪽 보기·미니 창·공유 메모지가 모두 이 규칙 하나를 쓴다(태그 동작을 양식과 미니 창에서
   같게 한 것과 같은 원칙). capture-win.js 도 import 하므로 맨 위 부작용을 두지 말 것.

   규칙(소유자: "[제목]이 한 줄을 차지할 때만 구분선을 긋는다. 그 밖에 줄을 그으면 별표·별지 같은 데서 문제가 있을 수 있다"):
   - 한 줄이 통째로 `[제목]` 일 때만 구역 제목이다. 앞뒤 공백은 허용, 대괄호 안이 비어 있지 않아야 하고
     그 줄에 다른 글자가 없어야 한다.
   - 구역 제목이 아닌 것: `[긴급] 오늘 중 회신`(뒤에 글), `시행령 [별표 2] 참조`(줄 가운데), `[]`(빈 대괄호),
     닫히지 않은 `[`, `[가] [나]`(한 줄에 대괄호 둘 이상).
   - 메모의 맨 처음(앞이 빈 줄·공백뿐)인 구역 제목은 메모의 제목 구실이라 위에 선을 긋지 않는다.
   - 화면에서는 가로선만 긋는다. 저장되는 글자는 바꾸지 않는다(보이는 모양만).
   ========================================================================= */

/* 줄 전체 = 앞 공백 · '[' · (대괄호·줄바꿈이 아닌 글자) · ']' · 뒤 공백 */
const HEAD=/^[ \t　]*\[([^\[\]\n]*)\][ \t　]*$/;

/* 한 줄이 구역 제목이면 대괄호 안의 이름(앞뒤 공백 뺌), 아니면 null */
export function sectionTitle(line){
  const m=HEAD.exec(String(line??''));
  if(!m) return null;
  const t=m[1].trim();
  return t || null;
}

/* 위에 선을 그을 줄 번호들(0부터) — 구역 제목이면서 앞에 글이 있는 줄만 */
export function sectionLines(text){
  const lines=String(text??'').split('\n'), out=[];
  let seen=false;
  for(let i=0;i<lines.length;i++){
    if(seen && sectionTitle(lines[i])!==null) out.push(i);
    if(lines[i].trim()) seen=true;
  }
  return out;
}

/* 백드롭 층에 선 표시를 끼운다. html 은 text 를 이스케이프(·태그 하이라이트)한 것으로, 줄바꿈이 text 와 1:1 이어야 한다.
   선은 글자 흐름 밖(position:absolute)의 빈 요소라 글자 자리·줄 높이를 바꾸지 않는다(CSS .msec).
   lines 를 주면 그 줄 번호를 쓴다(2쪽 보기처럼 글을 나눠 그릴 때 — sectionLinesIn). */
export const SEC_MARK='<i class="msec"></i>';
export function markSections(html, text, lines){
  const idx=lines || sectionLines(text);
  if(!idx.length) return html;
  const set=new Set(idx);
  return String(html).split('\n').map((p,i)=>set.has(i)?SEC_MARK+p:p).join('\n');
}

/* 글의 한 조각(2쪽 보기의 한 쪽 = full.slice(start,end)) 안에서 선을 그을 줄 번호 — 조각 안 줄 번호로.
   쪽이 줄 가운데에서 시작하면 그 첫 토막은 줄 머리가 아니므로 선을 긋지 않는다. */
export function sectionLinesIn(full, start, end){
  full=String(full??'');
  const out=[];
  let pos=full.lastIndexOf('\n', start-1)+1;                 // 조각 첫 토막이 든 줄의 시작(전체 기준)
  let seen=/\S/.test(full.slice(0,pos));                      // 그 줄 앞에 글이 있었나
  for(let k=0; pos<end; k++){
    let nl=full.indexOf('\n', pos); if(nl<0) nl=full.length;
    const line=full.slice(pos, nl);
    if(pos>=start && seen && sectionTitle(line)!==null) out.push(k);
    if(line.trim()) seen=true;
    pos=nl+1;
  }
  return out;
}
