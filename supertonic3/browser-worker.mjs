// Only fixed model/runtime GETs leave this device. Book text stays in this worker.
import * as ort from './runtime/ort.wasm.min.mjs';
import {loadTextToSpeech, loadVoiceStyle, AVAILABLE_LANGS} from './upstream.mjs?v=2';
import {ASSETS, MODEL_REVISION} from './asset-list.mjs';

const CACHE = 'reader-supertonic3-' + MODEL_REVISION + '-ort1.24.3';
const originalFetch = globalThis.fetch.bind(globalThis);
const total = ASSETS.reduce((n,item) => n + item.bytes, 0);
let model, loading, generation = 0, queue = Promise.resolve(), controller;
let assetsReady = false;
const voices = new Map();
const cancelled = () => new DOMException('낭독 파일 저장 취소', 'AbortError');

async function cached(item) {
  const response = await (await caches.open(CACHE)).match(item.url);
  return response && Number(response.headers.get('X-Reader-Asset-Bytes')) === item.bytes ? response : null;
}
async function prepare(send) {
  if (loading) return loading;
  loading = (async () => {
    controller = new AbortController();
    const cache = await caches.open(CACHE);
    let done = 0;
    for (let index = 0; index < ASSETS.length; index++) {
      const item = ASSETS[index];
      if (controller.signal.aborted) throw cancelled();
      if (!await cached(item)) {
        const response = await originalFetch(item.url, {signal:controller.signal, mode:'cors'});
        if (!response.ok || !response.body) throw Error('낭독 파일 다운로드 실패 · HTTP ' + response.status);
        let bytes = 0;
        const stream = response.body.pipeThrough(new TransformStream({
          transform(chunk, output) {
            bytes += chunk.byteLength;
            send('progress', {loaded:done + bytes, total, file:index + 1, files:ASSETS.length});
            output.enqueue(chunk);
          },
          flush() { if (bytes !== item.bytes) throw Error('낭독 파일 크기가 다릅니다. 다시 저장해 주세요.'); }
        }));
        await cache.put(item.url, new Response(stream, {headers:{
          'Content-Type':item.url.endsWith('.json') ? 'application/json' : 'application/octet-stream',
          'X-Reader-Asset-Bytes':String(item.bytes)
        }}));
      }
      done += item.bytes;
      send('progress', {loaded:done, total, file:index + 1, files:ASSETS.length});
    }
    assetsReady = true;
    return {bytes:total, files:ASSETS.length};
  })();
  try { return await loading; } finally {loading = null;controller = null;}
}

// The upstream helper fetches configurations and models through this cache.
globalThis.fetch = async (input, options) => {
  const url = typeof input === 'string' ? input : input.url || String(input);
  const item = ASSETS.find(item => item.url === url);
  if (!item) throw Error('허용되지 않은 낭독 파일 요청');
  const response = await cached(item);
  if (!response) {
    assetsReady = false;
    throw Error('낭독 파일이 없습니다. 인터넷 연결 후 [낭독 파일 저장]을 눌러 주세요.');
  }
  return response;
};
ort.env.wasm.numThreads = 1; // Works without SharedArrayBuffer on mobile/GitHub Pages.
ort.env.wasm.wasmPaths = {mjs:new URL('./runtime/ort-wasm-simd-threaded.mjs', import.meta.url).href};

addEventListener('message', ({data:job}) => {
  if (job.action === 'cancel') {generation = job.generation;controller?.abort();return;}
  if (job.action === 'cancel-prepare') {controller?.abort();return;}
  if (job.action === 'synthesize') generation = job.generation;
  queue = queue.then(async () => {
    const send = (action, fields = {}, transfer = []) => {
      if (job.action !== 'synthesize' || job.generation === generation)
        postMessage({action, id:job.id, ...fields}, transfer);
    };
    try {
      if (job.action === 'check') {
        let bytes = 0;
        for (const item of ASSETS) if (await cached(item)) bytes += item.bytes;
        assetsReady = bytes === total;
        send('result',{result:{ready:assetsReady, bytes, total}});return;
      }
      if (job.action === 'prepare') {send('result',{result:await prepare(send)});return;}
      if (job.action !== 'synthesize' || job.generation !== generation) return;
      if (typeof job.text !== 'string' || !job.text.trim() || job.text.length > 300 ||
          !AVAILABLE_LANGS.includes(job.lang) || !/^[FM][1-5]$/.test(job.voice))
        throw Error('낭독 문장 또는 목소리를 확인해 주세요.');
      if (!assetsReady) await prepare(send);
      if (job.generation !== generation) return;
      if (!model) {
        send('model-progress',{message:'저장된 모델을 여는 중…'});
        const wasm = ASSETS.at(-1);
        ort.env.wasm.wasmBinary = new Uint8Array(await (await cached(wasm)).arrayBuffer());
        model = await loadTextToSpeech(ASSETS[0].url.replace(/\/[^/]+$/, ''),
          {executionProviders:['wasm'], enableCpuMemArena:false, enableMemPattern:false});
        // The initialized runtime owns its compiled module now.
        ort.env.wasm.wasmBinary = undefined;
      }
      if (job.generation !== generation) return;
      if (!voices.has(job.voice)) {
        const url = ASSETS.find(item => item.url.endsWith('/' + job.voice + '.json')).url;
        voices.set(job.voice, await loadVoiceStyle([url]));
      }
      const engine = model.textToSpeech;
      const started = performance.now();
      const {wav, duration} = await engine.call(job.text, job.lang, voices.get(job.voice), 4);
      const synthesisMs = performance.now() - started;
      const length = Math.min(wav.length, Math.floor(engine.sampleRate * duration[0]));
      const pcm = length === wav.length && wav.byteOffset === 0 && wav.byteLength === wav.buffer.byteLength
        ? wav : wav.slice(0, length);
      if (!pcm.length) throw Error('합성된 음성이 비어 있습니다.');
      send('audio',{samples:pcm.buffer, sampleRate:engine.sampleRate, synthesisMs},[pcm.buffer]);
    } catch (error) {
      send('error',{message:error.message || String(error)});
    }
  });
});
