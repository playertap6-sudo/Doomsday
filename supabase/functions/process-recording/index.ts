// supabase/functions/process-recording/index.ts
// Transcribes uploaded recorded lecture via Groq Whisper → stores captions → triggers multilingual Notes & Quiz
// Deployed as: supabase functions deploy process-recording --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_API_KEY         = Deno.env.get('GROQ_API_KEY')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const LANG_MAP: Record<string, string> = {
  English:   'English',
  Hindi:     'Hindi (Devanagari script)',
  Tamil:     'Tamil (Tamil script)',
  Malayalam: 'Malayalam (Malayalam script)',
  Kannada:   'Kannada (Kannada script)',
  Telugu:    'Telugu (Telugu script)',
};

const WHISPER_LANG_CODES: Record<string, string> = {
  English:   'en',
  Hindi:     'hi',
  Tamil:     'ta',
  Malayalam: 'ml',
  Kannada:   'kn',
  Telugu:    'te',
};

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  try {
    const { lecture_id, storage_path, source_language } = await req.json();

    if (!lecture_id || !storage_path) {
      return jsonError('Missing lecture_id or storage_path', 400);
    }

    const isAuto = !source_language || source_language.toLowerCase() === 'auto';
    const sourceLang = isAuto ? 'Auto' : source_language;
    const supabase   = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── 1. Download file from private Supabase Storage ─────────────────
    console.log(`[process-recording] Downloading ${storage_path}...`);
    const { data: fileBlob, error: downloadErr } = await supabase.storage
      .from('lecture-recordings')
      .download(storage_path);

    if (downloadErr || !fileBlob) {
      console.error('[process-recording] Download error:', downloadErr);
      return jsonError(`Failed to download recording from storage: ${downloadErr?.message || 'Empty file'}`, 500);
    }

    const fileName = storage_path.split('/').pop() || 'recording.mp4';
    console.log(`[process-recording] File downloaded successfully. Size: ${fileBlob.size} bytes. Transcribing...`);

    // ── 2. Send to Groq Whisper ───────────────────────────────────────
    const formData = new FormData();
    formData.append('file', fileBlob, fileName);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'verbose_json');

    const whisperCode = WHISPER_LANG_CODES[sourceLang];
    if (whisperCode && sourceLang !== 'Auto') {
      formData.append('language', whisperCode);
    }

    const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body: formData,
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      console.error('[process-recording] Whisper API error:', errText);
      return jsonError(`Transcription failed: ${errText}`, 500);
    }

    const whisperData = await whisperRes.json();
    const fullTranscript = (whisperData.text || '').trim();

    if (!fullTranscript) {
      return jsonError('No speech was detected in the uploaded recording', 400);
    }

    console.log(`[process-recording] Transcription succeeded. Length: ${fullTranscript.length} chars.`);

    // ── 3. Parse segments and insert into captions table ──────────────
    interface WhisperSegment {
      id: number;
      start: number;
      end: number;
      text: string;
    }

    const segments: { chunk_index: number; text: string }[] = [];

    if (Array.isArray(whisperData.segments) && whisperData.segments.length > 0) {
      whisperData.segments.forEach((seg: WhisperSegment, idx: number) => {
        const txt = (seg.text || '').trim();
        if (txt) {
          segments.push({ chunk_index: idx + 1, text: txt });
        }
      });
    }

    // Fallback if segments array is empty
    if (segments.length === 0) {
      const sentences = fullTranscript.match(/[^.!?]+[.!?]+/g) || [fullTranscript];
      sentences.forEach((s: string, idx: number) => {
        const txt = s.trim();
        if (txt) segments.push({ chunk_index: idx + 1, text: txt });
      });
    }

    // Insert source captions
    const sourceRows = segments.map((s) => ({
      lecture_id,
      language: sourceLang === 'Auto' ? 'English' : sourceLang,
      text: s.text,
      chunk_index: s.chunk_index,
    }));

    // Clear any prior captions for this lecture to prevent duplicates on retry
    await supabase.from('captions').delete().eq('lecture_id', lecture_id);

    const { error: insertErr } = await supabase.from('captions').insert(sourceRows);
    if (insertErr) {
      console.error('[process-recording] Captions insert error:', insertErr);
      return jsonError('Failed to insert source captions', 500);
    }

    // ── 4. Translate captions for students ─────────────────────────────
    // If source is not English, generate English translation.
    // If source is English, generate Hindi and Tamil translations so multilingual students can learn immediately.
    const effectiveSource = sourceLang === 'Auto' ? 'English' : sourceLang;
    const targetLanguages: string[] = [];

    if (effectiveSource !== 'English') {
      targetLanguages.push('English');
    } else {
      targetLanguages.push('Hindi', 'Tamil');
    }

    // Also include any languages of already-enrolled students
    const { data: enrollments } = await supabase
      .from('lecture_students')
      .select('language')
      .eq('lecture_id', lecture_id);

    if (enrollments) {
      enrollments.forEach((e: { language: string }) => {
        if (e.language && e.language !== effectiveSource && !targetLanguages.includes(e.language)) {
          targetLanguages.push(e.language);
        }
      });
    }

    console.log(`[process-recording] Translating into target languages: ${targetLanguages.join(', ')}...`);

    for (const targetLang of targetLanguages) {
      try {
        const targetHint = LANG_MAP[targetLang] || targetLang;
        const candidateModels = ['openai/gpt-oss-20b', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];

        const translatedSegments = await Promise.all(
          segments.map(async (seg) => {
            let translatedText = seg.text;
            for (const model of candidateModels) {
              try {
                const trRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    model,
                    temperature: 0.1,
                    messages: [
                      {
                        role: 'system',
                        content: `Translate the following text to ${targetHint}. Return ONLY the translation with no explanations or quotes.`,
                      },
                      { role: 'user', content: seg.text },
                    ],
                  }),
                });

                if (trRes.ok) {
                  const trData = await trRes.json();
                  const c = trData.choices?.[0]?.message?.content?.trim();
                  if (c) {
                    translatedText = c;
                    break;
                  }
                }
              } catch (_) {}
            }
            return {
              lecture_id,
              language: targetLang,
              text: translatedText,
              chunk_index: seg.chunk_index,
            };
          }),
        );

        if (translatedSegments.length > 0) {
          await supabase.from('captions').insert(translatedSegments);
        }
      } catch (trErr) {
        console.warn(`[process-recording] Translation warning for ${targetLang}:`, trErr);
      }
    }

    // ── 5. Trigger existing generate-notes and generate-quiz ───────────
    console.log('[process-recording] Triggering Notes & Quiz generation...');
    const [notesRes, quizRes] = await Promise.allSettled([
      fetch(`${SUPABASE_URL}/functions/v1/generate-notes`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ lecture_id, force: true }),
      }).then(r => r.json()),

      fetch(`${SUPABASE_URL}/functions/v1/generate-quiz`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ lecture_id, force: true }),
      }).then(r => r.json()),
    ]);

    const notesOk = notesRes.status === 'fulfilled' && notesRes.value?.ok;
    const quizOk  = quizRes.status === 'fulfilled' && quizRes.value?.ok;

    console.log(`[process-recording] Notes Ready: ${notesOk} | Quiz Ready: ${quizOk}`);

    return jsonOk({
      ok: true,
      transcript: fullTranscript,
      segments_count: segments.length,
      notes_ready: !!notesOk,
      quiz_ready: !!quizOk,
      target_languages: targetLanguages,
    });
  } catch (err: any) {
    console.error('[process-recording] Unhandled error:', err);
    return jsonError(err?.message || 'Internal server error', 500);
  }
});

// ── Helpers ─────────────────────────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
