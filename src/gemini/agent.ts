import { isUrgentMessage } from '../security/urgent.js';
import {isAppointmentConfirmation} from '../utils/patient-commands.js';
import { GoogleGenAI } from '@google/genai';
import { Customer, Conversation, Appointment, VisitType, PendingBookingWorkflow } from '../types/index.js';
import { DatabaseContext } from '../db/index.js';
import { SchedulingEngine } from '../calendar/scheduler.js';
import { AdminNotificationService } from '../notifications/admin.notifier.js';
import { AGENT_TOOLS, CLINIC_SERVICES, CLINIC_POLICIES } from './tools.js';
import { SYSTEM_PROMPT, DOCTOR_ASSISTANT_SYSTEM_PROMPT } from './prompts.js';
import { withRetry } from '../utils/retry.js';
import { computeFreeWindows } from '../utils/slots.js';
import { getBeirutTimeInfo, getBeirutTodayStr, BEIRUT_TIMEZONE, beirutDateTimeToUtc } from '../utils/timezone.js';

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
    conversationTranscript?: string;
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

export function formatEnglishDate(isoStr: string, endIsoStr?: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: BEIRUT_TIMEZONE });
    const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: BEIRUT_TIMEZONE });
    const day = getBeirutTimeInfo(d).day;
    const hours = getBeirutTimeInfo(d).hour;
    const mins = getBeirutTimeInfo(d).minute.toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 === 0 ? 12 : hours % 12;
    const startDisplay = `${h12}:${mins} ${ampm}`;

    // Calculate end time (if not provided, default to +60 minutes for consultation)
    const endD = endIsoStr ? new Date(endIsoStr) : new Date(d.getTime() + 60 * 60 * 1000);
    if (!isNaN(endD.getTime())) {
      const endHours = getBeirutTimeInfo(endD).hour;
      const endMins = getBeirutTimeInfo(endD).minute.toString().padStart(2, '0');
      const endAmpm = endHours >= 12 ? 'PM' : 'AM';
      const endH12 = endHours % 12 === 0 ? 12 : endHours % 12;
      const endDisplay = `${endH12}:${endMins} ${endAmpm}`;
      return `${weekday}, ${month} ${day} from ${startDisplay} to ${endDisplay}`;
    }

    return `${weekday}, ${month} ${day} at ${startDisplay}`;
  } catch {
    return isoStr;
  }
}

export function formatLebDate(isoStr: string, endIsoStr?: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const days = ['Ahad', 'Tnen', 'Taleta', 'Arba3a', 'Khamis', 'Jem3a', 'Sabit'];
    const months = ['Kanoun Tene', 'Shbat', 'Adar', 'Naysan', 'Ayyar', 'Hzayran', 'Tamouz', 'Aab', 'Ayloul', 'Teshreen Awwal', 'Teshreen Tene', 'Kanoun Awwal'];
    const dayName = days[getBeirutTimeInfo(d).dayOfWeek];
    const monthName = months[(getBeirutTimeInfo(d).month - 1)];
    const hours = getBeirutTimeInfo(d).hour;
    const mins = getBeirutTimeInfo(d).minute.toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 === 0 ? 12 : hours % 12;
    const startDisplay = `${h12}:${mins} ${ampm}`;

    const endD = endIsoStr ? new Date(endIsoStr) : new Date(d.getTime() + 60 * 60 * 1000);
    if (!isNaN(endD.getTime())) {
      const endHours = getBeirutTimeInfo(endD).hour;
      const endMins = getBeirutTimeInfo(endD).minute.toString().padStart(2, '0');
      const endAmpm = endHours >= 12 ? 'PM' : 'AM';
      const endH12 = endHours % 12 === 0 ? 12 : endHours % 12;
      const endDisplay = `${endH12}:${endMins} ${endAmpm}`;
      return `nhar l ${dayName} (${getBeirutTimeInfo(d).day} ${monthName}) mn ${startDisplay} lal ${endDisplay}`;
    }

    return `nhar l ${dayName} (${getBeirutTimeInfo(d).day} ${monthName}) se3a ${startDisplay}`;
  } catch {
    return isoStr;
  }
}

export function formatArabicDate(isoStr: string, endIsoStr?: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const weekdaysAr = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const monthsAr = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
    const weekday = weekdaysAr[getBeirutTimeInfo(d).dayOfWeek];
    const month = monthsAr[(getBeirutTimeInfo(d).month - 1)];
    const day = getBeirutTimeInfo(d).day;
    const hours = getBeirutTimeInfo(d).hour;
    const mins = getBeirutTimeInfo(d).minute.toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'ظهراً' : 'صباحاً';
    const h12 = hours % 12 === 0 ? 12 : hours % 12;
    const startDisplay = `${h12}:${mins} ${ampm}`;

    const endD = endIsoStr ? new Date(endIsoStr) : new Date(d.getTime() + 60 * 60 * 1000);
    if (!isNaN(endD.getTime())) {
      const endHours = getBeirutTimeInfo(endD).hour;
      const endMins = getBeirutTimeInfo(endD).minute.toString().padStart(2, '0');
      const endAmpm = endHours >= 12 ? 'ظهراً' : 'صباحاً';
      const endH12 = endHours % 12 === 0 ? 12 : endHours % 12;
      const endDisplay = `${endH12}:${endMins} ${endAmpm}`;
      return `يوم ${weekday} ${day} ${month} من الساعة ${startDisplay} حتى الساعة ${endDisplay}`;
    }

    return `يوم ${weekday} ${day} ${month} الساعة ${startDisplay}`;
  } catch {
    return isoStr;
  }
}

export function extractAllSlotsFromText(text: string): Array<{ date: string; time: string }> {
  if (!text) return [];
  const results: Array<{ date: string; time: string }> = [];

  // 1. Long date formats: e.g. "Wednesday, September 23 at 12:00 PM"
  const longRegex = /(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\s+(?:at|@|se3a)\s+(\d{1,2}):(\d{2})\s*(AM|PM)?\b/gi;
  let match: RegExpExecArray | null;
  while ((match = longRegex.exec(text)) !== null) {
    const month = match[1];
    const day = match[2];
    const year = match[3] || String(new Date().getUTCFullYear());
    let hour = Number(match[4]);
    const min = match[5] || '00';
    const ampm = match[6]?.toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;

    if (hour >= 0 && hour <= 23) {
      const d = new Date(`${month} ${day}, ${year} UTC`);
      if (!Number.isNaN(d.getTime())) {
        results.push({
          date: d.toISOString().split('T')[0],
          time: `${String(hour).padStart(2, '0')}:${min}`,
        });
      }
    }
  }

  // 2. ISO format with time: "2026-09-15T09:00:00"
  const isoRegex = /\b(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d{3})?Z?\b/gi;
  while ((match = isoRegex.exec(text)) !== null) {
    const h = Number(match[2]);
    const m = Number(match[3]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      results.push({
        date: match[1],
        time: `${match[2].padStart(2, '0')}:${match[3]}`,
      });
    }
  }

  return results;
}

export function extractSlotFromText(text: string, excludeIso?: string): { date: string; time: string } | null {
  const all = extractAllSlotsFromText(text);
  if (all.length === 0) return null;
  if (!excludeIso) return all[0];

  const excludePrefix = excludeIso.slice(0, 16);
  const filtered = all.filter((s) => `${s.date}T${s.time}` !== excludePrefix);
  return filtered.length > 0 ? filtered[filtered.length - 1] : all[0];
}

export function parseDateTimeFromMessage(
  text: string,
  referenceDate: Date = new Date()
): { date?: string; time?: string } | null {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  // 1. Try existing extractSlotFromText
  const existing = extractSlotFromText(text);
  if (existing) {
    return existing;
  }

  // 2. Weekday detection (English, Arabizi, Arabic, French)
  const weekdayMap: Record<string, number> = {
    sunday: 0, sun: 0, ahad: 0, elahad: 0, dimanche: 0, 'الأحد': 0, 'الاحد': 0,
    monday: 1, mon: 1, tnen: 1, tanen: 1, eltnen: 1, lundi: 1, 'الإثنين': 1, 'الاثنين': 1,
    tuesday: 2, tue: 2, taleta: 2, tleta: 2, eltleta: 2, mardi: 2, 'الثلاثاء': 2,
    wednesday: 3, wed: 3, arba3a: 3, elarba3a: 3, mercredi: 3, 'الأربعاء': 3, 'الاربعاء': 3,
    thursday: 4, thu: 4, khamis: 4, elkhamis: 4, jeudi: 4, 'الخميس': 4,
    friday: 5, fri: 5, jem3a: 5, eljem3a: 5, vendredi: 5, 'الجمعة': 5,
    saturday: 6, sat: 6, sabit: 6, elsabit: 6, samedi: 6, 'السبت': 6,
  };

  const refInfo = getBeirutTimeInfo(referenceDate);
  let targetDate: string | undefined;

  for (const [dayName, dayNum] of Object.entries(weekdayMap)) {
    const regex = new RegExp(`\\b${dayName}\\b`, 'i');
    if (regex.test(lower)) {
      const currentDay = refInfo.dayOfWeek;
      const daysUntil = (dayNum - currentDay + 7) % 7;
      const d = new Date(referenceDate.getTime() + daysUntil * 86400000);
      targetDate = getBeirutTimeInfo(d).dateStr;
      break;
    }
  }

  if (!targetDate) {
    if (/\b(tomorrow|bkra|bokra|demain|غداً|بكرة|بكره)\b/i.test(lower)) {
      const d = new Date(referenceDate.getTime() + 86400000);
      targetDate = getBeirutTimeInfo(d).dateStr;
    } else if (/\b(today|lyom|elyom|aujourd'hui|اليوم)\b/i.test(lower)) {
      targetDate = refInfo.dateStr;
    }
  }

  // Also check explicit month + day: e.g. "sep 16", "september 21"
  if (!targetDate) {
    const monthDayMatch = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/i);
    if (monthDayMatch) {
      const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const monthIndex = monthNames.findIndex((m) => monthDayMatch[1].startsWith(m));
      if (monthIndex >= 0) {
        const day = parseInt(monthDayMatch[2], 10);
        const year = referenceDate.getUTCFullYear();
        const d = new Date(Date.UTC(year, monthIndex, day));
        targetDate = d.toISOString().split('T')[0];
      }
    }
  }

  // 3. Time detection
  // Look specifically for patterns like "at 9", "9 am", "2pm", "14:00", "9:30", "8 15", "8:15"
  let targetTime: string | undefined;
  const strongTimeRegex = /(?:(?:at|@|se3a|3al|aal|al|3a|à|on|from|between|around)\s+(\d{1,2})(?:[:\s](\d{2}))?\s*(am|pm)?)|(?:\b(\d{1,2}):(\d{2})\s*(am|pm)?\b)|(?:\b(\d{1,2})\s+(\d{2})\s*(am|pm)?\b)|(?:\b(\d{1,2})\s*(am|pm)\b)|(?:\b(\d{1,2})(?:[:\s](\d{2}))?\s*(?:till|to|-)\s*\d)/i;
  const strongMatch = lower.match(strongTimeRegex);

  if (strongMatch) {
    const rawHour = strongMatch[1] || strongMatch[4] || strongMatch[7] || strongMatch[10] || strongMatch[12];
    const rawMin = strongMatch[2] || strongMatch[5] || strongMatch[8] || strongMatch[13] || '00';
    const rawAmpm = (strongMatch[3] || strongMatch[6] || strongMatch[9] || strongMatch[11] || '').toUpperCase();

    let hour = parseInt(rawHour, 10);
    const min = parseInt(rawMin, 10);

    if (hour >= 0 && hour <= 23 && min >= 0 && min <= 59) {
      if (rawAmpm === 'PM' && hour < 12) hour += 12;
      if (rawAmpm === 'AM' && hour === 12) hour = 0;

      // If no AM/PM specified, infer typical clinic hours: 1..6 -> 13..18 (PM)
      if (!rawAmpm) {
        if (hour >= 1 && hour <= 6) {
          hour += 12;
        }
      }

      if (hour >= 0 && hour <= 23) {
        targetTime = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      }
    }
  }

  if (targetDate || targetTime) {
    return {
      date: targetDate,
      time: targetTime,
    };
  }

  return null;
}

function extractLocationBookingArgs(
  incomingText: string,
  historyMessages: Array<{ direction: string; body: string }>,
  customer: Customer,
  activeWorkflow?: PendingBookingWorkflow | null
): Record<string, any> | null {
  if (!incomingText.includes('📍 Shared Location')) return null;

  const address = incomingText.match(/📍 Shared Location: ([\s\S]*?)(?:\s*\| Maps:|$)/)?.[1]?.trim() || incomingText;

  // 1. If active database workflow already holds the selected date and time
  if (activeWorkflow && activeWorkflow.date && activeWorkflow.time) {
    return {
      date: activeWorkflow.date,
      time: activeWorkflow.time,
      visit_type: 'home_visit',
      service: activeWorkflow.service || 'Home Visit Care',
      address,
      patient_name: customer.name,
      patient_phone: customer.phone,
    };
  }

  // 2. Fallback to message history extraction
  const previousPatientMessage = [...historyMessages]
    .reverse()
    .find((message) => message.direction === 'inbound' && /\b(home visit|home|beit|zyara)\b/i.test(message.body));
  if (!previousPatientMessage) return null;

  const request = previousPatientMessage.body;
  const weekdayMatch = request.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i);
  const timeMatch = request.match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\b/i);
  if (!weekdayMatch || !timeMatch) return null;

  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const requestedDay = weekdayNames.findIndex((day) => day.toLowerCase() === weekdayMatch[1].toLowerCase());
  const now = new Date();
  const daysUntil = (requestedDay - now.getUTCDay() + 7) % 7 || 7;
  const appointmentDate = new Date(now.getTime() + daysUntil * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  let hour = Number(timeMatch[1]);
  const meridiem = timeMatch[3]?.toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;

  return {
    date: appointmentDate,
    time: `${String(hour).padStart(2, '0')}:${timeMatch[2] || '00'}`,
    visit_type: 'home_visit',
    service: 'Home Visit Care',
    address,
    patient_name: customer.name,
    patient_phone: customer.phone,
  };
}

export function sanitizeWhatsAppText(text: string): string {
  if (!text) return text;
  return text
    .replace(/^\s*\*\s+/gm, '• ') // replace asterisk bullet markers with clean dots
    .replace(/\*+/g, '')          // remove all asterisks
    .trim();
}

function formatExistingBookingSummary(appointment: Appointment, customerName: string): string {
  const location = appointment.visit_type === 'home_visit'
    ? `Home Visit (${appointment.address || 'Shared Location Pin'})`
    : 'In-Office at the Clinic';
  return `All set, ${customerName}! Your appointment has already been confirmed with Dr. Ziad El Khoury:\n\n` +
    `📅 Date: ${formatEnglishDate(appointment.start_time)}\n` +
    `📍 Location: ${location}\n\n` +
    `The location pin is safely attached to this booking. We look forward to seeing you!`;
}

function extractPendingHomeVisitSelection(
  incomingText: string,
  historyMessages: Array<{ direction: string; body: string }>,
  activeWorkflow?: PendingBookingWorkflow | null,
  excludeIso?: string
): Record<string, string> | null {
  if (incomingText.includes('📍 Shared Location')) return null;
  if (!/\b(home visit|home|beit|zyara|manzil|منزل|منزلية|زيارة منزلية)\b/i.test(incomingText)) return null;

  // Reject negations: "i don't want a home visit", "not home", "no home visit", "mesh beit", "ma bde zyara"
  if (/\b(don'?t|not|no|don't|mesh|msh|ma bde|ma rade|ma 7ebe|لا أريد|ما أريد|مش|لا زيارة)\s+(want|need|bde|rade|7ebe)?\s*(a\s+)?(home visit|home|beit|zyara|manzil|منزل|منزلية|زيارة منزلية)\b/i.test(incomingText)) return null;
  if (/\b(i\s+)?(don'?t|don't|not|no)\s+(want|need)\s+(a\s+)?home/i.test(incomingText)) return null;

  // 1. Did active workflow already have established date and time while awaiting visit type?
  if (activeWorkflow && activeWorkflow.date && activeWorkflow.time && activeWorkflow.state === 'awaiting_visit_type') {
    return {
      date: activeWorkflow.date,
      time: activeWorkflow.time,
    };
  }

  // If there is no active workflow and no prior conversation history, let Gemini handle the first message directly
  if (!activeWorkflow && historyMessages.length === 0) {
    return null;
  }

  // 2. Did the incoming message itself specify date and time?
  const currentParsed = parseDateTimeFromMessage(incomingText) || extractSlotFromText(incomingText, excludeIso);
  if (currentParsed && currentParsed.date && currentParsed.time) {
    return {
      date: currentParsed.date,
      time: currentParsed.time,
    };
  }

  // 3. Did the patient explicitly specify date and time in their immediately preceding inbound message?
  const previousInbound = [...historyMessages].reverse().find((message) => message.direction === 'inbound');
  if (previousInbound) {
    const prevParsed = parseDateTimeFromMessage(previousInbound.body) || extractSlotFromText(previousInbound.body, excludeIso);
    if (prevParsed && prevParsed.date && prevParsed.time) {
      return {
        date: prevParsed.date,
        time: prevParsed.time,
      };
    }
  }

  return null;
}

function extractPendingInOfficeSelection(
  incomingText: string,
  historyMessages: Array<{ direction: string; body: string }>,
  activeWorkflow?: PendingBookingWorkflow | null,
  excludeIso?: string
): Record<string, string> | null {
  if (incomingText.includes('📍 Shared Location')) return null;

  // If the message contains cancellation or reschedule verbs, it is NOT confirming an in-office booking!
  if (/\b(cancel|reschedule|change|postpone|elghe|ghayyer|bade 8ayer|stop|don't|dont|no|nah|mesh|msh|la2|laa|لا|الغاء|إلغاء)\b/i.test(incomingText)) {
    return null;
  }

  const cleanText = incomingText.trim();
  const isAffirmative = /^(YES|CONFIRM|TAMAM|OK|SURE|PLEASE|OUI|AKID|YEP|YUP|AH|EHH|تمام|نعم|أكيد|اي|أي|موافق|تأكيد)(\s+(please|plz|yes|tamam|doctor|hakim|doc))?[\s.!]*$/i.test(cleanText);
  const specifiesOffice = /\b(in[- ]?office|clinic|cabinet|bil 3iyade|3iyade|3al 3iyade|في العيادة|بالعيادة|عيادة)\b/i.test(incomingText);

  if (!specifiesOffice && !isAffirmative) return null;

  // 1. Did active workflow already have established date and time while awaiting visit type?
  if (activeWorkflow && activeWorkflow.date && activeWorkflow.time && activeWorkflow.state === 'awaiting_visit_type') {
    if (!specifiesOffice) return null;
    return {
      date: activeWorkflow.date,
      time: activeWorkflow.time,
    };
  }

  // 2. Did incoming message itself specify date and time?
  const currentOfficeSlot = parseDateTimeFromMessage(incomingText) || extractSlotFromText(incomingText, excludeIso);
  if (currentOfficeSlot && currentOfficeSlot.date && currentOfficeSlot.time) {
    if (!specifiesOffice) return null;
    return {
      date: currentOfficeSlot.date,
      time: currentOfficeSlot.time,
    };
  }

  // 3. Did the patient explicitly specify date and time in their immediately preceding inbound message?
  const previousInbound = [...historyMessages].reverse().find((message) => message.direction === 'inbound');
  if (previousInbound) {
    const prevParsed = parseDateTimeFromMessage(previousInbound.body) || extractSlotFromText(previousInbound.body, excludeIso);
    if (prevParsed && prevParsed.date && prevParsed.time) {
      if (!specifiesOffice) return null;
      return {
        date: prevParsed.date,
        time: prevParsed.time,
      };
    }
  }

  // 4. If patient gave affirmative reply ("yes", "confirm") to a specific offered slot from bot
  if (isAffirmative && !specifiesOffice) {
    const lastOutbound = [...historyMessages].reverse().find((m) => m.direction === 'outbound');
    if (lastOutbound && /\b(clinic or home visit|in-office or home visit|عيادة أم زيارة منزلية|بالعيادة أو بالبيت)\b/i.test(lastOutbound.body)) {
      return null;
    }
    const lastOutboundMentionsOffice = lastOutbound && /\b(in[- ]?office|clinic|cabinet|bil 3iyade|3iyade|في العيادة|بالعيادة|عيادة)\b/i.test(lastOutbound.body);
    const lastOutboundAsksConfirmation = lastOutbound && /\b(confirm|like us to confirm|would you like us to confirm|تأكيد|نؤكد|هل ترغب بتأكيد)\b/i.test(lastOutbound.body);
    if (lastOutboundMentionsOffice && lastOutboundAsksConfirmation) {
      const offeredSlot = parseDateTimeFromMessage(lastOutbound.body) || extractSlotFromText(lastOutbound.body, excludeIso);
      if (offeredSlot && offeredSlot.date && offeredSlot.time) {
        return {
          date: offeredSlot.date,
          time: offeredSlot.time,
        };
      }
    }
  }

  return null;
}

export class LiveGeminiClient implements GeminiClient {
  private genAI: GoogleGenAI;
  private modelPool: string[];

  constructor(apiKey: string, modelName?: string) {
    this.genAI = new GoogleGenAI({apiKey,httpOptions:{timeout:10000,retryOptions:{attempts:1}}});
    const primary = modelName || process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    this.modelPool = Array.from(new Set([primary,...(process.env.GEMINI_FALLBACK_MODELS || '').split(',').map(s=>s.trim()).filter(Boolean)])).slice(0,3);
    if(this.modelPool.some(name=>!/^[a-z0-9.-]+$/.test(name))) throw new Error('Invalid configured Gemini model');
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
        const response = await this.genAI.models.generateContent({
          model:modelName,
          contents:[...params.conversationHistory,{role:'user',parts:[{text:params.incomingMessage}]}],
          config:{systemInstruction:params.systemPrompt,tools:params.tools.length ? [{functionDeclarations:params.tools}] : undefined,maxOutputTokens:2048,httpOptions:{timeout:10000},abortSignal:AbortSignal.timeout(10000)}
        });
        const functionCalls=response.functionCalls;

        if (functionCalls && functionCalls.length > 0) {
          return {
            toolCalls: functionCalls.map((fc) => ({
              name: fc.name || '',
              args: fc.args as Record<string, any>,
            })),
          };
        }

        const rawText = response.text?.trim() || '';

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
        console.warn('[agent] Operation requires review');
      }
    }

    throw new Error('AI service unavailable; no appointment action was inferred');
  }

  public async generateReplyFromToolResult(params: {
    systemPrompt: string;
    userQuery: string;
    toolName: string;
    toolArgs: any;
    toolResult: any;
    conversationTranscript?: string;
  }): Promise<string> {
    const draftingInstruction = `You are the expert, polite, warm, and highly efficient medical coordinator for Dr. Ziad El Khoury's private medical practice in Lebanon, communicating with patients over WhatsApp.
Your role here is to draft the final, polished WhatsApp reply directly to the patient based on the backend action result and conversation history.
No asterisks (* or **). No money or pricing mentions. No service selection. Respond in the exact language of the patient (English, Lebanese Arabizi, Arabic, or French).`;

    for (const modelName of this.modelPool) {
      try {
        const transcriptBlock = params.conversationTranscript ? `${params.conversationTranscript}\n\n` : '';
        const prompt = `
${transcriptBlock}User asked / message: "${params.userQuery}"
Action/Tool Executed: ${params.toolName} with arguments: ${JSON.stringify(params.toolArgs)}
Backend Result: ${JSON.stringify(params.toolResult)}

Draft the final WhatsApp reply to the user based STRICTLY on the tool result and conversation history above.

Guidelines:
- STRICT NO-ASTERISK FORMATTING RULE:
  * NEVER use asterisks (* or **) anywhere in your text.
  * Do NOT format words with **bold** or *bold*. Write clean plain text without any asterisks.
  * Asterisks appear as literal symbols on WhatsApp and look messy to patients.
  * For lists, use simple hyphens (-) or bullet dots (•), never asterisks.
- OPENING GREETING & BILINGUAL FORMAT RULE (ENGLISH FIRST, ARABIC AT BOTTOM):
  * When welcoming a patient (initial greeting or first reply):
    Write the complete message in ENGLISH first, and then at the bottom provide the EXACT SAME message in ARABIC.
    Do NOT merge English and Arabic on the same line with a dash (never write "Welcome... — أهلاً وسهلاً...").
    Structure:
    Hello [Name]! Welcome to Dr. Ziad El Khoury's clinic.
    [English response content: availability / question about in-office vs home visit]

    أهلاً وسهلاً بكم في عيادة الدكتور زياد الخوري.
    [Arabic translation of the same response content: availability / question about in-office vs home visit]
- Match the exact language and dialect of the patient:
  * If the patient wrote in ENGLISH: reply in warm, polished, professional, and empathetic English. Format key appointment details with clean bullet points.
  * If the patient wrote in LEBANESE ARABIZI: reply in natural, warm Franco-Arabe Arabizi ("Ahla", "Alf salemeh", "ayya", "byenasbak", "nzabbitlak").
  * If the patient wrote in ARABIC SCRIPT or FRENCH: reply in fluent, respectful Arabic or French.
- Never output raw ISO timestamp strings or timezone tokens like 'Z' or 'T'.
- If availability / slots were checked:
  * Backend Result provides 'available_slots' (exact 24h start times), 'free_windows' (pre-computed contiguous free spans), and 'upcoming_open_days'.
  * CRITICAL TIME-MATCHING RULE: 'available_slots' contains 24-hour times. 24h→12h: "09:00"=9:00 AM, "12:00"=12:00 PM, "13:00"=1:00 PM, "14:00"=2:00 PM, "16:00"=4:00 PM.
  * If the patient asked for a SPECIFIC time (e.g. "Wednesday at 2 PM", "Saturday at 10 and a clinic visit"):
    - Convert the requested time to 24h and check if it is PRESENT in 'available_slots'.
    - If AVAILABLE (exact 24h slot IS in available_slots):
      * Check if the patient explicitly specified the visit type ("in clinic", "in-office", "bil 3iyade", "عيادة") OR ("home visit", "zyara 3al beit", "منزل").
      * IF VISIT TYPE IS NOT SPECIFIED:
        STRICT BAN: NEVER assume in-office! NEVER say "is available for an in-office consultation at the clinic" or ask "Would you like us to confirm this in-office visit?" when the patient has not explicitly requested clinic or home visit!
        YOU MUST state that the requested time is available, and MANDATORILY ASK: "Would you prefer an in-office consultation at the clinic or a home visit?"
        In Arabic: "هل تفضلون أن يكون الموعد في العيادة أم زيارة منزلية؟"
      * IF VISIT TYPE IS SPECIFIED:
        - If visit type is Home Visit and the patient has NOT provided their home address yet:
          You MUST confirm the time is available, and MANDATORILY ASK for their home address or location pin:
          "Great! [Time] on [Date] is available for a home visit. Please share your home address or send a WhatsApp location pin so Dr. Ziad knows where to visit you."
          In Arabic: "يرجى تزويدنا بعنوان المنزل أو إرسال موقعكم عبر الواتساب حتى يتمكن الدكتور زياد من زيارتكم."
          STRICT BAN: Do NOT ask to confirm the booking until the address is received!
        - If visit type is In-Office (or Home Visit with address already provided): Confirm the appointment enthusiastically!
    - If NOT AVAILABLE (exact 24h slot is NOT in available_slots): Politely say the exact time is unavailable. Then use 'free_windows' to offer the free time ranges for that day as clean "From X to Y" spans. Ask them to choose a time within those windows.
  * If the patient made a BROAD / GENERAL inquiry (e.g. "when are you free?", "what openings this week?"):
    - Use 'free_windows' from each day in 'upcoming_open_days' to present clean "From X to Y" spans. DO NOT list individual slot times.
    - Example: "Wednesday, Sep 16: From 12:30 PM to 5:00 PM" (no asterisks, not a bullet list of individual slots)
    - Conclude: "Please choose one of the available openings above and let us know if you prefer an in-office consultation or a home visit."
  * NEVER invent times not in available_slots. NEVER list individual slot start times unless there is only one slot.
- NO MONEY & NO SERVICE SELECTION: NEVER mention prices ($), fees, or costs. Never ask patients to pick between medical services. Every visit is simply an appointment with Dr. Ziad (In-Office Consultation or Home Visit).
- If an appointment was booked: provide an enthusiastic, crystal-clear confirmation card with Date & Time window (showing from Start Time to End Time, e.g. "Monday, Sep 14 from 9:00 AM to 10:00 AM"), and Location (In-Office vs Home Visit + address). Do NOT include prices or service names. Do NOT use asterisks.
- If booking had an error / missing address:
  * Acknowledge the requested appointment enthusiastically, and ask warmly for their home address or WhatsApp location pin to confirm the home visit right away.
- If an appointment was cancelled:
  * Confirm cancellation clearly and warmly.
  * If the patient mentioned wanting to reschedule or rebook:
    - Present a mini schedule of upcoming openings from 'upcoming_open_days' (using clean From [Start] to [End] shift intervals).
    - Conclude by asking them to pick from the available openings above and whether they prefer an in-office consultation or a home visit.
- If an appointment was rescheduled: confirm the new date, time window (from Start Time to End Time), and visit type without asterisks.
- If clinic overview / services & policies were retrieved ('get_services_and_policies'):
  * Present the clinic working hours using the EXACT 'clinic_working_hours' array returned in the Backend Result. Do NOT list prices or money.
  * Mention the cancellation policy (up to 2 hours before appointment).
  * Conclude warmly: "Please choose one of the available time slots above that works best for you, and let us know if you prefer an in-office consultation at the clinic or a home visit."
- NEVER ask repetitive questions if the patient already specified the information.
- Keep it concise, high-touch, and empathetic. Do NOT use asterisks.
`;

        const result=await this.genAI.models.generateContent({model:modelName,contents:prompt,config:{systemInstruction:draftingInstruction,maxOutputTokens:2048,httpOptions:{timeout:10000},abortSignal:AbortSignal.timeout(10000)}});
        const text=result.text?.trim() || '';
        if (text.length > 0) {
          return text;
        }
        console.warn('[agent] Operation requires review');
      } catch (err: any) {
        console.warn('[agent] Operation requires review');
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
        const requestedSlot = extractSlotFromText(params.userQuery || '');
        const targetTime = params.toolArgs.time || requestedSlot?.time;
        const hasOfficeKeyword = /\b(in[- ]?office|clinic|cabinet|bil 3iyade|3iyade|3al 3iyade|بالعيادة|في العيادة|عيادة)\b/i.test(params.userQuery || '');
        const hasHomeKeyword = /\b(home visit|home|beit|zyara|منزل|زيارة منزلية)\b/i.test(params.userQuery || '');
        const specifiedType = hasHomeKeyword ? 'Home Visit' : (hasOfficeKeyword ? 'In-Office Consultation' : null);

        if (targetTime && slots.includes(targetTime)) {
          if (specifiedType) {
            return `Great news! ${targetTime} on ${params.toolArgs.date} is available for your ${specifiedType} with Dr. Ziad El Khoury. Would you like me to confirm this appointment for you?`;
          }
          return `${targetTime} on ${params.toolArgs.date} is available with Dr. Ziad El Khoury!\n\nWould you prefer this appointment in-office at the clinic or as a home visit?\n\nالساعة ${targetTime} يوم ${params.toolArgs.date} متاحة لدى الدكتور زياد. هل تفضلون الموعد في العيادة أم زيارة منزلية؟`;
        }
        const typeLabel = params.toolArgs.visit_type === 'home_visit' ? 'Home Visit' : 'In-Office Consultation';
        return `Available slots on ${params.toolArgs.date} (${typeLabel}):\n• ${slots.join(', ')}\n\nWhich time works best for you, and would you prefer an in-office consultation at the clinic or a home visit?`;
      }

      if (params.toolName === 'book_appointment') {
        if (params.toolResult.error) {
          return `We couldn't complete the booking: ${params.toolResult.error}.`;
        }
        const timeDisplay = formatEnglishDate(params.toolResult.start_time, params.toolResult.end_time);
        const locDisplay = params.toolResult.visit_type === 'home_visit'
          ? `Home Visit (${params.toolResult.address || 'Address provided'})`
          : 'In-Office at Clinic';
        return `All set! Your appointment on ${timeDisplay} (${locDisplay}) is confirmed with Dr. Ziad. We look forward to seeing you!`;
      }

      if (params.toolName === 'reschedule_appointment') {
        if (params.toolResult.error) {
          return `We couldn't reschedule your appointment: ${params.toolResult.error}.`;
        }
        const timeDisplay = formatEnglishDate(params.toolResult.start_time, params.toolResult.end_time);
        return `Your appointment has been successfully rescheduled to ${timeDisplay}. See you then!`;
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
          return `🚨 If you are experiencing severe chest pain, shortness of breath, or an acute emergency, please call 140 (or local emergency services) or go to the nearest emergency room immediately! I have also alerted Dr. Ziad with urgent priority.`;
        }
        return `I have informed Dr. Ziad and our clinic team of your request. A team member will message you directly right here on WhatsApp as soon as possible!`;
      }

      if (params.toolName === 'get_services_and_policies') {
        const hoursList = (params.toolResult.clinic_working_hours || []).join('\n• ');
        return `🕒 Clinic Working Hours:\n• ${hoursList}\n\nWhich day and time works best for you, and would you prefer an in-office consultation or a home visit?`;
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
        const timeDisplay = formatEnglishDate(params.toolResult.start_time, params.toolResult.end_time);
        const locDisplay = params.toolResult.visit_type === 'home_visit'
          ? `Visite à domicile (${params.toolResult.address || 'Adresse indiquée'})`
          : 'Au cabinet du Dr. Ziad';
        return `Parfait! Votre rendez-vous le ${timeDisplay} (${locDisplay}) est bien confirmé avec le Dr. Ziad. Au plaisir de vous accueillir!`;
      }

      if (params.toolName === 'reschedule_appointment') {
        if (params.toolResult.error) {
          return `Impossible de reporter: ${params.toolResult.error}.`;
        }
        const timeDisplay = formatEnglishDate(params.toolResult.start_time, params.toolResult.end_time);
        return `Votre rendez-vous a bien été déplacé au ${timeDisplay}. À très bientôt!`;
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
          return `🚨 En cas d'urgence médicale aiguë ou de détresse respiratoire, veuillez appeler immédiatement le 140 ou vous rendre aux urgences les plus proches. J'ai également alerté le Dr. Ziad en priorité urgente.`;
        }
        return `J'ai bien transmis votre demande au Dr. Ziad et à notre équipe. Un membre du cabinet vous contactera directement ici sur WhatsApp dans les plus brefs délais!`;
      }

      if (params.toolName === 'get_services_and_policies') {
        const hoursList = (params.toolResult.clinic_working_hours || []).join('\n• ');
        return `🕒 Horaires du cabinet:\n• ${hoursList}\n\nQuel jour et quelle heure vous conviendraient le mieux, et préférez-vous une consultation au cabinet ou à domicile?`;
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
        const timeDisplay = formatArabicDate(params.toolResult.start_time, params.toolResult.end_time);
        const locDisplay = params.toolResult.visit_type === 'home_visit' ? 'زيارة منزلية' : 'في العيادة';
        return `تم تأكيد موعدك بنجاح مع الدكتور زياد (${timeDisplay} - ${locDisplay}). ألف سلامة ونتطلع لرؤيتك!`;
      }

      if (params.toolName === 'reschedule_appointment') {
        if (params.toolResult.error) {
          return `تعذر تعديل الموعد: ${params.toolResult.error}`;
        }
        const timeDisplay = formatArabicDate(params.toolResult.start_time, params.toolResult.end_time);
        return `تم تعديل موعدك بنجاح (${timeDisplay}). تكرم عينك!`;
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
          return `🚨 في حال وجود حالة طارئة أو ألم حاد في الصدر، يرجى الاتصال برقم 140 (الصليب الأحمر) أو التوجه فوراً لأقاب قسم طوارئ! تم إعلام الدكتور زياد بشكل عاجل.`;
        }
        return `تكرم عينك! تم إعلام الدكتور زياد وفريق العيادة بطلبكم، وسيتم التواصل معكم مباشرة عبر الواتساب في أقرب وقت.`;
      }

      if (params.toolName === 'get_services_and_policies') {
        const hoursList = (params.toolResult.clinic_working_hours || []).join('\n• ');
        return `🕒 أوقات دوام العيادة:\n• ${hoursList}\n\nأي يوم ووقت يناسبكم؟ وهل تفضلون الموعد في العيادة أم زيارة منزلية؟`;
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
      const timeDisplay = formatLebDate(params.toolResult.start_time, params.toolResult.end_time);
      const locDisplay = params.toolResult.visit_type === 'home_visit' 
        ? `zyara 3al beit (${params.toolResult.address || ''})` 
        : `bil 3iyade`;
      return `Tamam! Zabbattelak l maw3ad ma3 Dr. Ziad ${timeDisplay} ${locDisplay}. Alf salemeh w mnshoufak bi kher!`;
    }

    if (params.toolName === 'reschedule_appointment') {
      if (params.toolResult.error) {
        return `Ma zabbat l ta2jeel: ${params.toolResult.error}`;
      }
      const timeDisplay = formatLebDate(params.toolResult.start_time, params.toolResult.end_time);
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
        return `🚨 Eza 3am t7ess bi waja3 2awi bi sadrak, dii2et nafas, aw 7aleh tari2a, rja2 d2 140 (l Saleeb l A7mar) aw twajjah 3ala a2rab emergency room (ER) bi asra3 wa2et! 5abbarit l hakim bi sur3a.`;
      }
      return `Tekram! 5abbarit Dr. Ziad w l team bi talabak, w ra7 yetwasalo ma3ak direct hon 3a WhatsApp bi asra3 wa2et!`;
    }

    if (params.toolName === 'get_services_and_policies') {
      const hoursList = (params.toolResult.clinic_working_hours || []).join('\n• ');
      return `🕒 Dawam l 3iyade:\n• ${hoursList}\n\nAyya nhar w se3a byenasbak? W btefaddal bil 3iyade aw zyara 3al beit?`;
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
      const outreachConfig = {
        model: this.modelPool[0] || 'gemini-flash-latest',
        systemInstruction: SYSTEM_PROMPT,
      };

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

      const result=await this.genAI.models.generateContent({model:outreachConfig.model,contents:prompt,config:{systemInstruction:outreachConfig.systemInstruction,maxOutputTokens:1024,httpOptions:{timeout:10000},abortSignal:AbortSignal.timeout(10000)}});
      return result.text || '';
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

    if (lower.includes('available') || lower.includes('slots') || lower.includes('free')) {
      const requested=parseDateTimeFromMessage(params.incomingMessage);
      if(!requested?.date) return {text:'Which day would you like to check for available appointments?'};
      return {
        toolCalls: [
          {
            name: 'check_availability',
            args: { date: requested.date, visit_type: lower.includes('home') ? 'home_visit' : 'in_office' },
          },
        ],
      };
    }

    if (lower.includes('reschedule') || lower.includes('move')) {
      const requested=parseDateTimeFromMessage(params.incomingMessage);
      if(!requested?.date || !requested.time) return {text:'What new day and time would you like to move your appointment to?'};
      return {
        toolCalls: [
          {
            name: 'reschedule_appointment',
            args: { new_date: requested.date, new_time: requested.time },
          },
        ],
      };
    }

    if (lower.includes('book') || lower.includes('appointment')) {
      const requested=parseDateTimeFromMessage(params.incomingMessage);
      if(!requested?.date || !requested.time) return {text:'What day and time would you like for your appointment?'};
      if(!/home|clinic|in[- ]?office/.test(lower)) return {toolCalls:[{name:'check_availability',args:{date:requested.date}}]};
      return {
        toolCalls: [
          {
            name: 'book_appointment',
            args: {
              date: requested.date,
              time: requested.time,
              visit_type: lower.includes('home') ? 'home_visit' : 'in_office',
              service: 'General Consultation',
              address: undefined,
            },
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
    conversationTranscript?: string;
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
      if (params.toolResult && params.toolResult.visit_type_specified === false) {
        return `Welcome to Dr. Ziad El Khoury's clinic! To share our exact available schedule, please let us know if you prefer an in-office consultation at our clinic or a home visit (available hours differ due to travel commute).`;
      }
      const slots = params.toolResult.available_slots || [];
      if (slots.length === 0) {
        return `We do not have any open slots on ${params.toolArgs.date} for ${params.toolResult.visit_type || 'in-office'}. Would you like to check another day?`;
      }
      return `Available slots on ${params.toolArgs.date} (${params.toolResult.visit_type || 'in_office'}): ${slots.join(', ')}. Which time works best for you?`;
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
        return `🚨 If you are experiencing severe chest pain, shortness of breath, or an acute emergency, please call 140 (or local emergency services) or go to the nearest emergency room immediately! I have also alerted Dr. Ziad with urgent priority.`;
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
    if (isUrgentMessage(context.incomingText)) {
      context.db.conversations.updateStatus(context.conversation.id,'escalated');
      context.db.workflows.cancelActiveByCustomerId(context.customer.id);
      context.db.alerts.create({type:'human_handoff',title:'Urgent symptoms: immediate human review',details:context.incomingText,customer_id:context.customer.id});
      try {await this.notifier.notifyEscalation(context.customer,'Urgent symptoms: '+context.incomingText,'high');} catch { /* The durable alert remains available. */ }
      const lang=detectLanguage(context.incomingText);
      if (lang==='arabic') return 'قد تكون هذه حالة طارئة. اتصل فوراً بالصليب الأحمر اللبناني على 140 أو اذهب إلى أقرب قسم طوارئ. لا تنتظر الرد على واتساب. تم إيقاف الحجز للمراجعة البشرية.';
      if (lang==='arabizi') return 'Hayde momken tkoun 7aleh tari2a. D2 140 (Lebanese Red Cross) aw rou7 3a a2rab emergency room halla2. Ma tentor radd WhatsApp. Wa22afna l booking lal human review.';
      if (lang==='french') return "Cela peut ?tre une urgence. Appelez le 140 (Croix-Rouge libanaise) ou allez aux urgences imm?diatement. N'attendez pas une r?ponse WhatsApp. La r?servation est suspendue pour examen humain.";
      return 'This may be an emergency. Call 140 (Lebanese Red Cross) or go to the nearest emergency department immediately. Do not wait for a WhatsApp response. Booking is paused for human review.';
    }
    try {
      const rawReply = await this.internalProcessMessage(context);
      return sanitizeWhatsAppText(rawReply);
    } catch {
      context.db.alerts.create({type:'system_error',title:'Assistant request failed',details:'No success confirmation was sent. Review conversation.',customer_id:context.customer.id});
      return 'The assistant could not complete your request. Please try again or ask for the clinic team. No appointment change is confirmed.';
    }
  }

  private async internalProcessMessage(context: {
    customer: Customer;
    conversation: Conversation;
    incomingText: string;
    db: DatabaseContext;
  }): Promise<string> {
    const { customer, conversation, incomingText, db } = context;

    const lower = incomingText.toLowerCase();

    const choicesKey = `appointment_choices_${conversation.id}`;
    if (/\b(cancel|reschedule|move|postpone)\b/i.test(incomingText)) db.settings.delete(`additional_booking_${conversation.id}`);
    const selectedKey = `selected_appointment_${conversation.id}`;
    const upcoming = db.appointments.findUpcomingByCustomerId(customer.id);
    const action = /\b(cancel|elghe|ilgha|laghe)\b/i.test(incomingText) ? 'cancel' : /\b(reschedule|move|postpone|ghayyer)\b/i.test(incomingText) ? 'reschedule' : isAppointmentConfirmation(incomingText) ? 'confirm' : null;
    let choices: any = null;
    try { choices = JSON.parse(db.settings.get(choicesKey, 'null')); } catch {}
    if (choices && choices.expires <= Date.now()) { db.settings.delete(choicesKey); choices = null; }
    if (choices && /^\d+$/.test(incomingText.trim())) {
      const id = choices.ids[Number(incomingText.trim()) - 1];
      const appointment = upcoming.find(a => a.id === id);
      if (!appointment) return 'Please choose one of the listed upcoming appointments.';
      db.settings.set(selectedKey, appointment.id); db.settings.delete(choicesKey);
      if (choices.action === 'cancel') {
        const result = await this.executeTool({ name: 'cancel_appointment', args: { appointment_id: appointment.id, reason: 'Patient selected cancellation' } }, customer, conversation, db);
        return result.error ? `The cancellation could not be completed: ${result.error}` : `Your appointment on ${formatEnglishDate(appointment.start_time)} has been cancelled.`;
      }
      if (choices.action === 'confirm') { db.appointments.updateStatus(appointment.id, 'confirmed'); return 'Your selected appointment has been confirmed.'; }
      return 'What new day and time would you like for your selected appointment?';
    }
    if (action && upcoming.length > 1 && !upcoming.some(a => a.id === db.settings.get(selectedKey))) {
      db.settings.set(choicesKey, JSON.stringify({ action, ids: upcoming.map(a => a.id), expires: Date.now() + 30*60*1000 }));
      return `Which appointment would you like to ${action}? Reply with its number:\n${upcoming.map((a,i) => `${i+1}. ${formatEnglishDate(a.start_time,a.end_time)} (${a.visit_type === 'home_visit' ? 'Home visit' : 'Clinic'})`).join('\n')}`;
    }

    // 1. Dynamic Calendar & Time Context (Asia/Beirut Timezone)
    const now = new Date();
    const beirutNow = getBeirutTimeInfo(now);
    const todayStr = beirutNow.dateStr;
    const dayOfWeek = beirutNow.dayName;
    const timeStr = `${beirutNow.timeStr12} (${beirutNow.timeStr24} Beirut Time)`;
    
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
      const dInfo = getBeirutTimeInfo(d);
      const label = i === 0 ? ' [Today]' : i === 1 ? ' [Bkra / Tomorrow]' : '';
      upcomingScheduleDays.push(`- ${dInfo.dateStr} = ${dayNamesLeb[dInfo.dayOfWeek]}${label}`);
    }

    // 2. Check if message is directly from Doctor / Clinic Admin
    const custDigits = (customer.phone || '').replace(/\D/g, '');
    const adminDigits = ((this.notifier as any)?.adminNumber || process.env.ADMIN_WHATSAPP_NUMBER || '').replace(/\D/g, '');
    const isDoctor = Boolean(custDigits && adminDigits && (custDigits === adminDigits));

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
          const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: BEIRUT_TIMEZONE });
          const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: BEIRUT_TIMEZONE });
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

    // 3. Workflow management & history
    if (db.workflows) {
      try {
        db.workflows.expireOldWorkflows();
      } catch {}
    }
    const activeWorkflow = db.workflows ? db.workflows.findActiveByCustomerId(customer.id) : null;

    const allRecent = db.messages.getRecentMessages(conversation.id, 16);
    // Exclude only the current message at the end of the array
    const historyMessages = (allRecent.length > 0 && allRecent[allRecent.length - 1].body === incomingText)
      ? allRecent.slice(0, -1)
      : allRecent;

    const isOngoingConversation = historyMessages.length > 0;

    const rawHistory: Array<{ role: 'user' | 'model'; text: string }> = historyMessages.map((msg) => ({
      role: msg.direction === 'inbound' ? 'user' : 'model',
      text: msg.body,
    }));

    const existingAppointment = db.appointments.findLatestActiveByCustomerOrPhone(customer.id, customer.phone);

    // If the patient is requesting a BRAND NEW (additional) appointment, clear the active workflow
    // so they are asked for visit type fresh instead of inheriting the previous appointment's type.
    const isNewAppointmentRequest = /\b(new|another|additional|second|extra|tani|jdid|منفصل|جديد|اضافي)\s+(appointment|maw3ad|reservation|booking|visit|consultation)\b/i.test(incomingText) ||
      /\b(reserve|book|add|have|get)\s+(a\s+)?(new|another|additional|second|extra)\s+(appointment|maw3ad|reservation|booking|visit)\b/i.test(incomingText) ||
      /\bcan\s+i\s+(reserve|book|make|add|get|have)\s+(a\s+)?(new|another)?\s*(appointment|maw3ad)\b/i.test(incomingText);

    if (isNewAppointmentRequest && db.workflows) {
      db.settings.set(`additional_booking_${conversation.id}`,String(Date.now()+24*60*60*1000));
      // Cancel the existing booked workflow so there is no lingering visit_type assumption
      db.workflows.cancelActiveByCustomerId(customer.id);
    }

    // If customer shares a location pin and has an active booking workflow awaiting address:
    if (incomingText.includes('📍 Shared Location') && activeWorkflow && activeWorkflow.date && activeWorkflow.time && activeWorkflow.state !== 'booked') {
      const pinAddress = incomingText.match(/📍 Shared Location: ([\s\S]*?)(?:\s*\| Maps:|$)/)?.[1]?.trim() || incomingText;
      const bookingResult = await this.executeTool(
        {
          name: 'book_appointment',
          args: {
            date: activeWorkflow.date,
            time: activeWorkflow.time,
            visit_type: 'home_visit',
            service: 'Home Visit',
            address: pinAddress,
            patient_name: customer.name || undefined,
            patient_phone: customer.phone,
          },
        },
        customer,
        conversation,
        db
      );

      if (!bookingResult?.appointment_id || bookingResult.error) return `Your location was received, but the appointment could not be confirmed. ${bookingResult?.error || 'Please choose another available time.'}`;

      if (db.workflows) {
        db.workflows.transition(activeWorkflow.id, 'booked');
      }

      const isoStr = beirutDateTimeToUtc(activeWorkflow.date, activeWorkflow.time).toISOString();
      const engDate = formatEnglishDate(isoStr);
      const arDate = formatArabicDate(isoStr);
      const nameGreeting = customer.name ? `All set, ${customer.name}!` : 'All set!';
      const arabicName = customer.name ? `تم تأكيد موعدك يا ${customer.name}!` : 'تم تأكيد موعدك بنجاح!';

      return `${nameGreeting} Your home visit appointment has been confirmed with Dr. Ziad El Khoury:\n\n` +
        `📅 Date: ${engDate}\n` +
        `📍 Location: Home Visit (${pinAddress})\n\n` +
        `Dr. Ziad looks forward to visiting you!\n\n` +
        `${arabicName}\n\n` +
        `📅 الموعد: ${arDate}\n` +
        `📍 المكان: زيارة منزلية (${pinAddress})\n\n` +
        `الدكتور زياد بانتظار زيارتكم، وألف سلامة!`;
    }

    // If customer shares a location pin without an active booking in progress, and already has an active confirmed home visit appointment:
    if (incomingText.includes('📍 Shared Location') && existingAppointment && existingAppointment.visit_type === 'home_visit') {
      const pinAddress = incomingText.match(/📍 Shared Location: ([\s\S]*?)(?:\s*\| Maps:|$)/)?.[1]?.trim() || incomingText;
      if (pinAddress && existingAppointment.address !== pinAddress) {
        try {
          db.appointments.update(existingAppointment.id, { address: pinAddress });
        } catch {}
      }
      return formatExistingBookingSummary(existingAppointment, customer.name || 'Patient');
    }

    const pendingHomeVisit = extractPendingHomeVisitSelection(incomingText, historyMessages, activeWorkflow, existingAppointment?.start_time);
    if (pendingHomeVisit) {
      if (db.workflows) {
        if (activeWorkflow) {
          db.workflows.transition(activeWorkflow.id, 'awaiting_address', {
            date: pendingHomeVisit.date,
            time: pendingHomeVisit.time,
            visit_type: 'home_visit',
          });
        } else {
          db.workflows.create({
            customer_id: customer.id,
            conversation_id: conversation.id,
            date: pendingHomeVisit.date,
            time: pendingHomeVisit.time,
            visit_type: 'home_visit',
            state: 'awaiting_address',
          });
        }
      }

      const isoStr = beirutDateTimeToUtc(pendingHomeVisit.date, pendingHomeVisit.time).toISOString();
      const engDate = formatEnglishDate(isoStr);
      const arDate = formatArabicDate(isoStr);
      const nameStrEng = customer.name ? ` ${customer.name}` : '';
      const nameStrAr = customer.name ? ` يا ${customer.name}` : '';

      return `Great${nameStrEng}! I have your home visit request for ${engDate}.\n\n` +
        `Please share your home address or send a WhatsApp location pin so Dr. Ziad knows where to visit you. Once received, I will finalize the booking and send you the complete appointment summary.\n\n` +
        `ممتاز${nameStrAr}! تم تسجيل طلب الزيارة المنزلية لـ ${arDate}.\n\n` +
        `يرجى تزويدنا بعنوان المنزل أو إرسال موقعكم عبر الواتساب حتى يتمكن الدكتور زياد من زيارتكم وتأكيد الموعد فوراً.`;
    }

    const pendingInOffice = extractPendingInOfficeSelection(incomingText, historyMessages, activeWorkflow, existingAppointment?.start_time);
    if (pendingInOffice) {
      const familyMatch = incomingText.match(/\b(sister|brother|mother|father|son|daughter|wife|husband|mom|dad|طفل|ابن|بنت|زوج|زوجة|اخت|أخت|اخ|أخ|ام|أم|اب|أب)\b/i);
      const patientName = familyMatch ? `${familyMatch[0]} of ${customer.name || 'Patient'}` : (customer.name || undefined);
      const isNewAppointment = Boolean(existingAppointment) && /\b(another|additional|second|separate|sister|brother|mother|father|son|daughter|wife|husband|mom|dad|تاني|ثاني|أخرى|إضافي)\b/i.test(incomingText);

      const bookRes = await this.executeTool(
        {
          name: 'book_appointment',
          args: {
            date: pendingInOffice.date,
            time: pendingInOffice.time,
            visit_type: 'in_office',
            service: activeWorkflow?.service || 'General Consultation',
            patient_name: patientName,
            patient_phone: customer.phone,
            is_new_appointment: isNewAppointment,
          },
        },
        customer,
        conversation,
        db
      );

      if (bookRes && bookRes.error) {
        return `I am sorry, but that time slot (${pendingInOffice.date} at ${pendingInOffice.time}) is no longer available: ${bookRes.error}. Would you like to pick another time?\n\nعذراً، هذا الوقت لم يعد متاحاً. هل ترغب باختيار وقت آخر؟`;
      }

      if (activeWorkflow && db.workflows) {
        db.workflows.transition(activeWorkflow.id, 'booked');
      }

      const isoStr = beirutDateTimeToUtc(pendingInOffice.date, pendingInOffice.time).toISOString();
      const engDate = formatEnglishDate(isoStr);
      const arDate = formatArabicDate(isoStr);
      const nameGreeting = customer.name ? `All set, ${customer.name}!` : 'All set!';
      const arabicName = customer.name ? `تم تأكيد موعدك يا ${customer.name}!` : 'تم تأكيد موعدك بنجاح!';

      return `${nameGreeting} Your appointment has been confirmed with Dr. Ziad El Khoury:\n\n` +
        `📅 Date: ${engDate}\n` +
        `📍 Location: In-Office at the Clinic\n\n` +
        `We look forward to seeing you!\n\n` +
        `${arabicName}\n\n` +
        `📅 الموعد: ${arDate}\n` +
        `📍 المكان: في عيادة الدكتور زياد الخوري\n\n` +
        `أهلاً وسهلاً بكم، ونحن بانتظاركم!`;
    }

    const isNegatingHome = /\b(don'?t|not|no|mesh|msh|ma bde|ma rade|ma 7ebe|لا أريد|ما أريد|مش|لا زيارة)\b/i.test(incomingText) &&
      /\b(home visit|home|beit|zyara|manzil|منزل|منزلية|زيارة منزلية)\b/i.test(incomingText);
    const isNegatingOffice = /\b(don'?t|not|no|mesh|msh|ma bde|ma rade|ma 7ebe|لا أريد|ما أريد|مش)\b/i.test(incomingText) &&
      /\b(in[- ]?office|clinic|cabinet|bil 3iyade|3iyade|في العيادة|بالعيادة|عيادة)\b/i.test(incomingText);

    const specifiesHome = !isNegatingHome && /\b(home visit|home|beit|zyara|manzil|منزل|منزلية|زيارة منزلية)\b/i.test(incomingText) &&
      !incomingText.includes('📍 Shared Location');
    const specifiesOffice = !isNegatingOffice && /\b(in[- ]?office|clinic|cabinet|bil 3iyade|3iyade|3al 3iyade|في العيادة|بالعيادة|عيادة)\b/i.test(incomingText);

    const parsedDateTimeInAwaiting = parseDateTimeFromMessage(incomingText);
    const hasDateTimeKeywords = parsedDateTimeInAwaiting !== null ||
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|today|tomorrow|bkra|bokra|lyom|elyom|tnen|tanen|taleta|tleta|arba3a|khamis|jem3a|sabit|ahad|\d{1,2}:\d{2}|\d{1,2}\s*(am|pm))\b/i.test(incomingText);

    const hasInquiryOrActionKeywords = /\b(when|what|how|do you have|can i|could you|is there|open|available|schedule|hours|bade es2al|maftou7|ayya|ayye|fi|shou|kam|price|cost|se3er|book|reserve|maw3ad|appointment|rendez-vous|move|reschedule|change|cancel|elghe)\b/i.test(incomingText);

    const isBareHomeSelection = specifiesHome && !hasDateTimeKeywords && !hasInquiryOrActionKeywords && !pendingHomeVisit;
    const isBareOfficeSelection = specifiesOffice && !hasDateTimeKeywords && !hasInquiryOrActionKeywords && !pendingInOffice;

    if (isBareHomeSelection) {
      if (db.workflows) {
        if (activeWorkflow) {
          db.workflows.update(activeWorkflow.id, {
            visit_type: 'home_visit',
            date: null,
            time: null,
            state: 'awaiting_slot',
          });
        } else {
          db.workflows.create({
            customer_id: customer.id,
            conversation_id: conversation.id,
            visit_type: 'home_visit',
            state: 'awaiting_slot',
          });
        }
      }

      const targetDate = getBeirutTodayStr();
      const openDays = await this.scheduler.getAvailableSlotsAcrossRange(targetDate, 7, 'home_visit', 4);
      const activeWindows = openDays.filter((d) => !d.is_closed && d.free_windows.length > 0).slice(0, 4);
      const scheduleLines = activeWindows.map((d) => {
        const spans = d.free_windows.map((w) => `From ${w.from12} to ${w.to12}`).join(', ');
        const [y, m, dayNum] = d.date.split('-').map(Number);
        const dateObj = new Date(Date.UTC(y, m - 1, dayNum));
        const monthDay = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        return `• ${d.day_name}, ${monthDay}: ${spans}`;
      });

      const lang = detectLanguage(incomingText);
      if (lang === 'arabizi') {
        return `Tekram! Sajjalt 3anna ennk baddak zyara 3al beit 🏠.\n\nAyya nhar w se3a byenasbak? Haydi l mawa3eed l fadiye lal zyarat l menzeliye hal jem3a:\n${scheduleLines.join('\n')}\n\nRja2 5abberna ayya wa2et byenasbak ma3 l 3enwan aw location pin!`;
      }
      if (lang === 'arabic') {
        return `تكرم عينك! تم تسجيل رغبتكم في حجز زيارة منزلية 🏠.\n\nأي يوم ووقت يناسبكم؟ إليكم الأوقات المتاحة للزيارات منزلية هذا الأسبوع:\n${scheduleLines.join('\n')}\n\nيرجى إعلامنا باليوم والوقت المفضلين لديكم مع تزويدنا بعنوان المنزل أو إرسال موقعكم عبر الواتساب.`;
      }
      const nameStr = customer.name ? ` ${customer.name}` : '';
      return `Great${nameStr}! We have noted that you would like a Home Visit 🏠.\n\nWhich day and time works best for you? Here are our available times for home visits this week:\n${scheduleLines.join('\n')}\n\nPlease let us know your preferred day and time, along with your home address or WhatsApp location pin!`;
    }

    if (isBareOfficeSelection) {
      if (db.workflows) {
        if (activeWorkflow) {
          db.workflows.update(activeWorkflow.id, {
            visit_type: 'in_office',
            date: null,
            time: null,
            state: 'awaiting_slot',
          });
        } else {
          db.workflows.create({
            customer_id: customer.id,
            conversation_id: conversation.id,
            visit_type: 'in_office',
            state: 'awaiting_slot',
          });
        }
      }

      const targetDate = getBeirutTodayStr();
      const openDays = await this.scheduler.getAvailableSlotsAcrossRange(targetDate, 7, 'in_office', 4);
      const activeWindows = openDays.filter((d) => !d.is_closed && d.free_windows.length > 0).slice(0, 4);
      const scheduleLines = activeWindows.map((d) => {
        const spans = d.free_windows.map((w) => `From ${w.from12} to ${w.to12}`).join(', ');
        const [y, m, dayNum] = d.date.split('-').map(Number);
        const dateObj = new Date(Date.UTC(y, m - 1, dayNum));
        const monthDay = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        return `• ${d.day_name}, ${monthDay}: ${spans}`;
      });

      const lang = detectLanguage(incomingText);
      if (lang === 'arabizi') {
        return `Tekram! Sajjalt 3anna ennk baddak maw3ad bil 3iyade 🏢.\n\nAyya nhar w se3a byenasbak? Haydi l mawa3eed l fadiye bil 3iyade hal jem3a:\n${scheduleLines.join('\n')}\n\nRja2 na22e l wa2et li byenasbak!`;
      }
      if (lang === 'arabic') {
        return `تكرم عينك! تم تسجيل رغبتكم في حجز استشارة في العيادة 🏢.\n\nأي يوم ووقت يناسبكم؟ إليكم الأوقات المتاحة في العيادة هذا الأسبوع:\n${scheduleLines.join('\n')}\n\nيرجى اختيار اليوم والوقت الأنسب لكم!`;
      }
      const nameStr = customer.name ? ` ${customer.name}` : '';
      return `Great${nameStr}! We have noted that you would like an **In-Office consultation at our clinic** 🏢.\n\nWhich day and time works best for you? Here are our available clinic hours this week:\n${scheduleLines.join('\n')}\n\nPlease choose a day and time that works best for you!`;
    }

    // When awaiting visit type (clinic vs home visit), if patient gives an affirmative response (yes/sure/confirm/ok) without specifying:
    if (activeWorkflow && activeWorkflow.state === 'awaiting_visit_type' && activeWorkflow.date && activeWorkflow.time) {
      const cleanUpper = incomingText.trim().toUpperCase();
      const isAffirmative = /^(YES|CONFIRM|TAMAM|OK|SURE|PLEASE|OUI|AKID|YEP|YUP|AH|EHH|تمام|نعم|أكيد|اي|أي|موافق|تأكيد)$/i.test(cleanUpper) ||
        /^(YES PLEASE|CONFIRM PLEASE|OK PLEASE|TAMAM PLEASE)$/i.test(cleanUpper);
      const specifiesOffice = /\b(in[- ]?office|clinic|cabinet|bil 3iyade|3iyade|3al 3iyade|في العيادة|بالعيادة|عيادة)\b/i.test(incomingText);
      const specifiesHome = /\b(home visit|home|beit|zyara|manzil|منزل|منزلية|زيارة منزلية)\b/i.test(incomingText);

      if (isAffirmative && !specifiesOffice && !specifiesHome) {
        const isoStr = beirutDateTimeToUtc(activeWorkflow.date, activeWorkflow.time).toISOString();
        const engDate = formatEnglishDate(isoStr);
        const arDate = formatArabicDate(isoStr);
        return `We have reserved ${engDate} for you! To finalize your booking, please let us know: would you prefer an in-office consultation at the clinic or a home visit?\n\nلقد حجزنا موعد ${arDate} من أجلكم! لتأكيد الحجز، يرجى إعلامنا هل تفضلون أن يكون الموعد في العيادة أم زيارة منزلية؟`;
      }
    }

    // Text address for home visit awaiting address
    if (activeWorkflow && activeWorkflow.state === 'awaiting_address' && activeWorkflow.date && activeWorkflow.time) {
      if (/^(?:(?:yes|ok|okay|sure|confirm|thank you|thanks|merci|merci beaucoup|tamam|shukran|شكراً|شكرا|نعم|تمام|أكيد)(?:\s+(?:please|thanks|thank you|doctor))?)[.!\s]*$/i.test(incomingText.trim())) {
        return 'Please share your home address or send a WhatsApp location pin to complete your home visit booking.';
      }
      if (hasDateTimeKeywords && parsedDateTimeInAwaiting && db.workflows) {
        // Patient selected a different slot while in awaiting_address
        db.workflows.update(activeWorkflow.id, {
          date: parsedDateTimeInAwaiting.date || activeWorkflow.date,
          time: parsedDateTimeInAwaiting.time || activeWorkflow.time,
          state: 'awaiting_address',
        });
      } else if (!incomingText.includes('📍 Shared Location') && !hasDateTimeKeywords && !/\b(cancel|reschedule|change|no|stop|ghayyer|elghe)\b/i.test(incomingText)) {
        const address = incomingText.trim().replace(/^(?:my\s+)?(?:home\s+)?address\s*(?:is\s+|:\s*)/i,'').trim();
        const bookRes = await this.executeTool(
          {
            name: 'book_appointment',
            args: {
              date: activeWorkflow.date,
              time: activeWorkflow.time,
              visit_type: 'home_visit',
              service: activeWorkflow.service || 'Home Visit Care',
              address,
              patient_name: customer.name || undefined,
              patient_phone: customer.phone,
            },
          },
          customer,
          conversation,
          db
        );

        if (bookRes && bookRes.error) {
          return `I am sorry, but that time slot (${activeWorkflow.date} at ${activeWorkflow.time}) is no longer available: ${bookRes.error}. Would you like to pick another time?\n\nعذراً، هذا الوقت لم يعد متاحاً: ${bookRes.error}. هل ترغب باختيار وقت آخر؟`;
        }

        if (db.workflows) {
          db.workflows.transition(activeWorkflow.id, 'booked');
        }

        const isoStr = beirutDateTimeToUtc(activeWorkflow.date, activeWorkflow.time).toISOString();
        const engDate = formatEnglishDate(isoStr);
        const arDate = formatArabicDate(isoStr);
        const nameGreeting = customer.name ? `All set, ${customer.name}!` : 'All set!';
        const arabicName = customer.name ? `تم تأكيد موعدك يا ${customer.name}!` : 'تم تأكيد موعدك بنجاح!';

        return `${nameGreeting} Your home visit appointment has been confirmed with Dr. Ziad El Khoury:\n\n` +
          `📅 Date: ${engDate}\n` +
          `📍 Location: Home Visit (${address})\n\n` +
          `Dr. Ziad looks forward to visiting you!\n\n` +
          `${arabicName}\n\n` +
          `📅 الموعد: ${arDate}\n` +
          `📍 المكان: زيارة منزلية (${address})\n\n` +
          `الدكتور زياد بانتظار زيارتكم، وألف سلامة!`;
      }
    }

    const locationBookingArgs = extractLocationBookingArgs(incomingText, historyMessages, customer, activeWorkflow);

    let contextSystemPrompt = isDoctor
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

OFFICIAL CLINIC PRACTICE RULES:
- Dr. Ziad offers in-office consultations at the clinic and home visits.
- DO NOT mention fees, prices, or money ($) to patients.
- DO NOT ask the patient to pick medical services. Simply schedule an appointment with Dr. Ziad (in-office or home visit).
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

    const conversationTranscript = historyMessages.length > 0
      ? 'CONVERSATION TRANSCRIPT SO FAR:\n' + historyMessages.map((m) => `${m.direction === 'inbound' ? 'Patient' : 'Assistant (Clinic)'}: ${m.body}`).join('\n\n')
      : '';

    if (conversationTranscript) {
      contextSystemPrompt += `\n\n${conversationTranscript}\n- Always take the above conversation history into account when understanding patient intent and picking tool arguments.`;
    }

    if (existingAppointment) {
      const existingDateEng = formatEnglishDate(existingAppointment.start_time);
      const existingType = existingAppointment.visit_type === 'home_visit' ? 'Home Visit' : 'In-Office Consultation';
      contextSystemPrompt += `\n\nEXISTING UPCOMING APPOINTMENT ON FILE:
- Patient ${customer.name || ''} ALREADY HAS a confirmed upcoming ${existingType} with Dr. Ziad on ${existingDateEng}${existingAppointment.address ? ` (Address: ${existingAppointment.address})` : ''} (ID: ${existingAppointment.id}).
- RECOGNITION & POSTPONEMENT / RESCHEDULING RULE:
  * When this patient explicitly reaches out to MOVE, RESCHEDULE, CHANGE, or POSTPONE:
    - Recognize that they want to reschedule their existing ${existingDateEng} visit.
    - Call 'reschedule_appointment' so the old slot is freed up and the new slot is confirmed!
  * When this patient asks for another day/time (e.g. "Can I book for Wednesday...", "at 1 pm", etc.) WITHOUT explicitly asking to move:
    - Check availability for the requested time.
    - Naturally acknowledge their existing appointment:
      English: "I see you currently have an appointment confirmed on ${existingDateEng}. Would you like to move that appointment to [New Date/Time], or would you like to schedule an additional separate appointment?"
      Arabic: "نرى أن لديكم موعداً مسجلاً يوم [التاريخ القديم]. هل ترغبون بنقل هذا الموعد إلى [الموعد الجديد] أم حجز موعد إضافي منفصل؟"
  * When the patient specifies they want an ADDITIONAL / NEW appointment:
    - Call 'book_appointment' with 'is_new_appointment': true. Do NOT cancel or move the existing appointment.
  * If the appointment is a home visit, their address (${existingAppointment.address || 'Address on file'}) is already on file, so you can offer to keep the same address unless they provide a new one or a new location pin.`;
    }

    if (isOngoingConversation) {
      contextSystemPrompt += `\n\nCONVERSATION CONTINUATION RULES:
- You have ALREADY greeted this patient in an earlier message.
- DO NOT repeat the clinic opening greeting or bilingual welcome. DO NOT say "Hello [Name]! Welcome to Dr. Ziad..." or "أهلاً وسهلاً بكم في عيادة الدكتور زياد الخوري".
- Continue the ongoing conversation directly, naturally, and concisely.
- Do NOT re-ask for the appointment time if already discussed.`;
    }

    if (activeWorkflow && activeWorkflow.date && activeWorkflow.time) {
      contextSystemPrompt += `\n- CURRENT ACTIVE APPOINTMENT IN DISCUSSION: The patient is currently scheduling for ${activeWorkflow.date} at ${activeWorkflow.time} (State: ${activeWorkflow.state}, Visit type: ${activeWorkflow.visit_type || 'unconfirmed'}). Keep this time in mind!`;
    }

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
    console.log('[agent] Operation recorded');
    const geminiRes = locationBookingArgs
      ? { toolCalls: [{ name: 'book_appointment', args: locationBookingArgs }] }
      : await this.client.generateResponse({
        systemPrompt: contextSystemPrompt,
        conversationHistory,
        incomingMessage: incomingText,
        tools: AGENT_TOOLS,
      });

    if (geminiRes.text && (!geminiRes.toolCalls || geminiRes.toolCalls.length === 0)) {
      console.log('[agent] Operation recorded');

      if (/confirm|booked|rescheduled|cancelled|canceled|تأكيد|حجز|تعديل|إلغاء/i.test(geminiRes.text)) {
        return 'No appointment change has been confirmed. Please tell us your preferred date, time, and clinic or home visit.';
      }
      const requested=parseDateTimeFromMessage(incomingText);
      if (requested?.date && requested.time && db.workflows) {
        if (activeWorkflow) db.workflows.update(activeWorkflow.id,{date:requested.date,time:requested.time,state:'awaiting_visit_type'});
        else db.workflows.create({customer_id:customer.id,conversation_id:conversation.id,date:requested.date,time:requested.time,state:'awaiting_visit_type'});
      }
      return geminiRes.text;
    }

    if (!geminiRes.toolCalls || geminiRes.toolCalls.length === 0) {
      if (isOngoingConversation) {
        const lang = detectLanguage(incomingText);
        if (lang === 'arabizi') {
          return "Tekram! Ayya nhar w se3a byenasbak kermel nshouflak l mawa3eed l fadiye, aw baddak t7ajez bil 3iyade aw zyara 3al beit?";
        }
        if (lang === 'arabic') {
          return "تكرم عينك! يرجى إعلامنا باليوم والوقت الذي يناسبك، وهل تفضل الموعد في العيادة أم زيارة منزلية؟";
        }
        return "I would be happy to help! Which day and time works best for you, and would you prefer an in-office consultation or a home visit?";
      }

      const nameGreeting = customer.name ? `Hello ${customer.name}!` : 'Hello!';
      const arabicGreeting = customer.name ? `أهلاً وسهلاً بك ${customer.name} في عيادة الدكتور زياد الخوري.` : 'أهلاً وسهلاً بكم في عيادة الدكتور زياد الخوري.';
      return `${nameGreeting} Welcome to Dr. Ziad El Khoury's clinic.\n\nHow can we help you today? Would you like to check available appointments for an in-office consultation or a home visit?\n\n${arabicGreeting}\nكيف يمكننا مساعدتكم اليوم؟ هل ترغبون في معرفة المواعيد المتاحة لزيارة العيادة أو لزيارة منزلية؟`;
    }

    // 5. Deterministic tool execution
    if (geminiRes.toolCalls.length !== 1) return 'Please request one appointment action at a time. No changes were made.';
    let toolCall = geminiRes.toolCalls[0];
    console.log('[agent] Operation recorded');
    let toolResult = await this.executeTool(toolCall, customer, conversation, db);
    console.log('[agent] Operation recorded');

    // Smart auto-booking / auto-rescheduling chain: If check_availability was called, but the patient explicitly asked to book or move a specific slot
    if (toolCall.name === 'check_availability' && toolResult && Array.isArray(toolResult.available_slots)) {
      const parsedSlot = parseDateTimeFromMessage(incomingText) || extractSlotFromText(incomingText);
      const isSameTimePhrase = /\b(same time|same slot|same hour|nafs el wa2et|nafs l wa2et|nafs lwa2et|نفس الوقت|نفس الساعة)\b/i.test(incomingText);
      const isRescheduleIntent = isSameTimePhrase || /\b(move|reschedule|change|postpone|ghayyer|bade 8ayer|badal|te2jeel)\b/i.test(incomingText);
      const isBookingIntent = /\b(book|maw3ad|appointment|rendez-vous|visit|clinic|in-office|home visit|consultation|se3a|at \d)\b/i.test(incomingText);
      
      // If patient said "same time" and has an existing appointment, inherit its time
      let reqTime = parsedSlot?.time;
      if (!reqTime && isSameTimePhrase && existingAppointment) {
        const existingD = new Date(existingAppointment.start_time);
        reqTime = getBeirutTimeInfo(existingD).timeStr24;
      }

      const isAvailable = reqTime && toolResult.available_slots.includes(reqTime);
      const isHome = /\b(home visit|home|beit|zyara|منزل|زيارة منزلية)\b/i.test(incomingText);
      const isOffice = /\b(in[- ]?office|clinic|cabinet|bil 3iyade|3iyade|3al 3iyade|بالعيادة|في العيادة|عيادة)\b/i.test(incomingText);
      const specifiedVisitType: VisitType | null = isHome ? 'home_visit' : (isOffice ? 'in_office' : null);
      const hasRequiredInfo = specifiedVisitType === 'in_office' || (specifiedVisitType === 'home_visit' && (customer.address || incomingText.includes('📍')));

      console.log('[agent] Operation recorded');

      if (existingAppointment && isRescheduleIntent && isAvailable) {
        console.log('[agent] Operation recorded');
        toolCall = {
          name: 'reschedule_appointment',
          args: {
            new_date: toolCall.args.date || parsedSlot?.date,
            new_time: reqTime,
            visit_type: specifiedVisitType || existingAppointment.visit_type,
          },
        };
        toolResult = await this.executeTool(toolCall, customer, conversation, db);
        console.log('[agent] Operation recorded');
      } else if (isBookingIntent && isAvailable && specifiedVisitType && hasRequiredInfo) {
        console.log('[agent] Operation recorded');
        const familyMatch = incomingText.match(/\b(sister|brother|mother|father|son|daughter|wife|husband|mom|dad|طفل|ابن|بنت|زوج|زوجة|اخت|أخت|اخ|أخ|ام|أم|اب|أب)\b/i);
        const patientName = familyMatch ? `${familyMatch[0]} of ${customer.name || 'Patient'}` : customer.name;
        const isNewAppointment = Boolean(existingAppointment) && /\b(another|additional|second|separate|sister|brother|mother|father|son|daughter|wife|husband|mom|dad|تاني|ثاني|أخرى|إضافي)\b/i.test(incomingText);

        toolCall = {
          name: 'book_appointment',
          args: {
            date: toolCall.args.date || parsedSlot?.date,
            time: reqTime,
            visit_type: specifiedVisitType,
            service: specifiedVisitType === 'home_visit' ? 'Home Visit Care' : 'General Consultation',
            patient_name: patientName,
            patient_phone: customer.phone,
            address: specifiedVisitType === 'home_visit' ? (customer.address || 'Address on file') : undefined,
            is_new_appointment: isNewAppointment,
          },
        };
        toolResult = await this.executeTool(toolCall, customer, conversation, db);
        console.log('[agent] Operation recorded');
      } else if (specifiedVisitType === 'home_visit' && !hasRequiredInfo && parsedSlot && db.workflows) {
        const targetDate = toolCall.args.date || parsedSlot.date;
        const targetTime = reqTime || parsedSlot.time;
        if (targetDate && targetTime) {
          if (activeWorkflow) {
            db.workflows.update(activeWorkflow.id, {
              date: targetDate,
              time: targetTime,
              visit_type: 'home_visit',
              state: 'awaiting_address',
            });
          } else {
            db.workflows.create({
              customer_id: customer.id,
              conversation_id: conversation.id,
              date: targetDate,
              time: targetTime,
              visit_type: 'home_visit',
              state: 'awaiting_address',
            });
          }
        }
      } else if (!specifiedVisitType && parsedSlot && db.workflows) {
        const targetDate = toolCall.args.date || parsedSlot.date;
        const targetTime = reqTime || parsedSlot.time;
        if (targetDate && targetTime) {
          if (activeWorkflow) {
            db.workflows.update(activeWorkflow.id, {
              date: targetDate,
              time: targetTime,
              state: 'awaiting_visit_type',
            });
          } else {
            db.workflows.create({
              customer_id: customer.id,
              conversation_id: conversation.id,
              date: targetDate,
              time: targetTime,
              state: 'awaiting_visit_type',
            });
          }
        }
      }
    }

    // 6. Draft grounded reply from backend tool result
    if (toolResult && toolResult.error) {
      console.warn('[agent] Operation requires review');
      if (toolCall.name === 'book_appointment') {
        return `I apologize, but we could not confirm that appointment: ${toolResult.error}. Would you like to select another available opening?\n\nعذراً، لم نتمكن من تأكيد هذا الموعد: ${toolResult.error}. هل ترغب باختيار وقت آخر متاح؟`;
      }
      if (toolCall.name === 'reschedule_appointment') {
        return `I apologize, but we could not update your appointment: ${toolResult.error}. Would you like to pick another available opening?\n\nعذراً، لم نتمكن من تعديل الموعد: ${toolResult.error}. هل ترغب باختيار وقت آخر متاح؟`;
      }
      if (toolCall.name === 'cancel_appointment') {
        return `We could not cancel the appointment at this time: ${toolResult.error}. Please let us know if you need assistance.\n\nلم نتمكن من إلغاء الموعد: ${toolResult.error}.`;
      }
    }

    if (['book_appointment','reschedule_appointment','cancel_appointment'].includes(toolCall.name)) {
      return this.client.getFallbackToolReply({toolName:toolCall.name,toolArgs:toolCall.args,toolResult,userQuery:incomingText});
    }

    console.log('[agent] Operation recorded');
    try {
      let reply = await this.client.generateReplyFromToolResult({
        systemPrompt: contextSystemPrompt,
        userQuery: incomingText,
        toolName: toolCall.name,
        toolArgs: toolCall.args,
        toolResult,
        conversationTranscript,
      });

      if (!reply || !reply.trim()) {
        console.warn('[agent] Operation requires review');
        reply = this.client.getFallbackToolReply({
          toolName: toolCall.name,
          toolArgs: toolCall.args,
          toolResult,
          userQuery: incomingText,
        });
      }

      // 🛡️ ANTI-HALLUCINATION GUARD:
      if (toolCall.name === 'check_availability' && /confirmed|booked|rescheduled|cancelled|تأكيد|حجز|تعديل|إلغاء/i.test(reply)) {
        reply=this.client.getFallbackToolReply({toolName:toolCall.name,toolArgs:toolCall.args,toolResult,userQuery:incomingText});
      }

      if (toolCall.name === 'check_availability') {
        const slot = parseDateTimeFromMessage(incomingText, existingAppointment?.start_time ? new Date(existingAppointment.start_time) : new Date()) ||
          extractSlotFromText(incomingText, existingAppointment?.start_time);

        const targetDate = toolCall.args?.date || slot?.date;
        const targetTime = slot?.time;

        if (targetDate && targetTime && db.workflows) {
          const currentWf = db.workflows.findActiveByCustomerId(customer.id);
          if (currentWf) {
            db.workflows.update(currentWf.id, {
              date: targetDate,
              time: targetTime,
              state: currentWf.visit_type ? currentWf.state : 'awaiting_visit_type',
            });
          } else {
            db.workflows.create({
              customer_id: customer.id,
              conversation_id: conversation.id,
              date: targetDate,
              time: targetTime,
              state: 'awaiting_visit_type',
            });
          }
        }
      }

      return reply;
    } catch (draftErr) {
      console.warn('[agent] Operation requires review');
      const fallbackReply = this.client.getFallbackToolReply({
        toolName: toolCall.name,
        toolArgs: toolCall.args,
        toolResult,
        userQuery: incomingText,
      });

      if (toolCall.name === 'check_availability') {
        const slot = parseDateTimeFromMessage(incomingText, existingAppointment?.start_time ? new Date(existingAppointment.start_time) : new Date()) ||
          extractSlotFromText(incomingText, existingAppointment?.start_time);

        const targetDate = toolCall.args?.date || slot?.date;
        const targetTime = slot?.time;

        if (targetDate && targetTime && db.workflows) {
          const currentWf = db.workflows.findActiveByCustomerId(customer.id);
          if (currentWf) {
            db.workflows.update(currentWf.id, {
              date: targetDate,
              time: targetTime,
              state: currentWf.visit_type ? currentWf.state : 'awaiting_visit_type',
            });
          } else {
            db.workflows.create({
              customer_id: customer.id,
              conversation_id: conversation.id,
              date: targetDate,
              time: targetTime,
              state: 'awaiting_visit_type',
            });
          }
        }
      }

      return fallbackReply;
    }
  }

  private async executeTool(
    toolCall: ToolCall,
    customer: Customer,
    conversation: Conversation,
    db: DatabaseContext
  ): Promise<any> {
    const { name, args } = toolCall;
    if (!AGENT_TOOLS.some(tool=>tool.name===name) || !args || typeof args!=='object' || Array.isArray(args)) return {error:'Invalid tool request'};
    for (const [key,value] of Object.entries(args)) {
      if (typeof value==='string' && value.length>5000) return {error:'Tool argument exceeds maximum length'};
      if (['days_ahead','duration_minutes'].includes(key) && (!Number.isInteger(value) || Number(value)<1 || Number(value)>(key==='days_ahead' ? 31 : 480))) return {error:'Invalid '+key+' range'};
      if (['date','new_date'].includes(key) && (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))) return {error:'Invalid date'};
      if (['time','new_time'].includes(key) && (typeof value!=='string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))) return {error:'Invalid time'};
      if (key==='visit_type' && value!=null && !['home_visit','in_office'].includes(String(value))) return {error:'Invalid visit type'};
    }

    switch (name) {
      case 'check_availability': {
        const activeWf = db.workflows ? db.workflows.findActiveByCustomerId(customer.id) : null;
        let explicitVisitType: VisitType | null = null;

        // Only inherit visit type from args (Gemini explicitly chose it), never from prior workflow
        // when the patient is requesting a NEW appointment — they need to be asked fresh.
        const isNewAppointmentRequest = args.is_new_appointment === true ||
          /\b(new|another|additional|second|extra|tani|jdid|منفصل|جديد|اضافي)\b/i.test(args.patient_message || '');

        if (args.visit_type === 'home_visit' || args.visit_type === 'in_office') {
          explicitVisitType = args.visit_type;
        } else if (!isNewAppointmentRequest && (activeWf?.visit_type === 'home_visit' || activeWf?.visit_type === 'in_office')) {
          explicitVisitType = activeWf.visit_type;
        }

        const targetDate = args.date || getBeirutTodayStr();
        const daysAhead = args.days_ahead || 7;
        const duration = Number(args.duration_minutes) || 60;

        if (explicitVisitType) {
          const slots = await this.scheduler.getAvailableSlots(targetDate, explicitVisitType, duration);
          const upcomingOpenDays = await this.scheduler.getAvailableSlotsAcrossRange(targetDate, daysAhead, explicitVisitType, 4);

          if (db.workflows && args.date) {
            const currentWf = db.workflows.findActiveByCustomerId(customer.id);
            if (currentWf) {
              db.workflows.update(currentWf.id, {
                date: args.date,
                visit_type: explicitVisitType,
                state: explicitVisitType === 'home_visit' ? 'awaiting_address' : currentWf.state,
              });
            } else {
              db.workflows.create({
                customer_id: customer.id,
                conversation_id: conversation.id,
                date: args.date,
                visit_type: explicitVisitType,
                state: explicitVisitType === 'home_visit' ? 'awaiting_address' : 'slot_selected',
              });
            }
          }

          return {
            date: targetDate,
            visit_type: explicitVisitType,
            visit_type_specified: true,
            available_slots: slots,
            free_windows: computeFreeWindows(slots, this.scheduler['defaultSlotDurationMinutes'] ?? 60),
            upcoming_open_days: upcomingOpenDays,
          };
        } else {
          // Visit type is unknown: home visit and in-office have different schedules due to road travel buffers!
          const inOfficeSlots = await this.scheduler.getAvailableSlots(targetDate, 'in_office');
          const homeVisitSlots = await this.scheduler.getAvailableSlots(targetDate, 'home_visit');
          const upcomingInOffice = await this.scheduler.getAvailableSlotsAcrossRange(targetDate, daysAhead, 'in_office', 4);
          const upcomingHomeVisit = await this.scheduler.getAvailableSlotsAcrossRange(targetDate, daysAhead, 'home_visit', 4);

          if (db.workflows && args.date) {
            const currentWf = db.workflows.findActiveByCustomerId(customer.id);
            if (currentWf) {
              db.workflows.update(currentWf.id, {
                date: args.date,
                visit_type: null,
                state: 'awaiting_visit_type',
              });
            } else {
              db.workflows.create({
                customer_id: customer.id,
                conversation_id: conversation.id,
                date: args.date,
                visit_type: undefined,
                state: 'awaiting_visit_type',
              });
            }
          }

          return {
            date: targetDate,
            visit_type: null,
            visit_type_specified: false,
            instruction: 'Patient has not selected in-office vs home visit. Because home visits require commute buffers, available hours differ. Ask the patient if they prefer an in-office consultation at the clinic or a home visit so you can provide the exact schedule.',
            in_office: {
              available_slots: inOfficeSlots,
              free_windows: computeFreeWindows(inOfficeSlots, this.scheduler['defaultSlotDurationMinutes'] ?? 60),
              upcoming_open_days: upcomingInOffice,
            },
            home_visit: {
              available_slots: homeVisitSlots,
              free_windows: computeFreeWindows(homeVisitSlots, this.scheduler['defaultSlotDurationMinutes'] ?? 60),
              upcoming_open_days: upcomingHomeVisit,
            },
            available_slots: inOfficeSlots,
            free_windows: computeFreeWindows(inOfficeSlots, this.scheduler['defaultSlotDurationMinutes'] ?? 60),
            upcoming_open_days: upcomingInOffice,
          };
        }
      }

      case 'book_appointment': {
        try {
          const visitType: VisitType = args.visit_type === 'home_visit' ? 'home_visit' : 'in_office';
          if (visitType === 'home_visit' && !args.address) {
            const pending=db.workflows.findActiveByCustomerId(customer.id);
            const details={date:args.date,time:args.time,visit_type:'home_visit' as const,service:args.service || 'Home Visit'};
            if(pending) db.workflows.transition(pending.id,'awaiting_address',details);
            else db.workflows.create({customer_id:customer.id,conversation_id:conversation.id,state:'awaiting_address',...details});
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
          const startD = beirutDateTimeToUtc(args.date, args.time);
          if (isNaN(startD.getTime())) {
            return { error: 'Invalid date or time provided. Please check the requested time.' };
          }
          const startTimeIso = startD.toISOString();

          const patientName = args.patient_name || args.customer_name || customer.name;
          const patientPhone = customer.phone;

          if (patientName && !args.is_new_appointment && !patientName.includes(' of ') && (!customer.name || customer.name === 'Patient' || customer.name === 'Unknown' || customer.name.startsWith('+'))) {
            db.customers.updateName(customer.id, patientName);
            customer.name = patientName;
          }

          let combinedNotes = args.notes || null;
          if (args.patient_phone && args.patient_phone !== customer.phone) {
            combinedNotes = combinedNotes ? `${combinedNotes} | Contact Phone: ${args.patient_phone}` : `Contact Phone: ${args.patient_phone}`;
          }

          // If customer ALREADY has an active confirmed appointment on a different date/time,
          // treat booking as moving / rescheduling their existing appointment UNLESS they requested a new / additional appointment!
          const additionalKey=`additional_booking_${conversation.id}`;
          if(Number(db.settings.get(additionalKey,'0'))>Date.now() && db.workflows.findActiveByCustomerId(customer.id)) args.is_new_appointment=true;
          const activeAppt = this.selectedAppointment(customer, conversation, db, args.appointment_id, args.is_new_appointment === true);
          const lastInbound = db.messages.getRecentMessages(conversation.id, 2).reverse().find((m) => m.direction === 'inbound')?.body || '';
          const isExplicitNew = args.is_new_appointment === true ||
            Boolean(args.patient_name && args.patient_name.includes(' of ')) ||
            /\b(new|another|second|extra|additional|sister|brother|mother|father|son|daughter|wife|husband|mom|dad|tani|jdid|منفصل|جديد|اضافي|أخرى|إضافي|اخت|أخت|اخ|أخ)\b/i.test(lastInbound);
          if (activeAppt && activeAppt.id && activeAppt.start_time !== startTimeIso && !isExplicitNew) {
            const oldTime = activeAppt.start_time;
            const resched = await this.scheduler.rescheduleAppointment({
              appointmentId: activeAppt.id,
              newStartTime: startTimeIso,
              visitType,
              address: args.address || activeAppt.address || null,
            });

            await this.notifier.notifyReschedule(resched, customer, oldTime);

            if (db.workflows) {
              const activeWf = db.workflows.findActiveByCustomerId(customer.id);
              if (activeWf) {
                db.workflows.transition(activeWf.id, 'booked', {
                  appointment_id: resched.id,
                  date: args.date,
                  time: args.time,
                  visit_type: resched.visit_type,
                  address: resched.address,
                  service: resched.service,
                  price: resched.price,
                });
              }
            }

            return {
              status: 'success',
              rescheduled: true,
              appointment_id: resched.id,
              service: resched.service,
              visit_type: resched.visit_type,
              address: resched.address,
              start_time: resched.start_time,
              old_start_time: oldTime,
              price: resched.price,
            };
          }

          const durationMins = Number(args.duration_minutes) || serviceItem.duration || 60;
          const endTimeIso = new Date(new Date(startTimeIso).getTime() + durationMins * 60 * 1000).toISOString();

          const appt = await this.scheduler.bookAppointment({
            customerId: customer.id,
            customerPhone: patientPhone,
            customerName: patientName,
            visitType,
            address: args.address || null,
            service: args.service || serviceItem.name,
            price: serviceItem.price,
            startTime: startTimeIso,
            endTime: endTimeIso,
            notes: combinedNotes,
          });

          db.settings.delete(additionalKey);
          // Update workflow state to booked
          if (db.workflows) {
            const activeWf = db.workflows.findActiveByCustomerId(customer.id);
            if (activeWf) {
              db.workflows.transition(activeWf.id, 'booked', {
                appointment_id: appt.id,
                date: args.date,
                time: args.time,
                visit_type: appt.visit_type,
                address: appt.address,
                service: appt.service,
                price: appt.price,
              });
            } else {
              db.workflows.create({
                customer_id: customer.id,
                conversation_id: conversation.id,
                state: 'booked',
                appointment_id: appt.id,
                date: args.date,
                time: args.time,
                visit_type: appt.visit_type,
                address: appt.address,
                service: appt.service,
                price: appt.price,
              });
            }
          }

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
          const activeAppt = this.selectedAppointment(customer, conversation, db, args.appointment_id);
          if (!activeAppt) {
            return { error: 'No upcoming active appointment found to reschedule.' };
          }

          const newStartD = beirutDateTimeToUtc(args.new_date, args.new_time);
          if (isNaN(newStartD.getTime())) {
            return { error: 'Invalid date or time provided. Please check the requested time.' };
          }
          const newStartIso = newStartD.toISOString();
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
          const activeAppt = this.selectedAppointment(customer, conversation, db, args.appointment_id);
          if (!activeAppt) {
            return { error: 'No upcoming active appointment found to cancel.' };
          }

          const cancelled = await this.scheduler.cancelAppointment(activeAppt.id, args.reason);
          db.settings.delete(`selected_appointment_${conversation.id}`);
          await this.notifier.notifyCancellation(cancelled, customer, args.reason);

          if (db.workflows) {
            db.workflows.cancelActiveByCustomerId(customer.id);
          }

          const todayStr = getBeirutTodayStr();
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

  private selectedAppointment(customer: Customer, conversation: Conversation, db: DatabaseContext, requestedId?: string, creatingNew = false): Appointment | null {
    const upcoming = db.appointments.findUpcomingByCustomerId(customer.id);
    if (creatingNew) return null;
    const selected = requestedId || db.settings.get(`selected_appointment_${conversation.id}`, '');
    if (selected) {
      const appointment = upcoming.find(a => a.id === selected);
      if (!appointment) throw new Error('The selected appointment does not belong to this patient or is no longer active.');
      return appointment;
    }
    if (upcoming.length > 1) throw new Error('Please specify which appointment you want to change.');
    return upcoming[0] || null;
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
