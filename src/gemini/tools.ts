import { FunctionDeclaration, Type as SchemaType } from '@google/genai';

export const CLINIC_SERVICES = [
  { name: 'Physiotherapy & Rehabilitation', duration: 60, price: 120, description: 'Physiotherapy, musculoskeletal rehab, and manual therapy.' },
  { name: 'General Consultation', duration: 60, price: 120, description: 'Comprehensive medical review and consultation.' },
  { name: 'Follow-up Consultation', duration: 30, price: 70, description: 'Follow-up on previous treatments or test results.' },
  { name: 'Home Visit Care', duration: 60, price: 180, description: 'Doctor travels to patient home for examination and treatment.' },
  { name: 'Acupuncture / Therapy', duration: 60, price: 130, description: 'Therapeutic treatment session.' },
];

export const CLINIC_POLICIES = {
  hours: 'Custom clinic schedule configured weekly by Dr. Ziad.',
  cancellationPolicy: 'Appointments can be cancelled or rescheduled up to 2 hours before the scheduled time with no penalty.',
  emergencyPolicy: 'In case of severe acute medical emergencies, please call Lebanese Red Cross (140) or visit the nearest ER immediately.',
};

export const CHECK_AVAILABILITY_TOOL: FunctionDeclaration = {
  name: 'check_availability',
  description: 'Checks available appointment time slots for a specific date or across upcoming days and weeks for in-office or home visits.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      date: {
        type: SchemaType.STRING,
        description: 'Target date in YYYY-MM-DD format (e.g. 2026-09-15). If the customer asks for next week or general availability, provide the starting date.',
      },
      visit_type: {
        type: SchemaType.STRING,
        description: 'Either "in_office" or "home_visit". Pass "home_visit" if the customer asked for home visit, or "in_office" if they asked for clinic/office consultation. If the customer has NOT yet specified whether they want in-office or home visit, omit or leave null so availability is calculated for both.',
      },
      days_ahead: {
        type: SchemaType.NUMBER,
        description: 'Number of upcoming days to check for open slots (e.g. 7 or 14 for next week inquiries). Default is 7.',
      },
      duration_minutes: {
        type: SchemaType.NUMBER,
        description: 'Duration of the appointment in minutes. Default is 60 minutes. Do not pass 30 unless the user explicitly requested a short 30-minute follow-up.',
      },
    },
    required: ['date'],
  },
};

export const BOOK_APPOINTMENT_TOOL: FunctionDeclaration = {
  name: 'book_appointment',
  description: 'Books an appointment for the customer. Deterministically creates calendar event and DB record.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      date: {
        type: SchemaType.STRING,
        description: 'Date of appointment in YYYY-MM-DD format.',
      },
      time: {
        type: SchemaType.STRING,
        description: 'Start time of appointment in HH:mm 24-hour format (e.g. "10:00" or "14:30").',
      },
      visit_type: {
        type: SchemaType.STRING,
        description: 'Either "in_office" or "home_visit".',
      },
      duration_minutes: {
        type: SchemaType.NUMBER,
        description: 'Duration of the appointment in minutes. Default is 60 (standard). Use 30 for quick follow-ups, 90 or 120 for extended sessions.',
      },
      service: {
        type: SchemaType.STRING,
        description: 'Name of the service (e.g. "General Consultation", "Home Visit Care"). Defaults to "General Consultation" or "Home Visit Care" if omitted.',
      },
      patient_name: {
        type: SchemaType.STRING,
        description: 'Full name of the patient (e.g. John Doe).',
      },
      patient_phone: {
        type: SchemaType.STRING,
        description: 'Contact phone number of the patient (e.g. +961 71 123 456 or alternate mobile).',
      },
      address: {
        type: SchemaType.STRING,
        description: 'Physical address of the patient. MANDATORY if visit_type is "home_visit".',
      },
      notes: {
        type: SchemaType.STRING,
        description: 'Any special symptoms, medical notes, or directives provided by the patient.',
      },
      is_new_appointment: {
        type: SchemaType.BOOLEAN,
        description: 'Set to true if the patient explicitly wants a new/additional appointment rather than rescheduling an existing one.',
      },
    },
    required: ['date', 'time', 'visit_type'],
  },
};

export const RESCHEDULE_APPOINTMENT_TOOL: FunctionDeclaration = {
  name: 'reschedule_appointment',
  description: 'Reschedules the customer’s existing upcoming active appointment to a new date and time.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      new_date: {
        type: SchemaType.STRING,
        description: 'New appointment date in YYYY-MM-DD format.',
      },
      new_time: {
        type: SchemaType.STRING,
        description: 'New appointment start time in HH:mm format.',
      },
      visit_type: {
        type: SchemaType.STRING,
        description: 'Optional updated visit type ("in_office" or "home_visit").',
      },
      address: {
        type: SchemaType.STRING,
        description: 'Updated home address if moving to or updating home visit.',
      },
    },
    required: ['new_date', 'new_time'],
  },
};

export const CANCEL_APPOINTMENT_TOOL: FunctionDeclaration = {
  name: 'cancel_appointment',
  description: 'Cancels the customer’s existing upcoming appointment.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      reason: {
        type: SchemaType.STRING,
        description: 'Reason for cancellation given by the customer.',
      },
    },
    required: [],
  },
};

export const ESCALATE_TO_HUMAN_TOOL: FunctionDeclaration = {
  name: 'escalate_to_human',
  description: 'Escalates the conversation to the doctor or staff when a human is requested or when unsure.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      reason: {
        type: SchemaType.STRING,
        description: 'Why human escalation is needed.',
      },
      urgency: {
        type: SchemaType.STRING,
        description: 'Urgency level: "low", "medium", or "high".',
      },
    },
    required: ['reason'],
  },
};

export const GET_SERVICES_AND_POLICIES_TOOL: FunctionDeclaration = {
  name: 'get_services_and_policies',
  description: 'Retrieves official clinic services, pricing, business hours, and cancellation policy.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {},
  },
};

export const AGENT_TOOLS = [
  CHECK_AVAILABILITY_TOOL,
  BOOK_APPOINTMENT_TOOL,
  RESCHEDULE_APPOINTMENT_TOOL,
  CANCEL_APPOINTMENT_TOOL,
  ESCALATE_TO_HUMAN_TOOL,
  GET_SERVICES_AND_POLICIES_TOOL,
];
