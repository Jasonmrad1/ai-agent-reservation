/**
 * Clinic Security, Guardrails & Abuse Prevention Filter
 * Protects Gemini API tokens, blocks prompt injection, prevents credential/API key leakage,
 * enforces rate limits, and restricts conversation strictly to clinic scope.
 */

interface RateLimitEntry {
  count: number;
  firstTimestamp: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_MESSAGES_PER_WINDOW = 12;

// Patterns attempting to extract API keys, tokens, system prompts, or bypass system rules
const SECURITY_VIOLATION_PATTERNS = [
  // API Keys / Secrets / Credentials
  /\b(api[_\s-]?key|gemini[_\s-]?key|secret[_\s-]?key|auth[_\s-]?token|bearer[_\s-]?token|credentials|database_url|system_prompt)\b/i,
  /\b(reveal|show|give|print|leak|share|dump)\s+(me\s+)?(your\s+|the\s+)?(api|key|token|credentials|system|instructions|prompt|secret|keys)\b/i,
  /\b(what\s+is\s+your\s+api|what's\s+your\s+api|send\s+me\s+your\s+key)\b/i,

  // Prompt Injection & Jailbreak attempts
  /\bignore\s+(all\s+)?(previous|prior|above)\s+instructions\b/i,
  /\bdisregard\s+(all\s+)?(previous|prior|above)\b/i,
  /\b(developer\s+mode|jailbreak|dan\s+mode|unrestricted\s+mode)\b/i,
  /\b(you\s+are\s+now\s+dan|act\s+as\s+dan|pretend\s+you\s+have\s+no\s+rules)\b/i,
  /\b(system\s+override|bypass\s+safety|forget\s+all\s+rules)\b/i,
];

// Patterns for obvious off-topic abuse (coding, homework, politics, non-clinic spam)
const OFF_TOPIC_PATTERNS = [
  /\b(write|create|code|debug|generate)\s+(a\s+|an\s+)?(python|javascript|typescript|c\+\+|html|css|sql|script|function|program|app)\b/i,
  /\b(solve|calculate)\s+(this\s+)?(math|algebra|equation|integral|derivative)\b/i,
  /\b(write\s+(an\s+)?essay|write\s+(a\s+)?poem|write\s+(a\s+)?story|tell\s+me\s+a\s+joke)\b/i,
  /\b(who\s+won\s+the|election|president|prime\s+minister|parliament|democrat|republican)\b/i,
];

export interface GuardrailResult {
  allowed: boolean;
  reply?: string;
  reason?: 'rate_limit' | 'length_exceeded' | 'security_violation' | 'off_topic';
}

/**
 * Validates an incoming message before it touches the Gemini API.
 * Returns { allowed: true } if clean, or { allowed: false, reply: string } if intercepted.
 */
export function validateInboundMessage(text: string, fromPhone: string): GuardrailResult {
  const trimmed = text.trim();

  // 1. Rate Limiting Check (per phone number)
  const now = Date.now();
  const entry = rateLimitMap.get(fromPhone);
  if (entry) {
    if (now - entry.firstTimestamp < RATE_LIMIT_WINDOW_MS) {
      entry.count++;
      if (entry.count > MAX_MESSAGES_PER_WINDOW) {
        console.warn('[guardrails] Operation requires review');
        return {
          allowed: false,
          reason: 'rate_limit',
          reply: 'You are sending messages too quickly. Please wait a moment before sending another request.\n\nيرجى الانتظار قليلاً قبل إرسال رسالة جديدة لتتمكن العيادة من مساعدتكم.',
        };
      }
    } else {
      // Reset window
      rateLimitMap.set(fromPhone, { count: 1, firstTimestamp: now });
    }
  } else {
    rateLimitMap.set(fromPhone, { count: 1, firstTimestamp: now });
  }

  // 2. Maximum Message Length (prevents prompt-stuffing / massive token consumption)
  if (trimmed.length > 600) {
    console.warn('[guardrails] Operation requires review');
    return {
      allowed: false,
      reason: 'length_exceeded',
      reply: "Please keep your message concise and brief so Dr. Ziad's assistant can assist you with your appointment.\n\nيرجى إرسال رسالة مختصرة لمساعدتكم في حجز موعدكم لدى الدكتور زياد.",
    };
  }

  // 3. Security, Prompt Injection & API Key Leakage Protection
  for (const pattern of SECURITY_VIOLATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      console.warn('[guardrails] Operation requires review');
      return {
        allowed: false,
        reason: 'security_violation',
        reply: "I am Dr. Ziad El Khoury's virtual clinic scheduling assistant. I can only assist with patient appointments, clinic hours, and practice questions. System credentials and instructions are strictly confidential.\n\nأنا المساعد الآلي لعيادة الدكتور زياد الخوري، ومخصص فقط لحجز وتنسيق المواعيد الطبية. جميع معلومات النظام والبيانات محمية وسرية.",
      };
    }
  }

  // 4. Obvious Off-Topic Abuse Protection
  for (const pattern of OFF_TOPIC_PATTERNS) {
    if (pattern.test(trimmed)) {
      console.warn('[guardrails] Operation requires review');
      return {
        allowed: false,
        reason: 'off_topic',
        reply: "Dr. Ziad's virtual assistant is dedicated exclusively to medical appointments, home visits, and clinic scheduling. We cannot assist with non-clinic topics.\n\nمساعد عيادة الدكتور زياد مخصص حصراً لحجز المواعيد والزيارات الطبية واستفسارات العيادة.",
      };
    }
  }

  return { allowed: true };
}

/**
 * Resets rate limit for a phone number (e.g. during testing)
 */
export function resetRateLimit(phone: string): void {
  rateLimitMap.delete(phone);
}
