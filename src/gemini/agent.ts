import { GoogleGenerativeAI } from '@google/generative-ai';
import { Customer, Conversation, Appointment, VisitType } from '../types/index.js';
import { DatabaseContext } from '../db/index.js';
import { SchedulingEngine } from '../calendar/scheduler.js';
import { AdminNotificationService } from '../notifications/admin.notifier.js';
import { AGENT_TOOLS, CLINIC_SERVICES, CLINIC_POLICIES } from './tools.js';
import { SYSTEM_PROMPT, DOCTOR_ASSISTANT_SYSTEM_PROMPT } from './prompts.js';
import { withRetry } from '../utils/retry.js';

export interface ToolCall {
  name: string;
  args: Record<string, any>;
}

export interface AgentResponse {
  replyText: string;
  toolExecuted?: string;
  toolResult?: any;
}

export interface GeminiClient {
  generateResponse(params: {
    systemPrompt: string;
    conversationHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text?: string }> }>;
    incomingMessage: string;
    tools: any[];
  }): Promise<{
    text?: string;
    toolCalls?: ToolCall[];
  }>;

  generateReplyFromToolResult(params: {
    systemPrompt: string;
    userQuery: string;
    toolName: string;
    toolArgs: any;
    toolResult: any;
  }): Promise<string>;

  getFallbackToolReply(params: {
    toolName: string;
    toolArgs: any;
    toolResult: any;
    userQuery?: string;
  }): string;

  generateRescheduleOutreach(params: {
    customerName: string;
    appointment: {
      service: string;
      start_time: string;
      visit_type: string;
      address?: string | null;
    };
    doctorPrompt?: string;
    proposedDate?: string;
    proposedTime?: string;
    suggestedSlots?: string[];
    language?: string;
  }): Promise<string>;
}

const FALLBACK_MODEL_POOL = [
  process.env.GEMINI_MODEL || 'gemini-flash-latest',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-flash-latest',
];

export function detectLanguage(text: string = ''): 'english' | 'arabizi' | 'arabic' | 'french' {
  if (!text) return 'english';
  if (/[\u0600-\u06FF]/.test(text)) {
    return 'arabic';
  }
  const lower = text.toLowerCase();
  
  if (
    /\b(bonjour|bonsoir|rendez-vous|rendezvous|demain|salut|semaine|merci|svp|s'il vous plaît|sil vous plait|s'il vous plait|je voudrais|prendre un rendez-vous|au cabinet|à domicile)\b/i.test(lower) &&
    !/\b(bde|badde|baddi|fadi|fadiyeen|nhar|3iyade|kermel|dahre|ahla|marhaba)\b/i.test(lower)
  ) {
    return 'french';
  }

  // Genuine Lebanese Arabizi vocabulary and Franco-Arabe phonetic markers (avoiding English numbers like 2pm, 3pm, 2 hours)
  const arabiziPattern = /\b(ahla|marhaba|bde|badde|baddi|fadi|fadiyeen|fadeen|nhar|3iyade|kermel|dahre|waja3|hakim|7akim|shou|shu|kif|bkra|mabsout|salemeh|tekram|hala|wen|lesh|eza|jem3a|tnen|tanen|taleta|tleta|arba3a|khamis|sabit|ahad|se3a|3asheeye|suboh|nzabbitlak|zabbattelak|byenasbak|btnesbak|bil 3iyade|zyara 3al beit|taba3|taba3ak|taba3ik|7ajez|mawa3eed|ghil|ilgha|elghe|laghe|ajjel|ma baddi|ma bde|halla2|khalas|3am|3ala|minchan|kermelo|fik|fiki|fikon)\b/i;
  
  // Specific Arabizi numeral letter words (e.g. 3iyade, 7aleh, 2awi, 2derna, etc.)
  const arabiziNumWords = /\b([a-z]+[23578][a-z]+|[23578][a-z]{2,}|[a-z]{2,}[23578])\b/i;

  if (arabiziPattern.test(lower) || (arabiziNumWords.test(lower) && !/\b(2pm|3pm|4pm|5pm|6pm|7pm|8pm|9pm|10pm|11pm|12pm|2am|3am|4am|5am|6am|7am|8am|9am|10am|11am|12am|2nd|3rd|7th|8th|2x|3x|mp3|mp4|h2o)\b/i.test(lower))) {
    return 'arabizi';
  }

  return 'english';
}

export function formatEnglishDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
    const day = d.getUTCDate();
    const hours = d.getUTCHours();
    const mins = d.getUTCMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 === 0 ? 12 : hours % 12;
    return `${weekday}, ${month} ${day} at ${h12}:${mins} ${ampm}`;
  } catch {
    return isoStr;
  }
}

export function formatLebDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const days = ['Ahad', 'Tnen', 'Taleta', 'Arba3a', 'Khamis', 'Jem3a', 'Sabit'];
    const months = ['Kanoun Tene', 'Shbat', 'Adar', 'Naysan', 'Ayyar', 'Hzayran', 'Tamouz', 'Aab', 'Ayloul', 'Teshreen Awwal', 'Teshreen Tene', 'Kanoun Awwal'];
    const dayName = days[d.getUTCDay()];
    const monthName = months[d.getUTCMonth()];
    const hours = d.getUTCHours();
    const mins = d.getUTCMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 === 0 ? 12 : hours % 12;
    return `nhar l ${dayName} (${d.getUTCDate()} ${monthName}) se3a ${h12}:${mins} ${ampm}`;
  } catch {
    return isoStr;
  }
}

export class LiveGeminiClient implements GeminiClient {
  private genAI: GoogleGenerativeAI;
  private modelPool: string[];

  constructor(apiKey: string, modelName?: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    const primary = modelName || process.env.GEMINI_MODEL || 'gemini-flash-latest';
    this.modelPool = Array.from(new Set([primary, ...FALLBACK_MODEL_POOL]));
  }

  public async generateResponse(params: {
    systemPrompt: string;
    conversationHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text?: string }> }>;
    incomingMessage: string;
    tools: any[];
  }): Promise<{ text?: string; toolCalls?: ToolCall[] }> {
    let lastError: any = null;

    for (const modelName of this.modelPool) {
      try {
        const model = this.genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: params.systemPrompt,
          tools: [{ functionDeclarations: params.tools as any }],
        });

        const chat = model.startChat({
          history: params.conversationHistory as any,
        });

        const result = await chat.sendMessage(params.incomingMessage);
        const response = result.response;
        const functionCalls = response.functionCalls();

        if (functionCalls && functionCalls.length > 0) {
          return {
            toolCalls: functionCalls.map((fc) => ({
              name: fc.name,
              args: fc.args as Record<string, any>,
            })),
          };
        }

        const rawText = response.text ? response.text().trim() : '';

        // Fallback: check if text response is a JSON-formatted tool invocation
        const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, rawText];
        try {
          const parsed = JSON.parse(jsonMatch[1] || rawText);
          if (parsed && parsed.name && (parsed.arguments || parsed.args)) {
            return {
              toolCalls: [{
                name: parsed.name,
                args: parsed.arguments || parsed.args || {},
              }],
            };
          }
        } catch {
          // Not JSON tool call, normal conversational reply
        }

        return {
          text: rawText,
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`[Agent] ⚠️ Model ${modelName} encountered error (${err?.status || err?.message}), failing over to next model in pool...`);
      }
    }

    // Heuristic intent classification if all external LLM models fail or are rate-limited
    console.warn('[Agent] ⚠️ All Gemini models throttled, falling back to local heuristic classifier.');
    const lower = params.incomingMessage.toLowerCase();
    const lang = detectLanguage(params.incomingMessage);
    
    if (lower.includes('ghil') || lower.includes('cancel') || lower.includes('ilgha') || lower.includes('elghe') || lower.includes('laghe') || lower.includes('ma baddi')) {
      return {
        toolCalls: [{
          name: 'cancel_appointment',
          args: { reason: 'Patient requested cancellation' },
        }],
      };
    }

    if (lower.includes('fade') || lower.includes('fadi') || lower.includes('mawa3eed') || lower.includes('slots') || lower.includes('available') || lower.includes('aymta') || lower.includes('free')) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isHome = lower.includes('beit') || lower.includes('home') || lower.includes('zyara');
      return {
        toolCalls: [{
          name: 'check_availability',
          args: {
            date: tomorrow.toISOString().split('T')[0],
            visit_type: isHome ? 'home_visit' : 'in_office',
          },
        }],
      };
    }

    if (lower.includes('reschedule') || lower.includes('ajjel') || lower.includes('move') || lower.includes('ghayer')) {
      return {
        toolCalls: [{
          name: 'reschedule_appointment',
          args: {
            new_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
            new_time: '11:00',
          },
        }],
      };
    }

    if (
      lower.includes('chest pain') ||
      lower.includes('waja3 bi sadre') ||
      lower.includes('waja3 seder') ||
      lower.includes('shortness of breath') ||
      lower.includes('dii2et nafas') ||
      lower.includes('di2et nafas') ||
      lower.includes('emergency') ||
      lower.includes('tari2a') ||
      lower.includes('bleeding heavily')
    ) {
      return {
        toolCalls: [{
          name: 'escalate_to_human',
          args: { reason: 'Emergency triage: acute medical symptoms reported', urgency: 'high' },
        }],
      };
    }

    if (
      lower.includes('number') ||
      lower.includes('phone') ||
      lower.includes('ra2em') ||
      lower.includes('mobile') ||
      lower.includes('numéro') ||
      lower.includes('numero') ||
      lower.includes('call') ||
      lower.includes('d2el') ||
      lower.includes('direct')
    ) {
      if (lower.includes('doctor') || lower.includes('hakim') || lower.includes('7akim') || lower.includes('ziad') || lower.includes('personal') || lower.includes('kallim') || lower.includes('e7ke') || lower.includes('speak')) {
        return {
          toolCalls: [{
            name: 'escalate_to_human',
            args: { reason: 'Patient requested doctor direct contact / phone number', urgency: 'medium' },
          }],
        };
      }
    }

    if (lower.includes('human') || lower.includes('doctor') || lower.includes('hakim') || lower.includes('7akim') || lower.includes('person') || lower.includes('speak with staff')) {
      return {
        toolCalls: [{
          name: 'escalate_to_human',
          args: { reason: 'Patient requested to speak with doctor or staff', urgency: 'medium' },
        }],
      };
    }

    if (lower.includes('[voice_note]') || lower.includes('voice note') || lower.includes('audio note')) {
      if (lang === 'arabizi') {
        return {
          text: "Ahla fik! L assistant taba3 l 3iyade byeste2bel messages ktebe 💬. Rja2 b3at talabak aw l wa2et l byenasbak ktebe, aw ektob 'hakim' kermel Dr. Ziad aw l team yetwasalo ma3ak direct!",
        };
      }
      return {
        text: "Thank you for reaching out! Our clinic scheduling assistant currently processes written messages 💬. Please type your appointment request or question here (or type 'human' if you would like Dr. Ziad / clinic staff to contact you directly), and we'll take care of it right away!",
      };
    }

    if (lang === 'english') {
      return {
        text: "Hello! Welcome to Dr. Ziad El Khoury's clinic. How may I assist you today? Would you like to book an in-office consultation or a home visit?",
      };
    }

    return {
      text: "Ahla fik! Kif fina nse3dak l yom bi 3iyadetna? Baddak t7ajez maw3ad bil 3iyade aw zyara 3al beit?",
    };
  }

  public async generateReplyFromToolResult(params: {
    systemPrompt: string;
    userQuery: string;
    toolName: string;
    toolArgs: any;
    toolResult: any;
  }): Promise<string> {
    for (const modelName of this.modelPool) {
      try {
        const model = this.genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: params.systemPrompt,
        });

        const prompt = `
User asked / message: "${params.userQuery}"
Action/Tool Executed: ${params.toolName} with arguments: ${JSON.stringify(params.toolArgs)}
Backend Result: ${JSON.stringify(params.toolResult)}

Draft the final WhatsApp reply to the user based STRICTLY on the tool result above.

Guidelines:
- Match the exact language and dialect of the patient:
  * If the patient wrote in ENGLISH: reply in warm, polished, professional, and empathetic English. Format key appointment details with clean bullet points.
  * If the patient wrote in LEBANESE ARABIZI: reply in natural, warm Franco-Arabe Arabizi ("Ahla", "Alf salemeh", "ayya", "byenasbak", "nzabbitlak").
  * If the patient wrote in ARABIC SCRIPT or FRENCH: reply in fluent, respectful Arabic or French.
- Never output raw ISO timestamp strings or timezone tokens like 'Z' or 'T'.
- If availability / slots were checked:
  * Backend Result provides 'available_slots' and 'upcoming_open_days' with exact shift hours.
  * If the patient asked for a SPECIFIC time or day (e.g. "Tuesday at 8", "Tomorrow at 10 AM", "Wednesday afternoon"):
    - Check if that requested time is in 'available_slots'.
    - If AVAILABLE: Confirm that specific time directly (e.g. "Tuesday at 8:00 AM is available with Dr. Ziad!"). Do NOT dump the full day's shifts or ask them to choose between other minute slots. Only ask for whatever information is still missing (in-office vs home visit, or address if home visit was requested).
    - If NOT AVAILABLE: Explain politely that this specific slot is unavailable, and provide the nearest available shift window(s) for that day or upcoming open days.
  * If the patient made a BROAD / GENERAL inquiry (e.g. "when are you free?", "what openings do you have this week?"):
    - Format the schedule clearly using clean **from ... to ...** shift spans (DO NOT dump long comma-separated lists of individual minute slots):
      - **[Day Name, Date]:** From [Start Time] to [End Time] (if multiple shifts: e.g. From 07:30 AM to 10:30 AM, 11:15 AM to 02:15 PM, 04:45 PM to 08:00 PM)
      - (If closed or fully booked on a day, state 'Closed' or 'Fully Booked')
    - Conclude with: "Please choose one of the available openings above that works best for you, and let us know if you prefer an in-office consultation at the clinic or a home visit." (or translated equivalent).
  * NEVER invent or assume opening hours that are not returned in the Backend Result.
- If an appointment was booked: provide an enthusiastic, crystal-clear confirmation card with service, date, time, and location (In-Office vs Home Visit + address).
- If booking had an error / missing address:
  * Acknowledge the requested appointment enthusiastically, and ask warmly for their home address or WhatsApp location pin to confirm the home visit right away.
- If an appointment was cancelled:
  * Confirm cancellation clearly and warmly.
  * If the patient mentioned wanting to reschedule or rebook:
    - Present a mini schedule of upcoming openings from 'upcoming_open_days' (using clean From [Start] to [End] shift intervals).
    - Conclude by asking them to pick from the available openings above and whether they prefer an in-office consultation or a home visit.
- If an appointment was rescheduled: confirm the new date, time, and visit type.
- If clinic overview / services & policies were retrieved ('get_services_and_policies'):
  * List the services and their exact prices clearly.
  * Present the clinic working hours using the EXACT 'clinic_working_hours' array returned in the Backend Result (e.g. Wednesday shifts, Friday closed, weekend closed). NEVER invent or assume opening hours that differ from the Backend Result.
  * Mention the cancellation policy (up to 2 hours before appointment).
  * Conclude warmly: "Please choose one of the available time slots above that works best for you, and let us know if you prefer an in-office consultation at the clinic or a home visit."
- NEVER ask repetitive questions if the patient already specified the information.
- Keep it concise, high-touch, and empathetic.
`;

        const result = await model.generateContent(prompt);
        return result.response.text().trim();
      } catch (err: any) {
        console.warn(`[Agent] ⚠️ Drafting on ${modelName} failed (${err?.status || err?.message}), trying next model...`);
      }
    }

    return this.getFallbackToolReply(params);
  }

  public getFallbackToolReply(params: {
    toolName: string;
    toolArgs: any;
    toolResult: any;
    userQuery?: string;
  }): string {
    const lang = detectLanguage(params.userQuery || '');

    if (lang === 'english') {
      if (params.toolName === 'check_availability') {
        const slots = params.toolResult.available_slots || [];
        if (slots.length === 0) {
          return `We do not have any open slots on ${params.toolArgs.date}. Would you like to check another day?`;
        }
        const typeLabel = params.toolArgs.visit_type === 'home_visit' ? 'Home Visit' : 'In-Office';
        return `Available slots on ${params.toolArgs.date} (${typeLabel}):\n• ${slots.join(', ')}\n\nWhich time works best for you?`;
      }

      if (params.toolName === 'book_appointment') {
        if (params.toolResult.error) {
          return `We couldn't complete the booking: ${params.toolResult.error}.`;
        }
        const timeDisplay = formatEnglishDate(params.toolResult.start_time);
        const locDisplay = params.toolResult.visit_type === 'home_visit'
          ? `Home Visit (${params.toolResult.address || 'Address provided'})`
          : 'In-Office at Clinic';
        return `All set! Your appointment for **${params.toolResult.service}** on **${timeDisplay}** (${locDisplay}) is confirmed. We look forward to seeing you!`;
      }

      if (params.toolName === 'reschedule_appointment') {
        if (params.toolResult.error) {
          return `We couldn't reschedule your appointment: ${params.toolResult.error}.`;
        }
        const timeDisplay = formatEnglishDate(params.toolResult.start_time);
        return `Your appointment has been successfully rescheduled to **${timeDisplay}**. See you then!`;
      }

      if (params.toolName === 'cancel_appointment') {
        if (params.toolResult.error) {
          return `Unable to cancel: ${params.toolResult.error}.`;
        }
        return `Your appointment has been cancelled as requested. We hope you feel better soon!`;
      }

      if (params.toolName === 'escalate_to_human') {
        const isUrgent = params.toolArgs?.urgency === 'high' || (params.userQuery && /chest pain|shortness of breath|waja3.*sader|dii2et nafas|emergency/i.test(params.userQuery));
        if (isUrgent) {
          return `🚨 If you are experiencing severe chest pain, shortness of breath, or an acute emergency, please call 112 (or local emergency services) or go to the nearest emergency room immediately! I have also alerted Dr. Ziad with urgent priority.`;
        }
        return `I have informed Dr. Ziad and our clinic team of your request. A team member will message you directly right here on WhatsApp as soon as possible!`;
      }

      if (params.toolName === 'get_services_and_policies') {
        const hoursList = (params.toolResult.clinic_working_hours || []).join('\n• ');
        return `We offer General Consultations ($120), Follow-ups ($70), and Home Visits ($180).\n\n🕒 **Clinic Working Hours:**\n• ${hoursList}\n\nWhich day and time works best for you, and would you prefer an **in-office consultation** or a **home visit**?`;
      }

      return JSON.stringify(params.toolResult);
    }

    if (lang === 'french') {
      if (params.toolName === 'check_availability') {
        const slots = params.toolResult.available_slots || [];
        if (slots.length === 0) {
          return `Nous n'avons aucun créneau disponible le ${params.toolArgs.date}. Souhaitez-vous vérifier un autre jour?`;
        }
        const typeLabel = params.toolArgs.visit_type === 'home_visit' ? 'Visite à domicile' : 'En cabinet';
        return `Créneaux disponibles le ${params.toolArgs.date} (${typeLabel}):\n• ${slots.join(', ')}\n\nQuelle heure vous conviendrait le mieux?`;
      }

      if (params.toolName === 'book_appointment') {
        if (params.toolResult.error) {
          return `Impossible de confirmer le rendez-vous: ${params.toolResult.error}.`;
        }
        const timeDisplay = formatEnglishDate(params.toolResult.start_time);
        const locDisplay = params.toolResult.visit_type === 'home_visit'
          ? `Visite à domicile (${params.toolResult.address || 'Adresse indiquée'})`
          : 'Au cabinet du Dr. Ziad';
        return `Parfait! Votre rendez-vous pour **${params.toolResult.service}** le **${timeDisplay}** (${locDisplay}) est bien confirmé. Au plaisir de vous accueillir!`;
      }

      if (params.toolName === 'reschedule_appointment') {
        if (params.toolResult.error) {
          return `Impossible de reporter: ${params.toolResult.error}.`;
        }
        const timeDisplay = formatEnglishDate(params.toolResult.start_time);
        return `Votre rendez-vous a bien été déplacé au **${timeDisplay}**. À très bientôt!`;
      }

      if (params.toolName === 'cancel_appointment') {
        if (params.toolResult.error) {
          return `Impossible d'annuler: ${params.toolResult.error}.`;
        }
        return `Votre rendez-vous a été annulé avec succès. Nous vous souhaitons un prompt rétablissement!`;
      }

      if (params.toolName === 'escalate_to_human') {
        const isUrgent = params.toolArgs?.urgency === 'high' || (params.userQuery && /chest pain|douleur|urgence|shortness of breath/i.test(params.userQuery));
        if (isUrgent) {
          return `🚨 En cas d'urgence médicale aiguë ou de détresse respiratoire, veuillez appeler immédiatement le 112 ou vous rendre aux urgences les plus proches. J'ai également alerté le Dr. Ziad en priorité urgente.`;
        }
        return `J'ai bien transmis votre demande au Dr. Ziad et à notre équipe. Un membre du cabinet vous contactera directement ici sur WhatsApp dans les plus brefs délais!`;
      }

      if (params.toolName === 'get_services_and_policies') {
        const hoursList = (params.toolResult.clinic_working_hours || []).join('\n• ');
        return `Nous proposons des Consultations Générales (120$), des Suivis (70$) et des Visites à Domicile (180$).\n\n🕒 **Horaires du cabinet:**\n• ${hoursList}\n\nQuel jour et quelle heure vous conviendraient le mieux, et préférez-vous une consultation au cabinet ou à domicile?`;
      }

      return JSON.stringify(params.toolResult);
    }

    if (lang === 'arabic') {
      if (params.toolName === 'check_availability') {
        const slots = params.toolResult.available_slots || [];
        if (slots.length === 0) {
          return `لا توجد مواعيد متاحة في هذا التاريخ (${params.toolArgs.date}). هل تود التحقق من يوم آخر؟`;
        }
        return `المواعيد المتاحة يوم ${params.toolArgs.date}: ${slots.join(', ')}. أي وقت يناسبك؟`;
      }

      if (params.toolName === 'book_appointment') {
        if (params.toolResult.error) {
          return `تعذر تثبيت الموعد: ${params.toolResult.error}`;
        }
        return `تم تأكيد موعدك بنجاح (${params.toolResult.service}). ألف سلامة ونتطلع لرؤيتك!`;
      }

      if (params.toolName === 'reschedule_appointment') {
        if (params.toolResult.error) {
          return `تعذر تعديل الموعد: ${params.toolResult.error}`;
        }
        return `تم تعديل موعدك بنجاح. تكرم عينك!`;
      }

      if (params.toolName === 'cancel_appointment') {
        if (params.toolResult.error) {
          return `تعذر إلغاء الموعد: ${params.toolResult.error}`;
        }
        return `تم إلغاء موعدك بنجاح. نتمنى لك دوام الصحة والعافية!`;
      }

      if (params.toolName === 'escalate_to_human') {
        const isUrgent = params.toolArgs?.urgency === 'high';
        if (isUrgent) {
          return `🚨 في حال وجود حالة طارئة أو ألم حاد في الصدر، يرجى الاتصال برقم 112 (الصليب الأحمر) أو التوجه فوراً لأقاب قسم طوارئ! تم إعلام الدكتور زياد بشكل عاجل.`;
        }
        return `تكرم عينك! تم إعلام الدكتور زياد وفريق العيادة بطلبكم، وسيتم التواصل معكم مباشرة عبر الواتساب في أقرب وقت.`;
      }

      if (params.toolName === 'get_services_and_policies') {
        const hoursList = (params.toolResult.clinic_working_hours || []).join('\n• ');
        return `نقدم استشارات عامة (120$)، متابعة (70$)، وزيارات منزلية (180$).\n\n🕒 **أوقات دوام العيادة:**\n• ${hoursList}\n\nأي يوم ووقت يناسبكم؟ وهل تفضلون الموعد في العيادة أم زيارة منزلية؟`;
      }

      return JSON.stringify(params.toolResult);
    }

    // Default Arabizi fallback
    if (params.toolName === 'check_availability') {
      const slots = params.toolResult.available_slots || [];
      if (slots.length === 0) {
        return `Ma fi majal fadi bi hal nhar (${params.toolArgs.date}). Baddak nshouflak nhar tene?`;
      }
      return `L mawa3eed l fadiye bi ${params.toolArgs.date}: ${slots.join(', ')}. Ayya wa2et byenasbak kermel nzabbitlak ye?`;
    }

    if (params.toolName === 'book_appointment') {
      if (params.toolResult.error) {
        return `Ma zabbat l 7ajez: ${params.toolResult.error}`;
      }
      const timeDisplay = formatLebDate(params.toolResult.start_time);
      const locDisplay = params.toolResult.visit_type === 'home_visit' 
        ? `zyara 3al beit (${params.toolResult.address || ''})` 
        : `bil 3iyade`;
      return `Tamam! Zabbattelak l maw3ad (${params.toolResult.service}) ${timeDisplay} ${locDisplay}. Alf salemeh w mnshoufak bi kher!`;
    }

    if (params.toolName === 'reschedule_appointment') {
      if (params.toolResult.error) {
        return `Ma zabbat l ta2jeel: ${params.toolResult.error}`;
      }
      const timeDisplay = formatLebDate(params.toolResult.start_time);
      return `Zabbattelak l maw3ad l jdid ${timeDisplay}. Tekram 3aynak!`;
    }

    if (params.toolName === 'cancel_appointment') {
      if (params.toolResult.error) {
        return `Ma 2derna nlaghe l maw3ad: ${params.toolResult.error}`;
      }
      return `Tlagha l maw3ad taba3ak bi naje7. Tekram 3aynak w alf salemeh!`;
    }

    if (params.toolName === 'escalate_to_human') {
      const isUrgent = params.toolArgs?.urgency === 'high' || (params.userQuery && /chest pain|shortness of breath|waja3.*sader|dii2et nafas|emergency/i.test(params.userQuery));
      if (isUrgent) {
        return `🚨 Eza 3am t7ess bi waja3 2awi bi sadrak, dii2et nafas, aw 7aleh tari2a, rja2 d2 112 (l Saleeb l A7mar) aw twajjah 3ala a2rab emergency room (ER) bi asra3 wa2et! 5abbarit l hakim bi sur3a.`;
      }
      return `Tekram! 5abbarit Dr. Ziad w l team bi talabak, w ra7 yetwasalo ma3ak direct hon 3a WhatsApp bi asra3 wa2et!`;
    }

    if (params.toolName === 'get_services_and_policies') {
      const hoursList = (params.toolResult.clinic_working_hours || []).join('\n• ');
      return `3enna General Consultations ($120), Follow-ups ($70), w Home Visits ($180).\n\n🕒 **Dawam l 3iyade:**\n• ${hoursList}\n\nAyya nhar w se3a byenasbak? W btefaddal bil 3iyade aw zyara 3al beit?`;
    }

    return JSON.stringify(params.toolResult);
  }

  public async generateRescheduleOutreach(params: {
    customerName: string;
    appointment: {
      service: string;
      start_time: string;
      visit_type: string;
      address?: string | null;
    };
    doctorPrompt?: string;
    proposedDate?: string;
    proposedTime?: string;
    suggestedSlots?: string[];
    language?: string;
  }): Promise<string> {
    return withRetry(async () => {
      const model = this.genAI.getGenerativeModel({
        model: this.modelPool[0] || 'gemini-flash-latest',
        systemInstruction: SYSTEM_PROMPT,
      });

      let slotDirective = '';
      if (params.proposedDate && params.proposedTime) {
        slotDirective = `The doctor specifically proposes moving the appointment to: ${params.proposedDate} at ${params.proposedTime}. Inform the patient and ask if this specific time works for them.`;
      } else if (params.suggestedSlots && params.suggestedSlots.length > 0) {
        slotDirective = `Available openings from the doctor's calendar to offer: ${params.suggestedSlots.join(', ')}. Invite the patient to pick one or suggest what suits them.`;
      } else {
        slotDirective = `Ask the patient what upcoming days and hours would suit them best.`;
      }

      let langDirective = '';
      if (params.language === 'lebanese_arabic') {
        langDirective = 'Write the message in natural, polite Lebanese Arabic (in Arabic script, e.g. "مرحبا... منعتذر كتير بس مضطرين نأجل الموعد...").';
      } else if (params.language === 'arabizi') {
        langDirective = 'Write the message in natural Lebanese Arabizi / Franco-Arabic (e.g. "Marhaba... mnet3ezir ktir bas medtarrin n2ajjel l maw3ad...").';
      } else if (params.language === 'french') {
        langDirective = 'Write the message in natural French.';
      } else if (params.language === 'english') {
        langDirective = 'Write the message in natural English.';
      } else {
        langDirective = 'Write the message in the language the patient usually speaks (default to Lebanese Arabic if in Lebanon, or friendly English).';
      }

      const prompt = `
We need to reschedule an upcoming appointment with a patient.
Patient Name: ${params.customerName}
Current Appointment: ${params.appointment.service} at ${params.appointment.start_time} (${params.appointment.visit_type === 'home_visit' ? 'Home Visit' : 'In-Office'})
Reason / Directive: ${params.doctorPrompt || 'Unexpected clinic schedule conflict'}
${slotDirective}
${langDirective}

Write a polite, warm, and professional WhatsApp message to the patient.
Keep it natural and concise (1 to 3 short sentences) suitable for a WhatsApp text from a clinic.
`;

      const result = await model.generateContent(prompt);
      return result.response.text();
    });
  }
}

export class MockGeminiClient implements GeminiClient {
  public mockToolCall: ToolCall | null = null;
  public mockReplyText: string | null = null;

  public async generateResponse(params: {
    systemPrompt: string;
    conversationHistory: any[];
    incomingMessage: string;
    tools: any[];
  }): Promise<{ text?: string; toolCalls?: ToolCall[] }> {
    if (this.mockToolCall) {
      return { toolCalls: [this.mockToolCall] };
    }
    if (this.mockReplyText) {
      return { text: this.mockReplyText };
    }

    // Heuristic mock responses based on incoming keywords if not explicitly overridden
    const lower = params.incomingMessage.toLowerCase();
    if (lower.includes('available') || lower.includes('slots') || lower.includes('free')) {
      return {
        toolCalls: [
          {
            name: 'check_availability',
            args: { date: '2026-09-10', visit_type: lower.includes('home') ? 'home_visit' : 'in_office' },
          },
        ],
      };
    }

    if (lower.includes('book') || lower.includes('appointment')) {
      return {
        toolCalls: [
          {
            name: 'book_appointment',
            args: {
              date: '2026-09-10',
              time: '10:00',
              visit_type: lower.includes('home') ? 'home_visit' : 'in_office',
              service: 'General Consultation',
              address: lower.includes('home') ? '789 Pine Ave' : undefined,
            },
          },
        ],
      };
    }

    if (lower.includes('reschedule') || lower.includes('move')) {
      return {
        toolCalls: [
          {
            name: 'reschedule_appointment',
            args: { new_date: '2026-09-10', new_time: '14:00' },
          },
        ],
      };
    }

    if (lower.includes('cancel')) {
      return {
        toolCalls: [
          {
            name: 'cancel_appointment',
            args: { reason: 'Customer requested cancellation' },
          },
        ],
      };
    }

    if (
      lower.includes('chest pain') ||
      lower.includes('waja3 bi sadre') ||
      lower.includes('waja3 seder') ||
      lower.includes('shortness of breath') ||
      lower.includes('dii2et nafas') ||
      lower.includes('emergency') ||
      lower.includes('tari2a')
    ) {
      return {
        toolCalls: [
          {
            name: 'escalate_to_human',
            args: { reason: 'Emergency triage: acute medical symptoms reported', urgency: 'high' },
          },
        ],
      };
    }

    if (
      lower.includes('human') ||
      lower.includes('person') ||
      lower.includes('speak with doctor') ||
      lower.includes('doctor phone') ||
      lower.includes('personal number') ||
      lower.includes('ra2em') ||
      lower.includes('call him') ||
      lower.includes('contact directly')
    ) {
      return {
        toolCalls: [
          {
            name: 'escalate_to_human',
            args: { reason: 'Patient requested doctor direct contact / phone number', urgency: 'medium' },
          },
        ],
      };
    }

    if (lower.includes('[voice_note]') || lower.includes('voice note')) {
      return {
        text: "Thank you for reaching out! Our clinic scheduling assistant currently processes written messages 💬. Please type your appointment request or question here (or type 'human' if you would like Dr. Ziad / clinic staff to contact you directly), and we'll take care of it right away!",
      };
    }

    if (lower.includes('price') || lower.includes('service') || lower.includes('hours')) {
      return {
        toolCalls: [
          {
            name: 'get_services_and_policies',
            args: {},
          },
        ],
      };
    }

    return {
      text: "Hello! How can Dr. Ziad's medical office assist you today?",
    };
  }

  public async generateReplyFromToolResult(params: {
    systemPrompt: string;
    userQuery: string;
    toolName: string;
    toolArgs: any;
    toolResult: any;
  }): Promise<string> {
    if (this.mockReplyText) {
      return this.mockReplyText;
    }
    const lang = detectLanguage(params.userQuery || '');
    if (lang === 'french') {
      if (params.toolName === 'book_appointment') {
        return `Parfait! Votre rendez-vous pour ${params.toolResult.service} le ${params.toolResult.start_time} est bien confirmé. Au plaisir de vous accueillir!`;
      }
    }
    if (params.toolName === 'check_availability') {
      const slots = params.toolResult.available_slots || [];
      if (slots.length === 0) {
        return `We do not have any open slots on ${params.toolArgs.date}. Would you like to check another day?`;
      }
      return `Available slots on ${params.toolArgs.date} (${params.toolArgs.visit_type || 'in_office'}): ${slots.join(', ')}. Which time works best for you?`;
    }

    if (params.toolName === 'book_appointment') {
      if (params.toolResult.error) {
        return `We couldn't complete the booking: ${params.toolResult.error}.`;
      }
      return `Your appointment for ${params.toolResult.service} on ${params.toolResult.start_time} is confirmed!`;
    }

    if (params.toolName === 'reschedule_appointment') {
      if (params.toolResult.error) {
        return `We couldn't reschedule: ${params.toolResult.error}.`;
      }
      return `Your appointment has been successfully rescheduled to ${params.toolResult.start_time}.`;
    }

    if (params.toolName === 'cancel_appointment') {
      if (params.toolResult.error) {
        return `Unable to cancel: ${params.toolResult.error}.`;
      }
      return `Your appointment on ${params.toolResult.start_time} has been cancelled as requested.`;
    }

    if (params.toolName === 'escalate_to_human') {
      const isUrgent = params.toolArgs?.urgency === 'high' || (params.userQuery && /chest pain|shortness of breath|waja3.*sader|dii2et nafas|emergency/i.test(params.userQuery));
      if (isUrgent) {
        return `🚨 If you are experiencing severe chest pain, shortness of breath, or an acute emergency, please call 112 (or local emergency services) or go to the nearest emergency room immediately! I have also alerted Dr. Ziad with urgent priority.`;
      }
      if (lang === 'arabizi') {
        return `Tekram! 5abbarit Dr. Ziad w l team bi talabak, w ra7 yetwasalo ma3ak direct hon 3a WhatsApp bi asra3 wa2et!`;
      }
      return `I have informed Dr. Ziad and our clinic team of your request. A team member will message you directly right here on WhatsApp as soon as possible!`;
    }

    if (params.toolName === 'get_services_and_policies') {
      const hoursList = (params.toolResult.clinic_working_hours || []).join('\n• ');
      return `We offer General Consultations ($120), Follow-ups ($70), Home Visits ($180), and Therapy ($130).\n\n🕒 **Clinic Working Hours:**\n• ${hoursList}\n\nWhich day and time works best for you, and would you prefer an in-office consultation or a home visit?`;
    }

    return JSON.stringify(params.toolResult);
  }

  public getFallbackToolReply(params: {
    toolName: string;
    toolArgs: any;
    toolResult: any;
    userQuery?: string;
  }): string {
    return LiveGeminiClient.prototype.getFallbackToolReply.call(this, params);
  }

  public async generateRescheduleOutreach(params: {
    customerName: string;
    appointment: {
      service: string;
      start_time: string;
      visit_type: string;
      address?: string | null;
    };
    doctorPrompt?: string;
    proposedDate?: string;
    proposedTime?: string;
    suggestedSlots?: string[];
    language?: string;
  }): Promise<string> {
    const specific = (params.proposedDate && params.proposedTime)
      ? ` Doctor proposes moving it to ${params.proposedDate} at ${params.proposedTime}.`
      : '';
    const slots = (!specific && params.suggestedSlots && params.suggestedSlots.length > 0)
      ? ` Here are suggested open times: ${params.suggestedSlots.join(', ')}.`
      : '';
    const reason = params.doctorPrompt ? ` (${params.doctorPrompt})` : '';
    return `Hello ${params.customerName}, we need to reschedule your ${params.appointment.service} appointment on ${params.appointment.start_time}${reason}.${specific}${slots} Please reply with your preferred day and time!`;
  }
}

export class AgentCore {
  private client: GeminiClient;
  private scheduler: SchedulingEngine;
  private notifier: AdminNotificationService;

  constructor(options: {
    client: GeminiClient;
    scheduler: SchedulingEngine;
    notifier: AdminNotificationService;
  }) {
    this.client = options.client;
    this.scheduler = options.scheduler;
    this.notifier = options.notifier;
  }

  public async processMessage(context: {
    customer: Customer;
    conversation: Conversation;
    incomingText: string;
    db: DatabaseContext;
  }): Promise<string> {
    const { customer, conversation, incomingText, db } = context;

    const lower = incomingText.toLowerCase();

    // 1. Dynamic Calendar & Time Context
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    
    const dayNamesLeb: Record<number, string> = {
      0: 'Ahad (Sunday)',
      1: 'Tnen / Tanen (Monday)',
      2: 'Taleta / Tleta (Tuesday)',
      3: 'Arba3a (Wednesday)',
      4: 'Khamis (Thursday)',
      5: 'Jem3a (Friday)',
      6: 'Sabit (Saturday)',
    };
    const upcomingScheduleDays: string[] = [];
    for (let i = 0; i <= 10; i++) {
      const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const iso = d.toISOString().split('T')[0];
      const dow = d.getDay();
      const label = i === 0 ? ' [Today]' : i === 1 ? ' [Bkra / Tomorrow]' : '';
      upcomingScheduleDays.push(`- ${iso} = ${dayNamesLeb[dow]}${label}`);
    }

    // 2. Check if message is directly from Doctor / Clinic Admin
    const custDigits = (customer.phone || '').replace(/\D/g, '');
    const adminDigits = ((this.notifier as any)?.adminNumber || process.env.ADMIN_WHATSAPP_NUMBER || '+96171476193').replace(/\D/g, '');
    const isDoctor = Boolean(custDigits && adminDigits && (custDigits === adminDigits || custDigits.endsWith(adminDigits) || adminDigits.endsWith(custDigits)));

    // Direct Doctor Commands & Sensitivity
    if (isDoctor) {
      if (
        lower.includes('block') ||
        lower.includes('sakkir') ||
        lower.includes('day off') ||
        lower.includes('vacation') ||
        lower.includes('holiday')
      ) {
        let targetDate = todayStr;
        if (lower.includes('tomorrow') || lower.includes('bkra')) {
          const tmrw = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          targetDate = tmrw.toISOString().split('T')[0];
        } else {
          const match = incomingText.match(/\b\d{4}-\d{2}-\d{2}\b/);
          if (match) targetDate = match[0];
        }
        db.availability.setOverride({
          date: targetDate,
          is_unavailable: true,
          reason: 'Doctor Personal Blockout / Day Off',
        });
        return `✅ Done Doctor! I have blocked out *${targetDate}* in your schedule. New patient booking requests will automatically be offered your other open shifts.`;
      }

      if (
        lower.includes('schedule') ||
        lower.includes('appointments') ||
        lower.includes('mawa3eed') ||
        lower.includes('who is') ||
        lower.includes('min fi') ||
        lower.includes('today') ||
        lower.includes('l yom') ||
        lower.includes('tomorrow') ||
        lower.includes('bkra')
      ) {
        const upcoming = db.appointments.listUpcoming(20);
        const activeAppts = upcoming.filter(a => a.status === 'booked' || a.status === 'confirmed' || a.status === 'rescheduled');
        if (activeAppts.length === 0) {
          return "👨‍⚕️ Doctor, you have no upcoming appointments scheduled in the system. Your calendar is completely open!";
        }
        const lines = activeAppts.map(a => {
          const d = new Date(a.start_time);
          const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          const loc = a.visit_type === 'home_visit' ? `🏠 Home Visit (${a.address || 'Address provided'})` : '🏢 In-Office';
          return `• *${dateStr} @ ${timeStr}* – ${a.customer_name || 'Patient'} (${a.service}, ${loc})`;
        });
        return `👨‍⚕️ *Doctor Schedule Overview:*\n\n${lines.join('\n')}\n\nTotal: ${activeAppts.length} active visit(s). Let me know if you need to block hours or adjust any booking!`;
      }
    }

    // 3. Check explicit human escalation or direct doctor/phone request trigger for patients
    if (
      lower.includes('human') ||
      lower.includes('speak with person') ||
      lower.includes('real person') ||
      lower.includes('talk to doctor') ||
      lower.includes('speak with doctor') ||
      lower.includes('doctor phone') ||
      lower.includes('personal number') ||
      lower.includes('ra2em l hakim') ||
      lower.includes('ra2em l doctor') ||
      lower.includes('a3tini ra2mo') ||
      lower.includes('call the doctor') ||
      lower.includes('bedde e7ke ma3 l hakim') ||
      lower.includes('baddi ehke ma3 el hakim')
    ) {
      return this.executeEscalation(customer, conversation, db, 'Patient requested human / direct contact with doctor', 'medium', incomingText);
    }

    const contextSystemPrompt = isDoctor
      ? `${DOCTOR_ASSISTANT_SYSTEM_PROMPT}

CURRENT SYSTEM CONTEXT:
- Today's date: ${todayStr} (${dayOfWeek})
- Current time: ${timeStr}
- Doctor Phone: ${customer.phone}

UPCOMING DAYS REFERENCE:
${upcomingScheduleDays.join('\n')}`
      : `${SYSTEM_PROMPT}

CURRENT SYSTEM CONTEXT:
- Today's date: ${todayStr} (${dayOfWeek})
- Current time: ${timeStr}
- Patient Name: ${customer.name || 'Patient'}
- Patient Phone: ${customer.phone}

OFFICIAL CLINIC SERVICES & RULES:
- Available Services: General Consultation ($120), Follow-up ($70), Home Visit Care ($180), Therapy ($130)
- Always call 'check_availability' to retrieve exact open calendar slots and active weekly shifts.
- Never assume the clinic is open when check_availability returns closed or empty slots.
- Always ask or confirm whether the patient prefers an in-office consultation at the clinic or a home visit.

CRITICAL GROUNDING & VISIT TYPE RULES:
- Quote only real slots returned by 'check_availability'.
- If the patient specifies a date and time without stating whether they prefer in-office or a home visit:
  * DO NOT call 'book_appointment' yet.
  * Prompt them to clarify: "Would you like this appointment **in-office at the clinic** or as a **home visit**?"
- If the patient requests a home visit, a valid home address or WhatsApp location pin is mandatory before calling 'book_appointment'.
- If they already clarified in-office (or home visit with address), call 'book_appointment' immediately.

UPCOMING DAYS REFERENCE (use these exact dates for Lebanese day names):
${upcomingScheduleDays.join('\n')}`;

    // 3. Build sanitized, alternating conversation history
    const allRecent = db.messages.getRecentMessages(conversation.id, 16);
    // Exclude only the current message at the end of the array
    const historyMessages = (allRecent.length > 0 && allRecent[allRecent.length - 1].body === incomingText)
      ? allRecent.slice(0, -1)
      : allRecent;

    const rawHistory: Array<{ role: 'user' | 'model'; text: string }> = historyMessages.map((msg) => ({
      role: msg.direction === 'inbound' ? 'user' : 'model',
      text: msg.body,
    }));

    const conversationHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text?: string }> }> = [];
    let lastRole: 'user' | 'model' | null = null;

    for (const item of rawHistory) {
      if (item.role === lastRole && conversationHistory.length > 0) {
        // Merge consecutive messages from same role
        const prev = conversationHistory[conversationHistory.length - 1];
        if (prev.parts[0]?.text) {
          prev.parts[0].text += `\n${item.text}`;
        }
      } else {
        // Conversation history must begin with 'user' for Gemini API
        if (conversationHistory.length === 0 && item.role === 'model') {
          continue;
        }
        conversationHistory.push({
          role: item.role,
          parts: [{ text: item.text }],
        });
        lastRole = item.role;
      }
    }

    // 4. Request Gemini classification / tool call
    console.log(`[Agent] 🤖 Calling Gemini LLM for intent & tool calling...`);
    const geminiRes = await this.client.generateResponse({
      systemPrompt: contextSystemPrompt,
      conversationHistory,
      incomingMessage: incomingText,
      tools: AGENT_TOOLS,
    });

    if (geminiRes.text && (!geminiRes.toolCalls || geminiRes.toolCalls.length === 0)) {
      console.log(`[Agent] 💬 Gemini responded with direct text: "${geminiRes.text}"`);
      return geminiRes.text;
    }

    if (!geminiRes.toolCalls || geminiRes.toolCalls.length === 0) {
      return "Hi! How can our medical practice help you today? Would you like to book an in-office or home visit?";
    }

    // 5. Deterministic tool execution
    const toolCall = geminiRes.toolCalls[0];
    console.log(`[Agent] 🛠️ Tool invoked: ${toolCall.name} | Args:`, JSON.stringify(toolCall.args));
    const toolResult = await this.executeTool(toolCall, customer, conversation, db);
    console.log(`[Agent] 📋 Tool result:`, JSON.stringify(toolResult));

    // 6. Draft grounded reply from backend tool result
    console.log(`[Agent] ✍️ Drafting grounded reply from tool result...`);
    try {
      const reply = await this.client.generateReplyFromToolResult({
        systemPrompt: contextSystemPrompt,
        userQuery: incomingText,
        toolName: toolCall.name,
        toolArgs: toolCall.args,
        toolResult,
      });
      return reply;
    } catch (draftErr) {
      console.warn('[Agent] ⚠️ Failed to draft AI reply, using deterministic fallback:', draftErr);
      return this.client.getFallbackToolReply({
        toolName: toolCall.name,
        toolArgs: toolCall.args,
        toolResult,
        userQuery: incomingText,
      });
    }
  }

  private async executeTool(
    toolCall: ToolCall,
    customer: Customer,
    conversation: Conversation,
    db: DatabaseContext
  ): Promise<any> {
    const { name, args } = toolCall;

    switch (name) {
      case 'check_availability': {
        const visitType: VisitType = args.visit_type === 'home_visit' ? 'home_visit' : 'in_office';
        const targetDate = args.date || new Date().toISOString().split('T')[0];
        const slots = await this.scheduler.getAvailableSlots(targetDate, visitType);

        // Also search upcoming days across this week and next week for flexible suggestions
        const daysAhead = args.days_ahead || (slots.length === 0 ? 14 : 7);
        const upcomingOpenDays = await this.scheduler.getAvailableSlotsAcrossRange(targetDate, daysAhead, visitType, 4);

        return {
          date: targetDate,
          visit_type: visitType,
          available_slots: slots,
          upcoming_open_days: upcomingOpenDays,
        };
      }

      case 'book_appointment': {
        try {
          const visitType: VisitType = args.visit_type === 'home_visit' ? 'home_visit' : 'in_office';
          if (visitType === 'home_visit' && !args.address) {
            return { error: 'Home address is required for booking a home visit. Please provide your address.' };
          }

          const rawService = (args.service || '').toLowerCase();
          const serviceItem = CLINIC_SERVICES.find((s) => {
            const sLower = s.name.toLowerCase();
            return sLower === rawService ||
              (rawService.includes('physio') && sLower.includes('physio')) ||
              (rawService.includes('home') && sLower.includes('home')) ||
              (rawService.includes('follow') && sLower.includes('follow')) ||
              (rawService.includes('acupunc') && sLower.includes('acupunc')) ||
              (rawService.includes('consult') && sLower.includes('consult'));
          }) || (visitType === 'home_visit' ? CLINIC_SERVICES.find((s) => s.name.includes('Home')) || CLINIC_SERVICES[0] : CLINIC_SERVICES[0]);
          const startTimeIso = new Date(`${args.date}T${args.time}:00.000Z`).toISOString();

          const patientName = args.patient_name || args.customer_name || customer.name;
          const patientPhone = args.patient_phone || args.customer_phone || customer.phone;

          if (patientName && patientName !== customer.name) {
            db.customers.updateName(customer.id, patientName);
            customer.name = patientName;
          }

          if (args.patient_phone && args.patient_phone !== customer.phone) {
            try {
              db.customers.updatePhone(customer.id, args.patient_phone);
              customer.phone = args.patient_phone;
            } catch {
              // ignore phone update collision
            }
          }

          let combinedNotes = args.notes || null;
          if (args.patient_phone && args.patient_phone !== customer.phone) {
            combinedNotes = combinedNotes ? `${combinedNotes} | Contact Phone: ${args.patient_phone}` : `Contact Phone: ${args.patient_phone}`;
          }

          const appt = await this.scheduler.bookAppointment({
            customerId: customer.id,
            customerPhone: patientPhone,
            customerName: patientName,
            visitType,
            address: args.address || null,
            service: args.service || serviceItem.name,
            price: serviceItem.price,
            startTime: startTimeIso,
            notes: combinedNotes,
          });

          // Notify admin
          await this.notifier.notifyBooking(appt, customer);

          return {
            status: 'success',
            appointment_id: appt.id,
            service: appt.service,
            visit_type: appt.visit_type,
            address: appt.address,
            start_time: appt.start_time,
            price: appt.price,
          };
        } catch (err: any) {
          return { error: err.message };
        }
      }

      case 'reschedule_appointment': {
        try {
          const activeAppt = db.appointments.findLatestActiveByCustomerOrPhone(customer.id, customer.phone);
          if (!activeAppt) {
            return { error: 'No upcoming active appointment found to reschedule.' };
          }

          const newStartIso = new Date(`${args.new_date}T${args.new_time}:00.000Z`).toISOString();
          const oldTime = activeAppt.start_time;

          const resched = await this.scheduler.rescheduleAppointment({
            appointmentId: activeAppt.id,
            newStartTime: newStartIso,
            visitType: args.visit_type,
            address: args.address,
          });

          await this.notifier.notifyReschedule(resched, customer, oldTime);

          return {
            status: 'success',
            appointment_id: resched.id,
            start_time: resched.start_time,
            visit_type: resched.visit_type,
          };
        } catch (err: any) {
          return { error: err.message };
        }
      }

      case 'cancel_appointment': {
        try {
          const activeAppt = db.appointments.findLatestActiveByCustomerOrPhone(customer.id, customer.phone);
          if (!activeAppt) {
            return { error: 'No upcoming active appointment found to cancel.' };
          }

          const cancelled = await this.scheduler.cancelAppointment(activeAppt.id, args.reason);
          await this.notifier.notifyCancellation(cancelled, customer, args.reason);

          const todayStr = new Date().toISOString().split('T')[0];
          const upcomingOpenDays = await this.scheduler.getAvailableSlotsAcrossRange(todayStr, 7, 'in_office', 4);

          return {
            status: 'success',
            appointment_id: cancelled.id,
            start_time: cancelled.start_time,
            upcoming_open_days: upcomingOpenDays,
          };
        } catch (err: any) {
          return { error: err.message };
        }
      }

      case 'escalate_to_human': {
        await this.executeEscalation(customer, conversation, db, args.reason, args.urgency || 'medium');
        return {
          status: 'escalated',
          message: 'Human handoff initiated successfully.',
        };
      }

      case 'get_services_and_policies': {
        const rules = db.availability.getAllRules();
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        
        // Sort from Monday (1) to Sunday (0)
        const sortedRules = [...rules].sort((a, b) => {
          const aIndex = a.day_of_week === 0 ? 7 : a.day_of_week;
          const bIndex = b.day_of_week === 0 ? 7 : b.day_of_week;
          return aIndex - bIndex;
        });

        const weeklySchedule = sortedRules.map(r => {
          const name = dayNames[r.day_of_week];
          if (!r.is_active) return `${name}: Closed`;
          if (r.shifts && r.shifts.length > 0) {
            const shiftStr = r.shifts.map(s => `${s.start_time} – ${s.end_time}`).join(', ');
            return `${name}: ${shiftStr}`;
          }
          return `${name}: ${r.start_time} – ${r.end_time}`;
        });

        return {
          services: CLINIC_SERVICES,
          clinic_working_hours: weeklySchedule,
          policies: CLINIC_POLICIES,
        };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  private async executeEscalation(
    customer: Customer,
    conversation: Conversation,
    db: DatabaseContext,
    reason: string,
    urgency: string,
    userQuery?: string
  ): Promise<string> {
    db.conversations.updateStatus(conversation.id, 'escalated');
    db.alerts.create({
      type: 'human_handoff',
      title: `Human Escalation: ${customer.name || customer.phone}`,
      details: reason,
      customer_id: customer.id,
    });
    await this.notifier.notifyEscalation(customer, reason, urgency);
    
    const lang = detectLanguage(userQuery || reason);
    if (lang === 'english') {
      return "I have informed Dr. Ziad and our clinic team of your request. A team member will message you directly right here on WhatsApp as soon as possible!";
    }
    return "Tekram! 5abbarit Dr. Ziad w l team bi talabak, w ra7 yetwasalo ma3ak direct hon 3a WhatsApp bi asra3 wa2et!";
  }
}
