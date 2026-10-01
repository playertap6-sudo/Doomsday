// supabase/functions/generate-notes/index.ts
// Generates structured markdown study notes with KaTeX math notation
// Supports on-demand language generation with DB caching and duplicate prevention
// Deployed as: supabase functions deploy generate-notes --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_API_KEY         = Deno.env.get('GROQ_API_KEY')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Supported languages map
const LANG_LABEL: Record<string, string> = {
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

  try {
    const { lecture_id, language, force = false } = await req.json();

    if (!lecture_id) {
      return jsonError('Missing lecture_id', 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── 0. Fast DB Cache Check (On-Demand Single Language) ─────────────
    if (language && !force) {
      const { data: existingNote } = await supabase
        .from('notes')
        .select('id, lecture_id, language, content, created_at')
        .eq('lecture_id', lecture_id)
        .eq('language', language)
        .maybeSingle();

      if (existingNote && existingNote.content) {
        return jsonOk({
          ok: true,
          cached: true,
          notes: existingNote,
          language,
        });
      }
    }

    // ── 1. Fetch lecture metadata ────────────────────────────────────
    const { data: lectureData } = await supabase
      .from('lectures')
      .select('title')
      .eq('id', lecture_id)
      .single();

    const lectureTitle = lectureData?.title || 'Classroom Lecture';

    // ── 2. Build full transcript from caption chunks ──────────────────
    const { data: captionRows, error: captionErr } = await supabase
      .from('captions')
      .select('text, chunk_index, language')
      .eq('lecture_id', lecture_id)
      .order('chunk_index', { ascending: true });

    if (captionErr) {
      console.error('[generate-notes] Caption fetch error:', captionErr);
      return jsonError('Failed to fetch captions', 500);
    }

    if (!captionRows || captionRows.length === 0) {
      return jsonError('No captions found for this lecture', 404);
    }

    let selectedRows = captionRows.filter((r) => r.language === 'English');
    if (selectedRows.length === 0) {
      const firstLang = captionRows[0].language;
      selectedRows = captionRows.filter((r) => r.language === firstLang);
    }

    const transcript = selectedRows
      .map((r) => r.text)
      .join(' ')
      .trim();

    if (!transcript) {
      return jsonError('Captions transcript is empty', 400);
    }

    // ── 3. Resolve target language(s) ────────────────────────────────
    let languagesToGenerate: string[] = [];

    if (language) {
      // Explicit on-demand target requested
      languagesToGenerate = [language];
    } else {
      // Post-lecture batch: resolve unique student languages for this lecture
      const { data: enrollments, error: enrollErr } = await supabase
        .from('lecture_students')
        .select('language')
        .eq('lecture_id', lecture_id);

      if (enrollErr) {
        console.error('[generate-notes] Enrollment fetch error:', enrollErr);
        return jsonError('Failed to fetch student languages', 500);
      }

      const languages = [...new Set(
        (enrollments || []).map((e: { language: string }) => e.language),
      )] as string[];

      if (!languages.includes('English')) languages.unshift('English');

      if (!force) {
        const { data: existingNotes } = await supabase
          .from('notes')
          .select('language')
          .eq('lecture_id', lecture_id);

        const existingLangs = new Set((existingNotes || []).map((n: { language: string }) => n.language));
        languagesToGenerate = languages.filter((lang) => !existingLangs.has(lang));

        if (languagesToGenerate.length === 0 && existingNotes && existingNotes.length > 0) {
          return jsonOk({
            ok: true,
            cached: true,
            message: 'Notes already exist for all required languages',
            languages: [...existingLangs],
          });
        }
      } else {
        languagesToGenerate = languages;
      }
    }

    // ── 4. Generate notes in parallel for needed languages ─────────────
    const candidateModels = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'];

    const results = await Promise.all(
      languagesToGenerate.map(async (lang) => {
        const langLabel = LANG_LABEL[lang] || lang;

        const systemPrompt =
          `You are an expert academic study notes generator for students. Given the classroom transcript, ` +
          `generate concise, highly structured, and useful study notes in ${langLabel}.\n\n` +
          `MATHEMATICAL NOTATION GUIDELINES (CRITICAL FOR KATEX):\n` +
          `Whenever mathematical expressions, equations, formulas, variables, or notations appear in the lecture:\n` +
          `- For block equations on their own line, use standard LaTeX: \\[ ... \\]\n` +
          `- For inline mathematical variables and short expressions inside sentences, use: \\( ... \\)\n` +
          `- Accurately format mathematical notation such as exponents (\\(x^2\\)), subscripts (\\(x_1\\)), fractions (\\(\\frac{a}{b}\\)), square roots (\\(\\sqrt{x}\\)), summations (\\(\\sum\\)), integrals (\\(\\int\\)), Greek letters (\\(\\alpha, \\beta, \\theta, \\Delta\\)), matrices, inequalities, logarithms, and trigonometric expressions.\n` +
          `- LANGUAGE & FORMULA SEPARATION: Translate all textual explanations and descriptions accurately into ${langLabel}. However, KEEP ALL MATHEMATICAL FORMULAS AND EQUATIONS MATHEMATICALLY CORRECT, CLEAN, AND IN STANDARD LATEX NOTATION! Do not translate or alter mathematical formulas, operators, or variable names. Example in Malayalam:\n` +
          `  രണ്ട് വർഗങ്ങളുടെ വ്യത്യാസത്തിന്റെ സൂത്രവാക്യം:\n` +
          `  \\[ a^2 - b^2 = (a + b)(a - b) \\]\n\n` +
          `Format the notes in Markdown with these specific sections:\n` +
          `# ${lectureTitle}\n\n` +
          `## Short Summary\n` +
          `A clear 2-3 sentence overview of the lecture.\n\n` +
          `## Key Concepts & Formulas\n` +
          `Bullet points of core topics and principles covered, with LaTeX formulas where applicable.\n\n` +
          `## Important Points\n` +
          `Numbered list of essential takeaways, derivations, and details.\n\n` +
          `## Definitions & Terms\n` +
          `Key terminology defined clearly where relevant.\n\n` +
          `## Practical Examples & Applications\n` +
          `Concrete worked-out examples or real-world use-cases.\n\n` +
          `## Quick Revision Checklist\n` +
          `Fast bullet points for quick pre-exam review.\n\n` +
          `Keep the notes concise, clear, and easy for students to revise. Base the notes strictly on the transcript content.`;

        let content = '';
        let lastError = '';

        const modelErrors: Record<string, string> = {};
        for (const model of candidateModels) {
          try {
            const llmRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model,
                temperature: 0.3,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: `Lecture: "${lectureTitle}"\n\nTranscript:\n${transcript}` },
                ],
              }),
            });

            if (llmRes.ok) {
              const llmData = await llmRes.json();
              content = llmData.choices?.[0]?.message?.content?.trim() || '';
              if (content) break;
            } else {
              const errBody = await llmRes.text();
              modelErrors[model] = `${llmRes.status}: ${errBody}`;
              lastError = `${model} -> ${errBody}`;
              if (llmRes.status === 429) {
                await new Promise((r) => setTimeout(r, 2000));
              }
            }
          } catch (e: any) {
            modelErrors[model] = e?.message || String(e);
            lastError = `${model} -> ${modelErrors[model]}`;
          }
        }

        if (!content) {
          console.error(`[generate-notes] Generation failed for ${lang}:`, JSON.stringify(modelErrors));
          return { lang, content: null, error: JSON.stringify(modelErrors) };
        }

        return { lang, content, error: null };
      }),
    );

    // ── 5. Upsert notes rows into public.notes ─────────────────────────
    const notesRows = results
      .filter((r) => r.content !== null)
      .map((r) => ({
        lecture_id,
        language: r.lang,
        content: r.content,
      }));

    if (notesRows.length > 0) {
      const { error: upsertErr } = await supabase
        .from('notes')
        .upsert(notesRows, { onConflict: 'lecture_id,language' });

      if (upsertErr) {
        console.error('[generate-notes] Upsert error:', upsertErr);
        return jsonError('Failed to save notes to database', 500);
      }
    }

    // ── 6. Response ───────────────────────────────────────────────────
    if (language) {
      const generated = results.find((r) => r.lang === language);
      if (generated && generated.content) {
        return jsonOk({
          ok: true,
          cached: false,
          notes: {
            lecture_id,
            language,
            content: generated.content,
          },
        });
      } else {
        return jsonError(`Failed to generate notes in ${language}: ${generated?.error || 'Unknown error'}`, 500);
      }
    }

    const summary = results.map((r) => ({
      language: r.lang,
      ok: r.error === null,
    }));

    return jsonOk({ ok: true, languages: summary });
  } catch (err: any) {
    console.error('[generate-notes] Unhandled error:', err);
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
