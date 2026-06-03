#!/usr/bin/env node
/**
 * SPIKE: pre-download model-fit & capability verification
 * ------------------------------------------------------------------
 * Goal: decide which models will (a) actually run on a given Mac and
 * (b) genuinely support a Notesage feature (FIM / tool-calling), WITHOUT
 * downloading any weights.
 *
 * Two layers:
 *   1. ENGINE  (this file, runs anywhere)   — memory fit + bandwidth-bound
 *      tok/s + capability gate. Constants adapted from Andyyyy64/whichllm's
 *      empirically-calibrated estimators (engine/vram.py, performance.py).
 *   2. METADATA — where the per-model facts come from:
 *        - fixture: real `size_bytes` from src-tauri/model-catalog.json +
 *          well-known params/context. Capability flags here are placeholders
 *          marked "[prod: read from GGUF header]".
 *        - live  (`--live`): HF API for sizes/params + a Range-GET read of the
 *          GGUF *header* (first few MB) for chat_template + FIM tokens.
 *          Implemented below in fetchGgufHeaderCapabilities(); needs network,
 *          which is blocked in the Claude sandbox (HF not in allowlist) but
 *          works on the user's machine.
 *
 * Nothing here downloads weights. The header read is a partial/Range request.
 */

// ----------------------------------------------------------------------------
// 1. ENGINE — constants (calibrated, à la whichllm)
// ----------------------------------------------------------------------------
const GB = 1e9;
const MB = 1e6;

// Memory estimate components
const KV_MB_PER_BPARAM_PER_KCTX = 3.5;   // MB per B-active-params per 1K ctx (FP16 KV)
const ACT_FLOOR_MB = 400;                // activation/scratch floor
const ACT_BYTES_PER_PARAM = 0.08;        // activation scaling
const ACT_MB_PER_4KCTX = 150;            // activation ctx scaling
const FRAMEWORK_OVERHEAD_MB = 500;       // llama.cpp allocations

// Apple unified memory: reserve for OS + Notesage editor itself.
const UNIFIED_USABLE_FRACTION = 0.75;
const TIGHT_CEILING_FRACTION = 0.90;     // above usable but below this = "tight"

// Speed: bandwidth-bound decode. tok/s = BW * quantEff * backend / readBytes
const QUANT_EFFICIENCY = {               // fraction of theoretical BW achieved
  Q4_K_M: 0.55, Q4_K_S: 0.55, Q5_K_M: 0.50, Q6_K: 0.48, Q8_0: 0.45, F16: 0.35, F32: 0.30,
};
const APPLE_BACKEND_FACTOR = 0.82;       // Metal kernel quality vs theoretical

// Planning context (what llama-server is launched with, NOT the model's max).
// Allocating full 128K KV is unrealistic; 8K is a sane chat default.
const PLANNING_CTX = 8192;

function estimateMemoryBytes(m) {
  const effectiveParamsB = m.activeParamsB ?? m.paramsB;       // MoE: active drives compute
  const kvParamsB = m.activeParamsB ? m.activeParamsB * 4.0 : m.paramsB;
  const weights = m.fileSizeBytes;                              // mmap'd weights ≈ file size
  const kv = KV_MB_PER_BPARAM_PER_KCTX * kvParamsB * (PLANNING_CTX / 1000) * MB;
  const act = (ACT_FLOOR_MB
    + ACT_BYTES_PER_PARAM * effectiveParamsB * GB / MB
    + ACT_MB_PER_4KCTX * (PLANNING_CTX / 4096)) * MB;
  const overhead = FRAMEWORK_OVERHEAD_MB * MB;
  return weights + kv + act + overhead;
}

function estimateTokPerSec(m, profile) {
  const quantEff = QUANT_EFFICIENCY[m.quant] ?? 0.50;
  // MoE: only active experts are read per token (with a kernel-bound floor).
  let readBytes = m.fileSizeBytes;
  if (m.activeParamsB && m.paramsB) {
    const ratio = m.activeParamsB / m.paramsB;
    const floor = Math.min(0.25, 0.05 * Math.max(1, profile.bandwidthGBs / 256));
    readBytes = m.fileSizeBytes * Math.max(ratio, floor);
  }
  const bw = profile.bandwidthGBs * GB;
  return (bw * quantEff * APPLE_BACKEND_FACTOR) / readBytes;
}

function classifyFit(estBytes, profile) {
  const total = profile.ramGB * GB;
  const usable = total * UNIFIED_USABLE_FRACTION;
  if (estBytes <= usable) return 'fits';
  if (estBytes <= total * TIGHT_CEILING_FRACTION) return 'tight';
  return 'wont-fit';
}

function classifySpeed(tps) {
  if (tps >= 10) return 'fast';
  if (tps >= 5) return 'ok';
  if (tps >= 2) return 'sluggish';
  return 'unusable';
}

/** Final per-slot verdict: does this model run AND have the required mechanism? */
function verdict(m, profile, slot) {
  const est = estimateMemoryBytes(m);
  const fit = classifyFit(est, profile);
  const tps = estimateTokPerSec(m, profile);
  const speed = classifySpeed(tps);
  const hasCap = slot === 'completion' ? m.cap.fim
    : slot === 'agent' ? m.cap.tools
    : true; // 'chat' needs neither specifically
  const runnable = (fit === 'fits' || fit === 'tight') && tps >= 2;
  const recommended = runnable && hasCap;
  return { estGB: est / GB, fit, tps, speed, hasCap, recommended };
}

// ----------------------------------------------------------------------------
// 2a. METADATA — fixture (real sizes from catalog; capability = [prod: header])
// ----------------------------------------------------------------------------
// fileSizeBytes values are the REAL size_bytes from src-tauri/model-catalog.json.
// paramsB / ctxTrain are well-known public facts for these exact models.
// cap.* are what the live header read would return; marked here for the spike.
const FIXTURE = [
  // id, repo, quant, fileSizeBytes(real), paramsB, [activeParamsB], cap
  { id:'qwen3-0.6b',        paramsB:0.6,  quant:'Q8_0',   fileSizeBytes:0.40*GB, cap:{fim:false, tools:true } },
  { id:'qwen2.5-coder-1.5b',paramsB:1.5,  quant:'Q8_0',   fileSizeBytes:1.65*GB, cap:{fim:true,  tools:false} },
  { id:'qwen2.5-coder-3b',  paramsB:3.0,  quant:'Q4_K_M', fileSizeBytes:2.01*GB, cap:{fim:true,  tools:false} },
  { id:'qwen2.5-coder-7b',  paramsB:7.0,  quant:'Q4_K_M', fileSizeBytes:4.68*GB, cap:{fim:true,  tools:false} },
  { id:'qwen3-4b',          paramsB:4.0,  quant:'Q4_K_M', fileSizeBytes:2.50*GB, cap:{fim:false, tools:true } },
  { id:'qwen3-8b',          paramsB:8.0,  quant:'Q4_K_M', fileSizeBytes:5.00*GB, cap:{fim:false, tools:true } },
  { id:'qwen3-14b',         paramsB:14.0, quant:'Q4_K_M', fileSizeBytes:8.50*GB, cap:{fim:false, tools:true } },
  { id:'llama-3.1-8b',      paramsB:8.0,  quant:'Q4_K_M', fileSizeBytes:4.92*GB, cap:{fim:false, tools:true } },
  { id:'deepseek-r1-14b',   paramsB:14.0, quant:'Q4_K_M', fileSizeBytes:8.50*GB, cap:{fim:false, tools:false} },
  // MoE: 26B total / ~4B active — big footprint but fast decode
  { id:'gemma-4-26B-A4B',   paramsB:26.0, activeParamsB:4.0, quant:'Q4_K_M', fileSizeBytes:16.8*GB, cap:{fim:false, tools:true } },
  // --- deliberately-too-big NON-catalog models, to show rejection ---
  { id:'llama-3.3-70b ⚠',   paramsB:70.0, quant:'Q4_K_M', fileSizeBytes:42.5*GB, cap:{fim:false, tools:true } },
  { id:'qwen2.5-72b ⚠',     paramsB:72.0, quant:'Q4_K_M', fileSizeBytes:47.0*GB, cap:{fim:false, tools:true } },
];

// ----------------------------------------------------------------------------
// 2b. METADATA — live HF path (the production no-download capability read)
// ----------------------------------------------------------------------------
const GGUF_VAL = { UINT8:0,INT8:1,UINT16:2,INT16:3,UINT32:4,INT32:5,FLOAT32:6,BOOL:7,STRING:8,ARRAY:9,UINT64:10,INT64:11,FLOAT64:12 };

/**
 * Read ONLY the GGUF metadata header via an HTTP Range request (first `windowMB`).
 * Extracts architecture, context_length, chat_template, and FIM token ids.
 * This is the proof that capability is knowable without downloading weights.
 */
async function fetchGgufHeaderCapabilities(resolveUrl, windowMB = 16) {
  const res = await fetch(resolveUrl, { headers: { Range: `bytes=0-${windowMB*MB-1}` } });
  if (!res.ok && res.status !== 206) throw new Error(`HF ${res.status} for ${resolveUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let off = 0;
  const u32 = () => { const v = buf.readUInt32LE(off); off += 4; return v; };
  const u64 = () => { const v = Number(buf.readBigUInt64LE(off)); off += 8; return v; };
  const str = () => { const n = u64(); const s = buf.toString('utf8', off, off+n); off += n; return s; };
  const skipVal = (t) => {
    switch (t) {
      case GGUF_VAL.UINT8: case GGUF_VAL.INT8: case GGUF_VAL.BOOL: off += 1; break;
      case GGUF_VAL.UINT16: case GGUF_VAL.INT16: off += 2; break;
      case GGUF_VAL.UINT32: case GGUF_VAL.INT32: case GGUF_VAL.FLOAT32: off += 4; break;
      case GGUF_VAL.UINT64: case GGUF_VAL.INT64: case GGUF_VAL.FLOAT64: off += 8; break;
      case GGUF_VAL.STRING: { const n = u64(); off += n; break; }
      case GGUF_VAL.ARRAY: { const et = u32(); const n = u64();
        for (let i=0;i<n;i++) { if (et===GGUF_VAL.STRING){const m=u64();off+=m;} else skipVal(et); } break; }
      default: throw new Error(`unknown gguf value type ${t}`);
    }
  };
  const readScalar = (t) => {
    switch (t) {
      case GGUF_VAL.UINT32: return u32();
      case GGUF_VAL.UINT64: return u64();
      case GGUF_VAL.STRING: return str();
      default: skipVal(t); return undefined;
    }
  };
  if (u32() !== 0x46554747) throw new Error('not a GGUF file'); // "GGUF" magic LE
  const version = u32(); u64(); /* tensor_count */ const kvCount = u64();
  const md = {};
  const want = new Set(['general.architecture','tokenizer.chat_template',
    'tokenizer.ggml.prefix_token_id','tokenizer.ggml.suffix_token_id','tokenizer.ggml.middle_token_id']);
  let arch;
  for (let i = 0; i < kvCount; i++) {
    if (off > buf.length - 16) { md._truncated = true; break; } // header window exceeded
    const key = str();
    const vtype = u32();
    if (want.has(key) || /\.context_length$/.test(key)) md[key] = readScalar(vtype);
    else skipVal(vtype);
    if (key === 'general.architecture') arch = md[key];
  }
  const ctx = arch ? md[`${arch}.context_length`] : undefined;
  const tmpl = md['tokenizer.chat_template'] || '';
  return {
    version, architecture: arch, contextLength: ctx,
    cap: {
      fim: md['tokenizer.ggml.prefix_token_id'] !== undefined
        && md['tokenizer.ggml.suffix_token_id'] !== undefined
        && md['tokenizer.ggml.middle_token_id'] !== undefined,
      tools: /tool_calls|tools|function/i.test(tmpl),
    },
    truncated: !!md._truncated,
  };
}

// ----------------------------------------------------------------------------
// 3. Hardware profiles (real Apple Silicon specs)
// ----------------------------------------------------------------------------
const PROFILES = [
  { name:'16GB Air (M-class)',   ramGB:16,  bandwidthGBs:100 },
  { name:'36GB Pro (M-Pro)',     ramGB:36,  bandwidthGBs:273 },
  { name:'64GB Pro (M-Max)',     ramGB:64,  bandwidthGBs:410 },
  { name:'128GB Studio (M-Ultra)',ramGB:128, bandwidthGBs:819 },
];

// ----------------------------------------------------------------------------
// 4. Run
// ----------------------------------------------------------------------------
function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

function printProfile(profile) {
  console.log(`\n━━━ ${profile.name}  —  ${profile.ramGB} GB unified, ~${profile.bandwidthGBs} GB/s ━━━`);
  console.log(`(planning ctx ${PLANNING_CTX}; usable mem ${(profile.ramGB*UNIFIED_USABLE_FRACTION).toFixed(0)} GB after OS+app reserve)`);
  console.log(pad('model',18), padL('file',7), padL('estRAM',7), pad(' fit',10), padL('tok/s',7), pad(' speed',10), pad('FIM',4), pad('tools',6));
  console.log('─'.repeat(78));
  for (const m of FIXTURE) {
    const v = verdict(m, profile, 'chat');
    const fitMark = v.fit === 'fits' ? '✓ fits' : v.fit === 'tight' ? '~ tight' : '✗ no';
    console.log(
      pad(m.id, 18),
      padL((m.fileSizeBytes/GB).toFixed(1), 7),
      padL(v.estGB.toFixed(1), 7),
      pad(' ' + fitMark, 10),
      padL(v.tps.toFixed(1), 7),
      pad(' ' + v.speed, 10),
      pad(m.cap.fim ? 'yes' : '–', 4),
      pad(m.cap.tools ? 'yes' : '–', 6),
    );
  }
  // Per-slot shortlists (runnable AND has the required mechanism)
  const completion = FIXTURE.filter(m => verdict(m, profile, 'completion').recommended).map(m=>m.id);
  const agent = FIXTURE.filter(m => verdict(m, profile, 'agent').recommended)
    .map(m=>({id:m.id,tps:verdict(m,profile,'agent').tps}))
    .sort((a,b)=>b.tps-a.tps).map(x=>x.id);
  console.log(`  → completion slot (needs FIM):   ${completion.join(', ') || '(none)'}`);
  console.log(`  → agent slot (needs tool-calling): ${agent.join(', ') || '(none)'}`);
}

async function main() {
  const live = process.argv.includes('--live');
  console.log('SPIKE: pre-download model fit + capability verification');
  console.log('Engine: real | Metadata: ' + (live ? 'LIVE HF (Range-GET header)' : 'fixture (real catalog sizes; cap = [prod reads GGUF header])'));

  if (live) {
    // Demonstrates the no-download capability read. Requires network (HF).
    const url = process.argv[process.argv.indexOf('--live')+1];
    if (!url) { console.error('usage: --live <gguf resolve URL>'); process.exit(1); }
    console.log(`\nReading GGUF header only (Range bytes=0-…) from:\n  ${url}`);
    const r = await fetchGgufHeaderCapabilities(url);
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  for (const p of PROFILES) printProfile(p);
  console.log('\nLegend: estRAM = weights+KV+activation+overhead. fit vs usable unified mem.');
  console.log('tok/s = bandwidth-bound decode estimate (Metal). ⚠ = non-catalog, included to show rejection.');
  console.log('\nProd capability read (no weights): node model-fit-spike.mjs --live \\');
  console.log('  https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf');
}

main().catch(e => { console.error(e); process.exit(1); });
