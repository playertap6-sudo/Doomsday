// supabase/functions/generate-quiz/index.ts
// Generates 5-question MCQ quiz with KaTeX math notation
// Supports on-demand language generation with DB caching and duplicate prevention
// Deployed as: supabase functions deploy generate-quiz --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_API_KEY         = Deno.env.get('GROQ_API_KEY')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface QuizQuestion {
  question:    string;
  options:     string[]; // exactly 4 options
  answer:      number;   // 0-based index of correct option
  topic:       string;
  explanation: string;
}

interface QuizPayload {
  questions: QuizQuestion[];
}

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
      const { data: existingQuiz } = await supabase
        .from('quizzes')
        .select('id, lecture_id, language, questions, created_at')
        .eq('lecture_id', lecture_id)
        .eq('language', language)
        .maybeSingle();

      if (existingQuiz && Array.isArray(existingQuiz.questions) && existingQuiz.questions.length > 0) {
        return jsonOk({
          ok: true,
          cached: true,
          quiz: existingQuiz,
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
      console.error('[generate-quiz] Caption fetch error:', captionErr);
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
      // Explicit on-demand single language
      languagesToGenerate = [language];
    } else {
      // Post-lecture batch
      const { data: enrollments, error: enrollErr } = await supabase
        .from('lecture_students')
        .select('language')
        .eq('lecture_id', lecture_id);

      if (enrollErr) {
        console.error('[generate-quiz] Enrollment fetch error:', enrollErr);
        return jsonError('Failed to fetch student languages', 500);
      }

      const languages = [...new Set(
        (enrollments || []).map((e: { language: string }) => e.language),
      )] as string[];

      if (!languages.includes('English')) languages.unshift('English');

      if (!force) {
        const { data: existingQuizzes } = await supabase
          .from('quizzes')
          .select('language')
          .eq('lecture_id', lecture_id);

        const existingLangs = new Set((existingQuizzes || []).map((q: { language: string }) => q.language));
        languagesToGenerate = languages.filter((lang) => !existingLangs.has(lang));

        if (languagesToGenerate.length === 0 && existingQuizzes && existingQuizzes.length > 0) {
          return jsonOk({
            ok: true,
            cached: true,
            message: 'Quizzes already exist for all required languages',
            languages: [...existingLangs],
          });
        }
      } else {
        languagesToGenerate = languages;
      }
    }

    // ── 4. Generate quiz in parallel for needed languages ──────────────
    const candidateModels = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'];

    const results = await Promise.all(
      languagesToGenerate.map(async (lang) => {
        const langLabel = LANG_LABEL[lang] || lang;

        const systemPrompt =
          `You are an expert assessment generator that outputs strictly valid JSON. Given the classroom transcript from "${lectureTitle}", ` +
          `generate exactly 5 high-quality multiple-choice questions in ${langLabel} to test conceptual understanding and problem-solving.\n\n` +
          `MATHEMATICAL NOTATION GUIDELINES (CRITICAL FOR KATEX):\n` +
          `Whenever mathematical formulas, equations, variables, or expressions appear in questions, options, or explanations:\n` +
          `- Format inline variables and equations using LaTeX delimiters: \\( ... \\) (e.g. \\(x^2 = 25\\), \\(x = 5\\), \\(a^2 - b^2\\))\n` +
          `- Format block equations using: \\[ ... \\]\n` +
          `- Ensure all mathematical notation is preserved and clean even when the surrounding text explanation is in ${langLabel}.\n` +
          `- Example in Malayalam:\n` +
          `  Question: "\\(x^2 = 25\\) ആണെങ്കിൽ \\(x\\) ന്റെ മൂല്യം കണ്ടെത്തുക."\n` +
          `  Options: ["\\(x = 2\\)", "\\(x = 5\\)", "\\(x = 10\\)", "\\(x = 25\\)"]\n` +
          `  Explanation: "\\(5^2 = 25\\) ആയതിനാൽ \\(x = 5\\) ആണ് ശരിയായ ഉത്തരം."\n\n` +
          `Each question must have:\n` +
          `- question: Clear, well-formulated question\n` +
          `- options: Exactly 4 distinct plausible options as strings\n` +
          `- answer: The integer index (0, 1, 2, or 3) of the correct option\n` +
          `- topic: Concise topic name (e.g. "Difference of Squares", "Algebraic Identities")\n` +
          `- explanation: Educational explanation of why the answer is correct\n\n` +
          `CRITICAL: The "questions" array in the returned JSON MUST contain EXACTLY 5 questions.\n\n` +
          `Return ONLY a valid JSON object in this exact schema, without markdown formatting or commentary:\n` +
          `{"questions":[{"question":"...","options":["Option A","Option B","Option C","Option D"],"answer":0,"topic":"Topic Name","explanation":"Why this is correct"}, {"question":"...","options":["Option A","Option B","Option C","Option D"],"answer":1,"topic":"...","explanation":"..."}, {"question":"...","options":["Option A","Option B","Option C","Option D"],"answer":2,"topic":"...","explanation":"..."}, {"question":"...","options":["Option A","Option B","Option C","Option D"],"answer":0,"topic":"...","explanation":"..."}, {"question":"...","options":["Option A","Option B","Option C","Option D"],"answer":3,"topic":"...","explanation":"..."}]}`;

        let parsedQuiz: QuizPayload | null = null;
        let lastError = '';

        for (const model of candidateModels) {
          try {
            // Try with response_format first, fallback without if model rejects it
            let llmRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model,
                temperature: 0.2,
                max_tokens: 3000,
                response_format: { type: 'json_object' },
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: `Lecture: "${lectureTitle}"\n\nTranscript:\n${transcript}` },
                ],
              }),
            });

            if (!llmRes.ok) {
              const firstErr = await llmRes.text();
              // Try without response_format if json_object wasn't supported
              llmRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${GROQ_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model,
                  temperature: 0.2,
                  max_tokens: 3000,
                  messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Lecture: "${lectureTitle}"\n\nTranscript:\n${transcript}` },
                  ],
                }),
              });

              if (!llmRes.ok) {
                lastError = `${model} -> ${await llmRes.text()}`;
                if (llmRes.status === 429) {
                  await new Promise((r) => setTimeout(r, 2000));
                }
                continue;
              }
            }

            const llmData = await llmRes.json();
            const rawContent = llmData.choices?.[0]?.message?.content?.trim() || '';

            // Clean json
            let cleaned = rawContent;
            if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');

            try {
              parsedQuiz = JSON.parse(cleaned) as QuizPayload;
            } catch {
              const match = cleaned.match(/\{[\s\S]*\}/);
              if (match) {
                parsedQuiz = JSON.parse(match[0]) as QuizPayload;
              }
            }

            if (parsedQuiz && Array.isArray(parsedQuiz.questions) && parsedQuiz.questions.length > 0) {
              // Validate each question
              parsedQuiz.questions = parsedQuiz.questions.slice(0, 10).map((q, idx) => ({
                question: q.question || `Question ${idx + 1}`,
                options: (Array.isArray(q.options) && q.options.length >= 4)
                  ? q.options.slice(0, 4)
                  : ['Option A', 'Option B', 'Option C', 'Option D'],
                answer: (typeof q.answer === 'number' && q.answer >= 0 && q.answer <= 3) ? q.answer : 0,
                topic: q.topic || 'General Concepts',
                explanation: q.explanation || 'Refer to the lecture notes.',
              }));
              break;
            }
          } catch (e: any) {
            lastError = e?.message || String(e);
          }
        }

        if (!parsedQuiz || !parsedQuiz.questions || parsedQuiz.questions.length === 0) {
          console.error(`[generate-quiz] Generation failed for ${lang}:`, lastError);
          return { lang, quiz: null, error: lastError };
        }

        return { lang, quiz: parsedQuiz, error: null };
      }),
    );

    // ── 5. Upsert quiz rows into public.quizzes ───────────────────────
    const quizRows = results
      .filter((r) => r.quiz !== null)
      .map((r) => ({
        lecture_id,
        language: r.lang,
        questions: r.quiz!.questions,
      }));

    if (quizRows.length > 0) {
      const { error: upsertErr } = await supabase
        .from('quizzes')
        .upsert(quizRows, { onConflict: 'lecture_id,language' });

      if (upsertErr) {
        console.error('[generate-quiz] Upsert error:', upsertErr);
        return jsonError('Failed to save quiz to database', 500);
      }
    }

    // ── 6. Response ───────────────────────────────────────────────────
    if (language) {
      const generated = results.find((r) => r.lang === language);
      if (generated && generated.quiz) {
        // Fetch saved quiz id
        const { data: savedRow } = await supabase
          .from('quizzes')
          .select('id, lecture_id, language, questions')
          .eq('lecture_id', lecture_id)
          .eq('language', language)
          .maybeSingle();

        return jsonOk({
          ok: true,
          cached: false,
          quiz: savedRow || {
            lecture_id,
            language,
            questions: generated.quiz.questions,
          },
        });
      } else {
        return jsonError(`Failed to generate quiz in ${language}: ${generated?.error || 'Unknown error'}`, 500);
      }
    }

    const summary = results.map((r) => ({
      language: r.lang,
      ok: r.error === null,
    }));

    return jsonOk({ ok: true, languages: summary });
  } catch (err: any) {
    console.error('[generate-quiz] Unhandled error:', err);
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
