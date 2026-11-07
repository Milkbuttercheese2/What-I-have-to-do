// ElevenLabs로 문장별 음성을 만든다(조달법령 흐름도 시연 영상과 같은 목소리·설정). 키는 .env에서 읽고 출력하지 않는다. 있는 파일은 다시 만들지 않는다.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { LINES } from "./script.mjs";
const env = readFileSync("C:/Users/rhama/Desktop/AI프로젝트/Which-article-was-is-PPS/.env", "utf8");
const KEY = env.match(/^ELEVENLABS_API_KEY=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
const VOICE = "m3gJBS8OofDJfycyA2Ip";
const dur = {};
for (let i = 0; i < LINES.length; i++) {
  const [id, say] = LINES[i];
  const file = `tts/${id}.mp3`;
  if (!existsSync(file)) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": KEY, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: say, model_id: "eleven_multilingual_v2", language_code: "ko",
        previous_text: LINES[i - 1]?.[1], next_text: LINES[i + 1]?.[1],
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true, speed: 1.0 } }),
    });
    if (!res.ok) { console.error(id, res.status, (await res.text()).slice(0, 200)); process.exit(1); }
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  dur[id] = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]).toString().trim());
}
writeFileSync("durations.json", JSON.stringify(dur, null, 1));
console.log(Object.entries(dur).map(([k, v]) => `${k} ${v.toFixed(1)}`).join("  "));
console.log("합계", Object.values(dur).reduce((a, b) => a + b, 0).toFixed(1), "초");
