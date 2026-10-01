// supabase/functions/ask-assistant/index.ts
// AI Inquiry Assistant for live classroom lectures.
// Grounds answers in real-time lecture transcript/captions.
// Deployed as: supabase functions deploy ask-assistant --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_API_KEY         = Deno.env.get('GROQ_API_KEY')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const LANG_LABEL: Record<string, string> = {
  English:   'English',
  Hindi:     'Hindi (Devanagari script)',
  Tamil:     'Tamil (Tamil script)',
  Malayalam: 'Malayalam (Malayalam script)',
  Kannada:   'Kannada (Kannada script)',
  Telugu:    'Telugu (Telugu script)',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  try {
    const body = await req.json();
    const {
      lecture_id,
      question,
      language = 'English',
      recent_captions = [],
    } = body;

    if (!lecture_id) {
      return jsonError('Missing lecture_id', 400);
    }

    const trimmedQ = (question || '').trim();
    if (!trimmedQ) {
      return jsonError('Question cannot be empty', 400);
    }
    if (trimmedQ.length > 600) {
      return jsonError('Question is too long (maximum 600 characters)', 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── 1. Fetch Lecture Metadata ─────────────────────────────────────
    const { data: lectureData } = await supabase
      .from('lectures')
      .select('title, status')
      .eq('id', lecture_id)
      .maybeSingle();

    const lectureTitle = lectureData?.title || 'Live Classroom Lecture';

    // ── 2. Fetch All Captions for Lecture ──────────────────────────────
    const { data: captionRows, error: capErr } = await supabase
      .from('captions')
      .select('text, chunk_index, language')
      .eq('lecture_id', lecture_id)
      .order('chunk_index', { ascending: true })
      .limit(200);

    if (capErr) {
      console.error('[ask-assistant] Caption fetch error:', capErr);
    }

    // Build transcript preferencing English or student language or source
    const rows = captionRows || [];
    let transcriptText = '';

    if (rows.length > 0) {
      // Find source or English first
      let selectedRows = rows.filter((r) => r.language === 'English');
      if (selectedRows.length === 0) {
        selectedRows = rows.filter((r) => r.language === language);
      }
      if (selectedRows.length === 0) {
        selectedRows = rows;
      }

      // Deduplicate distinct chunks
      const seenChunks = new Set<number>();
      const phrases: string[] = [];
      for (const r of selectedRows) {
        if (!seenChunks.has(r.chunk_index)) {
          seenChunks.add(r.chunk_index);
          phrases.push(r.text);
        }
      }
      transcriptText = phrases.join(' ').trim();
    }

    // Append client recent_captions if provided and not already included
    if (Array.isArray(recent_captions) && recent_captions.length > 0) {
      const clientStr = recent_captions.filter(Boolean).join(' ');
      if (clientStr && !transcriptText.includes(clientStr)) {
        transcriptText = transcriptText ? `${transcriptText} ${clientStr}` : clientStr;
      }
    }

    const langLabel = LANG_LABEL[language] || language;

    // ── 3. Handle Empty Transcript Case ───────────────────────────────
    if (!transcriptText) {
      const emptyMsg = language === 'Hindi'
        ? 'वर्तमान व्याख्यान से अभी तक कोई प्रतिलेख (transcript) उपलब्ध नहीं है। कृपया शिक्षक द्वारा बोलना शुरू करने के बाद अपना प्रश्न पूछें।'
        : language === 'Tamil'
        ? 'தற்போதைய வகுப்பில் இருந்து இதுவரை எந்த உரைப்பகுதியும் கிடைக்கவில்லை. ஆசிரியர் பேசத் தொடங்கிய பிறகு உங்கள் கேள்வியைக் கேளுங்கள்.'
        : 'No lecture content has been transcribed yet for this session. Please ask your question once the teacher begins speaking.';

      return jsonOk({
        ok: true,
        answer: emptyMsg,
        grounded: false,
      });
    }

    // ── 4. Query Groq LLM Grounded on Live Lecture ─────────────────────
    const candidateModels = [
      'llama-3.1-8b-instant',
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b',
    ];

    const systemPrompt =
      `You are the dedicated AI Academic Inquiry Assistant for a live classroom lecture.\n` +
      `Your role is to answer student questions clearly, concisely, and factually, grounded in the real-time lecture transcript.\n\n` +
      `LECTURE TOPIC / TITLE: "${lectureTitle}"\n\n` +
      `CURRENT LECTURE TRANSCRIPT (Teacher's speech recorded so far):\n"""\n${transcriptText}\n"""\n\n` +
      `STUDENT'S REQUESTED LANGUAGE: ${langLabel}\n\n` +
      `CRITICAL INSTRUCTIONS:\n` +
      `1. GROUNDING IN LECTURE: If the student's question relates to concepts explained in the lecture transcript, answer it thoroughly and directly citing the lecture's explanation.\n` +
      `2. UNRELATED QUESTIONS: If the student asks something that was NOT covered or mentioned in the transcript at all, explicitly clarify that this topic was not covered in the teacher's lecture, but you may add a brief general academic explanation afterwards. Do NOT invent fake teacher statements.\n` +
      `3. LANGUAGE CONSISTENCY: Provide your entire answer in ${langLabel}.\n` +
      `4. MATHEMATICAL FORMULAS: Always use KaTeX/LaTeX formatting for equations: inline equations \\( ... \\) and block formulas \\[ ... \\]. Ensure formulas remain mathematically standard.\n` +
      `5. LENGTH & CONCISENESS: Keep answers focused, academically accurate, and easy for students to read on a mobile or laptop screen.`;

    let generatedAnswer = '';
    let lastError = '';

    for (const model of candidateModels) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: trimmedQ },
            ],
          }),
        });

        if (response.ok) {
          const data = await response.json();
          generatedAnswer = data.choices?.[0]?.message?.content?.trim() || '';
          if (generatedAnswer) break;
        } else {
          const errText = await response.text();
          lastError = `${model}: ${response.status} ${errText}`;
        }
      } catch (err: any) {
        lastError = `${model}: ${err?.message || String(err)}`;
      }
    }

    if (!generatedAnswer) {
      console.error('[ask-assistant] All models failed:', lastError);
      return jsonError('AI assistant is temporarily busy. Please try asking again in a moment.', 502);
    }

    return jsonOk({
      ok: true,
      answer: generatedAnswer,
      grounded: true,
    });
  } catch (err: any) {
    console.error('[ask-assistant] Unhandled error:', err);
    return jsonError(err?.message || 'Internal server error', 500);
  }
});

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
