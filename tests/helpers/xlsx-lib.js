/* 테스트용 SheetJS(src/vendor/xlsx.full.min.js) 읽기 도구.
   저장소가 "type": "module" 이라 이 .js 를 require 하면 Node 판마다 ESM·CJS 판단이 달라져 utils 없는 객체가 올 수 있다
   (CI Node 22.23 에서 27개 실패). 그래서 Node 의 모듈 판단을 거치지 않고 파일 글을 CommonJS 꼴로 직접 평가한다.
   require 는 넘기지 않는다 — SheetJS 는 require 가 없으면 fs·stream 을 쓰지 않을 뿐이고(readFile·writeFile 은 테스트에서 안 쓴다),
   module·exports 가 있으면 거기에 라이브러리를 채운다. 브라우저에서 script 로 실을 때와 같은 코드가 돈다. */
import {readFileSync} from 'node:fs';

const code = readFileSync(new URL('../../src/vendor/xlsx.full.min.js', import.meta.url), 'utf8');
const mod = {exports: {}};
new Function('module', 'exports', 'require', code)(mod, mod.exports, undefined);

export default mod.exports;
