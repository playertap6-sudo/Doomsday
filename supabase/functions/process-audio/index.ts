// supabase/functions/process-audio/index.ts
// Receives finalized text phrase (Web Speech API mode) OR audio chunk (Groq Whisper fallback)
// Translates ONLY into languages currently selected by students in that lecture
// Inserts source-language caption FIRST so students see it immediately, then translations
// Deployed as: supabase functions deploy process-audio --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_API_KEY         = Deno.env.get('GROQ_API_KEY')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Language name → human-readable hint for LLM translation
const LANG_MAP: Record<string, string> = {
  English:   'English',
  Hindi:     'Hindi (Devanagari script)',
  Tamil:     'Tamil (Tamil script)',
  Malayalam: 'Malayalam (Malayalam script)',
  Kannada:   'Kannada (Kannada script)',
  Telugu:    'Telugu (Telugu script)',
};

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  const functionReceivedMs = Date.now();

  try {
    const body = await req.json();
    const {
      lecture_id,
      chunk_index,
      text,                  // direct text mode from Web Speech API
      source_language,       // source language (e.g. 'English')
      speech_final_ms,       // client timestamp when speech was finalized
      request_sent_ms,       // client timestamp when request was dispatched
      audio_base64,          // audio fallback mode
      mime_type,
      chunk_start_ms,        // audio buffer start timestamp
      chunk_upload_ms,       // audio upload timestamp
    } = body;

    if (!lecture_id) {
      return jsonError('Missing lecture_id', 400);
    }

    let sourceText = '';
    let sourceLang = source_language || 'English';
    let whisperDurationMs = 0;
    const mode = text ? 'web_speech' : 'whisper_fallback';

    if (text && typeof text === 'string') {
      // ── MODE A: Web Speech API (0ms audio upload, 0ms Whisper) ──────
      sourceText = text.trim();
    } else if (audio_base64) {
      // ── MODE B: Groq Whisper Fallback ──────────────────────────────
      const whisperStartMs = Date.now();
      const binary = atob(audio_base64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const effectiveMime = mime_type || 'audio/webm';
      const ext = effectiveMime.includes('mp4') ? 'mp4'
                : effectiveMime.includes('ogg') ? 'ogg'
                : 'webm';
      const audioBlob = new Blob([bytes], { type: effectiveMime });

      const formData = new FormData();
      formData.append('file', audioBlob, `chunk.${ext}`);
      formData.append('model', 'whisper-large-v3-turbo');

      const whisperLangMap: Record<string, string> = {
        English:   'en',
        Hindi:     'hi',
        Tamil:     'ta',
        Malayalam: 'ml',
        Kannada:   'kn',
        Telugu:    'te',
      };
      const whisperLang = whisperLangMap[sourceLang];
      if (whisperLang && sourceLang !== 'Auto') {
        formData.append('language', whisperLang);
      }
      // If 'Auto', omit language field so Whisper auto-detects!

      formData.append('response_format', 'json');

      const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: formData,
      });

      if (!whisperRes.ok) {
        const err = await whisperRes.text();
        console.error('[process-audio] Whisper error:', err);
        return jsonError('Whisper transcription failed', 500);
      }

      const { text: transcript } = await whisperRes.json() as { text: string };
      sourceText = (transcript || '').trim();
      whisperDurationMs = Date.now() - whisperStartMs;
    } else {
      return jsonError('Missing text or audio_base64 payload', 400);
    }

    // Skip empty speech
    if (!sourceText) {
      return jsonOk({
        ok: true,
        transcript: '',
        mode,
        timings: {
          speech_final_ms: speech_final_ms || chunk_start_ms || 0,
          request_sent_ms: request_sent_ms || chunk_upload_ms || 0,
          function_received_ms: functionReceivedMs,
          total_roundtrip_ms: Date.now() - functionReceivedMs,
        },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── 1 & 2. INSERT SOURCE-LANGUAGE CAPTION & QUERY ENROLLED LANGUAGES IN PARALLEL ──
    // Source INSERT fires concurrently but doesn't block translations.
    const srcInsertPromise = supabase.from('captions').insert({
      lecture_id,
      language: sourceLang,
      text: sourceText,
      chunk_index: chunk_index ?? 0,
    });

    const enrollRes = await supabase
      .from('lecture_students')
      .select('language')
      .eq('lecture_id', lecture_id);

    // Check source insert result (it ran concurrently with the enrollment query)
    const srcInsertRes = await srcInsertPromise;

    if (srcInsertRes.error) {
      console.error('[process-audio] Source caption insert error:', srcInsertRes.error);
      return jsonError('Failed to insert source caption', 500);
    }

    const sourceInsertedMs = Date.now();

    const studentLanguages = [...new Set(
      (enrollRes.data || []).map((e: { language: string }) => e.language),
    )] as string[];

    // ── 3. TRANSLATE ONLY INTO LANGUAGES CURRENTLY SELECTED BY STUDENTS ────
    const targetLanguages = studentLanguages.filter((l) => l !== sourceLang);
    const translations: Record<string, string> = {};

    if (targetLanguages.length > 0) {
      await Promise.all(
        targetLanguages.map(async (lang) => {
          const targetHint = LANG_MAP[lang] || lang;
          const translated = await translateWithGroq(sourceText, targetHint, sourceLang, GROQ_API_KEY);
          translations[lang] = translated;
        }),
      );
    }

    const translationDoneMs = Date.now();

    // ── 4. INSERT TRANSLATIONS ──────────────────────────────────────────────
    if (Object.keys(translations).length > 0) {
      const transRows = Object.entries(translations).map(([language, translatedText]) => ({
        lecture_id,
        language,
        text: translatedText,
        chunk_index: chunk_index ?? 0,
      }));

      const { error: transInsertErr } = await supabase.from('captions').insert(transRows);
      if (transInsertErr) {
        console.error('[process-audio] Translations insert error:', transInsertErr);
      }
    }

    const insertDoneMs = Date.now();

    return jsonOk({
      ok: true,
      transcript: sourceText,
      mode,
      source_language: sourceLang,
      student_languages: studentLanguages,
      translations_count: Object.keys(translations).length,
      timings: {
        speech_final_ms: speech_final_ms || chunk_start_ms || 0,
        request_sent_ms: request_sent_ms || chunk_upload_ms || 0,
        function_received_ms: functionReceivedMs,
        source_inserted_ms: sourceInsertedMs,
        translation_done_ms: translationDoneMs,
        insert_done_ms: insertDoneMs,
        client_to_edge_ms: functionReceivedMs - (request_sent_ms || chunk_upload_ms || functionReceivedMs),
        whisper_duration_ms: whisperDurationMs,
        source_insert_duration_ms: sourceInsertedMs - functionReceivedMs - whisperDurationMs,
        translation_duration_ms: translationDoneMs - sourceInsertedMs,
        translations_insert_duration_ms: insertDoneMs - translationDoneMs,
        edge_total_ms: insertDoneMs - functionReceivedMs,
      },
    });

  } catch (err) {
    console.error('[process-audio] Unhandled error:', err);
    return jsonError('Internal server error', 500);
  }
});

let cachedWorkingModel: string | null = null;

async function translateWithGroq(
  text: string,
  targetHint: string,
  sourceLang: string,
  apiKey: string
): Promise<string> {
  const models = cachedWorkingModel
    ? [cachedWorkingModel]
    : ['llama-3.1-8b-instant', 'openai/gpt-oss-20b'];

  for (const model of models) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          messages: [
            {
              role: 'system',
              content: `You are a translation engine. Translate the following ${sourceLang} text to ${targetHint}. Return ONLY the translated text. Do not add explanations, prefixes, or quotation marks.`,
            },
            { role: 'user', content: text },
          ],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content?.trim();
        if (content) {
          cachedWorkingModel = model;
          return content;
        }
      }
    } catch (err) {
      console.warn(`[process-audio] translateWithGroq ${model} error:`, err);
      // Continue to next model on failure
    }
  }

  // Graceful fallback to original text if all LLM models fail
  return text;
}

// ── Helpers ───────────────────────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
  };
}

function jsonOk(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function jsonError(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
