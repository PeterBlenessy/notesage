use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

/// Metadata parsed from a GGUF file header.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct GgufMetadata {
    pub general_name: Option<String>,
    pub general_author: Option<String>,
    pub general_organization: Option<String>,
    pub general_license: Option<String>,
    pub general_size_label: Option<String>,
    pub general_quantized_by: Option<String>,
    pub general_file_type: Option<u32>,
    pub general_description: Option<String>,
    pub general_languages: Option<Vec<String>>,
    pub general_base_model_name: Option<String>,
    pub general_architecture: Option<String>,
    pub context_length: Option<u64>,
    pub block_count: Option<u64>,
    pub embedding_length: Option<u64>,
    /// True if all three FIM token IDs (prefix, suffix, middle) are present.
    pub supports_fim: Option<bool>,
}

// GGUF value types
const GGUF_TYPE_UINT8: u32 = 0;
const GGUF_TYPE_INT8: u32 = 1;
const GGUF_TYPE_UINT16: u32 = 2;
const GGUF_TYPE_INT16: u32 = 3;
const GGUF_TYPE_UINT32: u32 = 4;
const GGUF_TYPE_INT32: u32 = 5;
const GGUF_TYPE_FLOAT32: u32 = 6;
const GGUF_TYPE_BOOL: u32 = 7;
const GGUF_TYPE_STRING: u32 = 8;
const GGUF_TYPE_ARRAY: u32 = 9;
const GGUF_TYPE_UINT64: u32 = 10;
const GGUF_TYPE_INT64: u32 = 11;
const GGUF_TYPE_FLOAT64: u32 = 12;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum GgufValue {
    Uint8(u8),
    Int8(i8),
    Uint16(u16),
    Int16(i16),
    Uint32(u32),
    Int32(i32),
    Float32(f32),
    Bool(bool),
    String(String),
    Array(Vec<GgufValue>),
    Uint64(u64),
    Int64(i64),
    Float64(f64),
}

impl GgufValue {
    pub fn as_string(&self) -> Option<String> {
        match self {
            GgufValue::String(s) => Some(s.clone()),
            _ => None,
        }
    }

    pub fn as_u64(&self) -> Option<u64> {
        match self {
            GgufValue::Uint64(v) => Some(*v),
            GgufValue::Uint32(v) => Some(*v as u64),
            GgufValue::Uint16(v) => Some(*v as u64),
            GgufValue::Uint8(v) => Some(*v as u64),
            GgufValue::Int64(v) => Some(*v as u64),
            GgufValue::Int32(v) => Some(*v as u64),
            GgufValue::Int16(v) => Some(*v as u64),
            GgufValue::Int8(v) => Some(*v as u64),
            _ => None,
        }
    }

    pub fn as_u32(&self) -> Option<u32> {
        match self {
            GgufValue::Uint32(v) => Some(*v),
            GgufValue::Uint16(v) => Some(*v as u32),
            GgufValue::Uint8(v) => Some(*v as u32),
            GgufValue::Int32(v) => Some(*v as u32),
            _ => None,
        }
    }

    fn as_string_array(&self) -> Option<Vec<String>> {
        match self {
            GgufValue::Array(arr) => {
                let strings: Vec<String> = arr.iter().filter_map(|v| v.as_string()).collect();
                if strings.is_empty() { None } else { Some(strings) }
            }
            _ => None,
        }
    }
}

fn read_u8(r: &mut impl Read) -> Result<u8, String> {
    let mut buf = [0u8; 1];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    Ok(buf[0])
}

fn read_i8(r: &mut impl Read) -> Result<i8, String> {
    Ok(read_u8(r)? as i8)
}

fn read_u16(r: &mut impl Read) -> Result<u16, String> {
    let mut buf = [0u8; 2];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    Ok(u16::from_le_bytes(buf))
}

fn read_i16(r: &mut impl Read) -> Result<i16, String> {
    let mut buf = [0u8; 2];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    Ok(i16::from_le_bytes(buf))
}

fn read_u32(r: &mut impl Read) -> Result<u32, String> {
    let mut buf = [0u8; 4];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    Ok(u32::from_le_bytes(buf))
}

fn read_i32(r: &mut impl Read) -> Result<i32, String> {
    let mut buf = [0u8; 4];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    Ok(i32::from_le_bytes(buf))
}

fn read_f32(r: &mut impl Read) -> Result<f32, String> {
    let mut buf = [0u8; 4];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    Ok(f32::from_le_bytes(buf))
}

fn read_u64(r: &mut impl Read) -> Result<u64, String> {
    let mut buf = [0u8; 8];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    Ok(u64::from_le_bytes(buf))
}

fn read_i64(r: &mut impl Read) -> Result<i64, String> {
    let mut buf = [0u8; 8];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    Ok(i64::from_le_bytes(buf))
}

fn read_f64(r: &mut impl Read) -> Result<f64, String> {
    let mut buf = [0u8; 8];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    Ok(f64::from_le_bytes(buf))
}

fn read_gguf_string(r: &mut impl Read) -> Result<String, String> {
    let len = read_u64(r)? as usize;
    if len > 10_000_000 {
        return Err("String too long".to_string());
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    String::from_utf8(buf).map_err(|e| format!("Invalid UTF-8: {}", e))
}

/// Max GGUF array nesting depth. Legitimate GGUF metadata is flat (token lists)
/// or nests one level at most; a crafted custom model (custom-models.json lets
/// users point at arbitrary files) could otherwise nest arrays-of-arrays
/// without bound and stack-overflow the parser — an uncatchable abort (audit
/// rust M5). 16 is far above any real file.
const MAX_GGUF_ARRAY_DEPTH: u32 = 16;

fn read_gguf_value(r: &mut impl Read, vtype: u32, depth: u32) -> Result<GgufValue, String> {
    if depth > MAX_GGUF_ARRAY_DEPTH {
        return Err(format!("GGUF array nesting exceeds depth {}", MAX_GGUF_ARRAY_DEPTH));
    }
    match vtype {
        GGUF_TYPE_UINT8 => Ok(GgufValue::Uint8(read_u8(r)?)),
        GGUF_TYPE_INT8 => Ok(GgufValue::Int8(read_i8(r)?)),
        GGUF_TYPE_UINT16 => Ok(GgufValue::Uint16(read_u16(r)?)),
        GGUF_TYPE_INT16 => Ok(GgufValue::Int16(read_i16(r)?)),
        GGUF_TYPE_UINT32 => Ok(GgufValue::Uint32(read_u32(r)?)),
        GGUF_TYPE_INT32 => Ok(GgufValue::Int32(read_i32(r)?)),
        GGUF_TYPE_FLOAT32 => Ok(GgufValue::Float32(read_f32(r)?)),
        GGUF_TYPE_BOOL => Ok(GgufValue::Bool(read_u8(r)? != 0)),
        GGUF_TYPE_STRING => Ok(GgufValue::String(read_gguf_string(r)?)),
        GGUF_TYPE_ARRAY => {
            let elem_type = read_u32(r)?;
            let count = read_u64(r)? as usize;
            // Limit array size to avoid OOM
            if count > 1_000_000 {
                return Err("Array too large".to_string());
            }
            let mut items = Vec::with_capacity(count.min(1024));
            for _ in 0..count {
                items.push(read_gguf_value(r, elem_type, depth + 1)?);
            }
            Ok(GgufValue::Array(items))
        }
        GGUF_TYPE_UINT64 => Ok(GgufValue::Uint64(read_u64(r)?)),
        GGUF_TYPE_INT64 => Ok(GgufValue::Int64(read_i64(r)?)),
        GGUF_TYPE_FLOAT64 => Ok(GgufValue::Float64(read_f64(r)?)),
        _ => Err(format!("Unknown GGUF value type: {}", vtype)),
    }
}

/// Raw parsed GGUF metadata header: version + KV map. Shared entry point for
/// both the local-file metadata path and the remote header-capability reader.
pub struct GgufHeaderRaw {
    pub version: u32,
    pub kv: HashMap<String, GgufValue>,
    /// True when the reader ran out of bytes mid-parse (only possible in
    /// `tolerant` mode, e.g. a Range-limited remote header).
    pub truncated: bool,
}

/// Read the GGUF magic + version + KV metadata pairs from any reader.
///
/// When `tolerant` is true, a read error during the KV loop (e.g. the buffer
/// from a Range request ends mid-value) stops parsing and returns the partial
/// map with `truncated: true`, instead of erroring. The header itself (magic,
/// version, counts) must always be fully readable.
pub fn parse_gguf_kv(r: &mut impl Read, tolerant: bool) -> Result<GgufHeaderRaw, String> {
    let magic = read_u32(r)?;
    if magic != 0x46475547 {
        return Err(format!("Not a GGUF file (magic: 0x{:08X})", magic));
    }
    let version = read_u32(r)?;
    if version < 2 || version > 3 {
        return Err(format!("Unsupported GGUF version: {}", version));
    }
    let _tensor_count = read_u64(r)?;
    let metadata_kv_count = read_u64(r)?;
    if metadata_kv_count > 100_000 {
        return Err("Too many metadata KV pairs".to_string());
    }

    let mut kv: HashMap<String, GgufValue> = HashMap::new();
    let mut truncated = false;
    for _ in 0..metadata_kv_count {
        let key = match read_gguf_string(r) {
            Ok(k) => k,
            Err(_) if tolerant => {
                truncated = true;
                break;
            }
            Err(e) => return Err(e),
        };
        let vtype = match read_u32(r) {
            Ok(t) => t,
            Err(_) if tolerant => {
                truncated = true;
                break;
            }
            Err(e) => return Err(e),
        };
        let value = match read_gguf_value(r, vtype, 0) {
            Ok(v) => v,
            Err(_) if tolerant => {
                truncated = true;
                break;
            }
            Err(e) => return Err(e),
        };
        kv.insert(key, value);
    }

    Ok(GgufHeaderRaw {
        version,
        kv,
        truncated,
    })
}

/// Parse a GGUF file header and extract display-relevant metadata.
/// Only reads the metadata section — stops before tensor data.
pub fn parse_gguf_header(file_path: &Path) -> Result<GgufMetadata, String> {
    let mut file = std::fs::File::open(file_path)
        .map_err(|e| format!("Failed to open GGUF file: {}", e))?;

    let raw = parse_gguf_kv(&mut file, false)?;
    let kv_pairs = raw.kv;

    // Extract architecture first (needed to find arch-specific keys)
    let arch = kv_pairs.get("general.architecture")
        .and_then(|v| v.as_string());

    let mut meta = GgufMetadata::default();
    meta.general_architecture = arch.clone();

    // Extract values
    if let Some(v) = kv_pairs.get("general.name") {
        meta.general_name = v.as_string();
    }
    if let Some(v) = kv_pairs.get("general.author") {
        meta.general_author = v.as_string();
    }
    if let Some(v) = kv_pairs.get("general.organization") {
        meta.general_organization = v.as_string();
    }
    if let Some(v) = kv_pairs.get("general.license") {
        meta.general_license = v.as_string();
    }
    if let Some(v) = kv_pairs.get("general.size_label") {
        meta.general_size_label = v.as_string();
    }
    if let Some(v) = kv_pairs.get("general.quantized_by") {
        meta.general_quantized_by = v.as_string();
    }
    if let Some(v) = kv_pairs.get("general.file_type") {
        meta.general_file_type = v.as_u32();
    }
    if let Some(v) = kv_pairs.get("general.description") {
        meta.general_description = v.as_string();
    }
    if let Some(v) = kv_pairs.get("general.languages") {
        meta.general_languages = v.as_string_array();
    }
    if let Some(v) = kv_pairs.get("general.base_model.0.name") {
        meta.general_base_model_name = v.as_string();
    }

    // Architecture-specific keys
    if let Some(ref a) = arch {
        let ctx_key = format!("{}.context_length", a);
        if let Some(v) = kv_pairs.get(&ctx_key) {
            meta.context_length = v.as_u64();
        }

        let block_key = format!("{}.block_count", a);
        if let Some(v) = kv_pairs.get(&block_key) {
            meta.block_count = v.as_u64();
        }

        let embd_key = format!("{}.embedding_length", a);
        if let Some(v) = kv_pairs.get(&embd_key) {
            meta.embedding_length = v.as_u64();
        }
    }

    // FIM detection: all three FIM token IDs must be present
    let has_prefix = kv_pairs.get("tokenizer.ggml.prefix_token_id").and_then(|v| v.as_u32()).is_some();
    let has_suffix = kv_pairs.get("tokenizer.ggml.suffix_token_id").and_then(|v| v.as_u32()).is_some();
    let has_middle = kv_pairs.get("tokenizer.ggml.middle_token_id").and_then(|v| v.as_u32()).is_some();
    if has_prefix && has_suffix && has_middle {
        meta.supports_fim = Some(true);
    }

    Ok(meta)
}

/// Map GGUF file type enum to human-readable quantization string.
pub fn file_type_to_quantization(file_type: u32) -> Option<&'static str> {
    match file_type {
        0 => Some("F32"),
        1 => Some("F16"),
        2 => Some("Q4_0"),
        3 => Some("Q4_1"),
        7 => Some("Q8_0"),
        8 => Some("Q5_0"),
        9 => Some("Q5_1"),
        10 => Some("Q2_K"),
        11 => Some("Q3_K_S"),
        12 => Some("Q3_K_M"),
        13 => Some("Q3_K_L"),
        14 => Some("Q4_K_S"),
        15 => Some("Q4_K_M"),
        16 => Some("Q5_K_S"),
        17 => Some("Q5_K_M"),
        18 => Some("Q6_K"),
        19 => Some("IQ2_XXS"),
        20 => Some("IQ2_XS"),
        21 => Some("IQ3_XXS"),
        22 => Some("IQ1_S"),
        23 => Some("IQ4_NL"),
        24 => Some("IQ3_S"),
        25 => Some("IQ2_S"),
        26 => Some("IQ4_XS"),
        27 => Some("IQ1_M"),
        28 => Some("BF16"),
        _ => None,
    }
}
