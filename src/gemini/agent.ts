import { GoogleGenerativeAI } from '@google/generative-ai';
import { Customer, Conversation, Appointment, VisitType } from '../types/index.js';
import { DatabaseContext } from '../db/index.js';
import { SchedulingEngine } from '../calendar/scheduler.js';
import { AdminNotificationService } from '../notifications/admin.notifier.js';
import { AGENT_TOOLS, CLINIC_SERVICES, CLINIC_POLICIES } from './tools.js';
import { SYSTEM_PROMPT } from './prompts.js';
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

  generateRescheduleOutreach(params: {
    customerName: string;
    appointment: {
      service: string;
      start_time: string;
      visit_type: string;
      address?: string | null;
    };
    doctorPrompt?: string;
    suggestedSlots?: string[];
  }): Promise<string>;
}

export class LiveGeminiClient implements GeminiClient {
  private genAI: GoogleGenerativeAI;
  private modelName: string;

  constructor(apiKey: string, modelName: string = process.env.GEMINI_MODEL || 'gemini-3.6-flash') {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelName = modelName;
  }

  public async generateResponse(params: {
    systemPrompt: string;
    conversationHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text?: string }> }>;
    incomingMessage: string;
    tools: any[];
  }): Promise<{ text?: string; toolCalls?: ToolCall[] }> {
    return withRetry(async () => {
      const model = this.genAI.getGenerativeModel({
        model: this.modelName,
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

      return {
        text: response.text(),
      };
    });
  }

  public async generateReplyFromToolResult(params: {
    systemPrompt: string;
    userQuery: string;
    toolName: string;
    toolArgs: any;
    toolResult: any;
  }): Promise<string> {
    return withRetry(async () => {
      const model = this.genAI.getGenerativeModel({
        model: this.modelName,
        systemInstruction: params.systemPrompt,
      });

      const prompt = `
The patient sent: "${params.userQuery}"
You executed the tool "${params.toolName}" with arguments: ${JSON.stringify(params.toolArgs)}.
The backend result is:
${JSON.stringify(params.toolResult, null, 2)}

Draft a natural, warm, and concise WhatsApp reply to the patient based on this result.
Guidelines:
- Sound like a real clinic receptionist texting on WhatsApp.
- Keep it concise (1 to 3 short sentences).
- If slots are available, suggest 2 or 3 convenient open times naturally and ask which one works best.
- If an appointment was confirmed, state the confirmed day, time, service, and location clearly.
- If it's a home visit and their full address is missing, politely ask for their full street address, building, and area.
- NEVER sound like an AI. Avoid robotic bulleted questionnaires.
`;

      const result = await model.generateContent(prompt);
      return result.response.text();
    });
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
    suggestedSlots?: string[];
  }): Promise<string> {
    return withRetry(async () => {
      const model = this.genAI.getGenerativeModel({
        model: this.modelName,
        systemInstruction: SYSTEM_PROMPT,
      });

      const prompt = `
We need to reschedule an upcoming appointment with a patient.
Patient Name: ${params.customerName}
Current Appointment: ${params.appointment.service} at ${params.appointment.start_time} (${params.appointment.visit_type === 'home_visit' ? 'Home Visit' : 'In-Office'})
Reason / Context: ${params.doctorPrompt || 'There is an unexpected schedule conflict and we need to move this appointment.'}
Suggested Alternate Slots: ${params.suggestedSlots && params.suggestedSlots.length > 0 ? params.suggestedSlots.join(', ') : 'Ask patient for their preferred days/times'}

Write a polite, warm, and apologetic WhatsApp message to the patient.
Explain the need to reschedule, propose the alternatives or ask when they are free, and invite them to reply directly with what works best for them.
Keep it natural, professional, and concise for WhatsApp.
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

    if (lower.includes('human') || lower.includes('person') || lower.includes('speak with doctor')) {
      return {
        toolCalls: [
          {
            name: 'escalate_to_human',
            args: { reason: 'Customer requested human assistance', urgency: 'medium' },
          },
        ],
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
      text: "Hello! How can Dr. Smith's medical office assist you today?",
    };
  }

  public async generateReplyFromToolResult(params: {
    systemPrompt: string;
    userQuery: string;
    toolName: string;
    toolArgs: any;
    toolResult: any;
  }): Promise<string> {
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
      return `I've connected you with our clinic staff. A team member will contact you shortly!`;
    }

    if (params.toolName === 'get_services_and_policies') {
      return `We offer General Consultations ($120), Follow-ups ($70), Home Visits ($180), and Therapy ($130). We are open Mon-Fri 9:00-17:00.`;
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
    suggestedSlots?: string[];
  }): Promise<string> {
    const slots = params.suggestedSlots && params.suggestedSlots.length > 0
      ? ` Here are suggested open times: ${params.suggestedSlots.join(', ')}.`
      : '';
    const reason = params.doctorPrompt ? ` (${params.doctorPrompt})` : '';
    return `Hello ${params.customerName}, we need to reschedule your ${params.appointment.service} appointment on ${params.appointment.start_time}${reason}.${slots} Please reply with your preferred day and time!`;
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

    // 1. Check explicit human escalation trigger
    const lower = incomingText.toLowerCase();
    if (
      lower.includes('human') ||
      lower.includes('speak with person') ||
      lower.includes('real person') ||
      lower.includes('talk to doctor directly')
    ) {
      return this.executeEscalation(customer, conversation, db, 'Customer asked for human explicitly', 'medium');
    }

    // 2. Dynamic Calendar & Time Context
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    const contextSystemPrompt = `${SYSTEM_PROMPT}

CURRENT SYSTEM CONTEXT:
- Today's date: ${todayStr} (${dayOfWeek})
- Current time: ${timeStr}
- Patient Name: ${customer.name || 'Patient'}
- Patient Phone: ${customer.phone}`;

    // 3. Build sanitized, alternating conversation history
    const recentMessages = db.messages.getRecentMessages(conversation.id, 16);
    const rawHistory: Array<{ role: 'user' | 'model'; text: string }> = [];

    for (const msg of recentMessages) {
      if (msg.body === incomingText) continue; // skip current
      rawHistory.push({
        role: msg.direction === 'inbound' ? 'user' : 'model',
        text: msg.body,
      });
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
    const reply = await this.client.generateReplyFromToolResult({
      systemPrompt: contextSystemPrompt,
      userQuery: incomingText,
      toolName: toolCall.name,
      toolArgs: toolCall.args,
      toolResult,
    });

    return reply;
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
        const slots = await this.scheduler.getAvailableSlots(args.date, visitType);
        return {
          date: args.date,
          visit_type: visitType,
          available_slots: slots,
        };
      }

      case 'book_appointment': {
        try {
          const visitType: VisitType = args.visit_type === 'home_visit' ? 'home_visit' : 'in_office';
          if (visitType === 'home_visit' && !args.address) {
            return { error: 'Home address is required for booking a home visit. Please provide your address.' };
          }

          const serviceItem = CLINIC_SERVICES.find((s) => s.name.toLowerCase() === (args.service || '').toLowerCase()) || CLINIC_SERVICES[0];
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
          const activeAppt = db.appointments.findLatestActiveByCustomerId(customer.id);
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
          const activeAppt = db.appointments.findLatestActiveByCustomerId(customer.id);
          if (!activeAppt) {
            return { error: 'No upcoming active appointment found to cancel.' };
          }

          const cancelled = await this.scheduler.cancelAppointment(activeAppt.id, args.reason);
          await this.notifier.notifyCancellation(cancelled, customer, args.reason);

          return {
            status: 'success',
            appointment_id: cancelled.id,
            start_time: cancelled.start_time,
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
        return {
          services: CLINIC_SERVICES,
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
    urgency: string
  ): Promise<string> {
    db.conversations.updateStatus(conversation.id, 'escalated');
    db.alerts.create({
      type: 'human_handoff',
      title: `Human Escalation: ${customer.name || customer.phone}`,
      details: reason,
      customer_id: customer.id,
    });
    await this.notifier.notifyEscalation(customer, reason, urgency);
    return "I have informed Dr. Smith and our clinic team. A team member will reach out to you directly as soon as possible.";
  }
}
