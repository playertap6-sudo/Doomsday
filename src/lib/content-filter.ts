/**
 * Content filter for live classroom captions.
 * Replaces abusive / profane words with [filtered] while preserving the rest of the sentence.
 * Strictly respects word boundaries to avoid false positives on educational words
 * (e.g. class, assignment, integrate, mass, asset, pass, etc.).
 */

const PROFANITY_PATTERNS: RegExp[] = [
  // Profanities and vulgarities
  /\b(fuck(?:ing|ed|er|s)?)\b/gi,
  /\b(shit(?:ty|ting|ted|s)?)\b/gi,
  /\b(bitch(?:es|ing)?)\b/gi,
  /\b(bastard(?:s)?)\b/gi,
  /\b(asshole(?:s)?|dumbass(?:es)?)\b/gi,
  /\b(ass|asses)\b/gi,
  /\b(crap|damn|dammit)\b/gi,
  /\b(cunt(?:s)?)\b/gi,
  /\b(dick(?:s)?|cock(?:s)?|pussy)\b/gi,
  /\b(slut(?:s)?|whore(?:s)?)\b/gi,

  // Abusive insults
  /\b(idiot(?:ic|s)?)\b/gi,
  /\b(moron(?:ic|s)?)\b/gi,
  /\b(stupid(?:ity)?)\b/gi,
  /\b(retard(?:ed|s)?)\b/gi,
  /\b(dumb(?:er|est)?)\b/gi,

  // Common abusive terms in Hindi/Hinglish
  /\b(chutiya|chutiye|harami|kamina|kamine|bhosdike|bhadwe|saala|saale|gandu|laude|lodu)\b/gi,
];

export function filterProfanity(text: string | null | undefined): string {
  if (!text) return "";
  let filtered = text;
  for (const pattern of PROFANITY_PATTERNS) {
    filtered = filtered.replace(pattern, "[filtered]");
  }
  return filtered;
}
