import { FunctionDeclaration, SchemaType } from '@google/generative-ai';

export const CLINIC_SERVICES = [
  { name: 'General Consultation', duration: 60, price: 120, description: 'Comprehensive medical review and consultation.' },
  { name: 'Follow-up Consultation', duration: 30, price: 70, description: 'Follow-up on previous treatments or test results.' },
  { name: 'Home Visit Care', duration: 60, price: 180, description: 'Doctor travels to patient home for examination and treatment.' },
  { name: 'Acupuncture / Therapy', duration: 60, price: 130, description: 'Therapeutic treatment session.' },
];

export const CLINIC_POLICIES = {
  hours: 'Monday to Friday, 09:00 to 17:00. Closed on weekends and official holidays.',
  cancellationPolicy: 'Appointments can be cancelled or rescheduled up to 2 hours before the scheduled time with no penalty.',
  emergencyPolicy: 'In case of severe acute medical emergencies, please call emergency services (911) or visit the nearest ER immediately.',
};

export const CHECK_AVAILABILITY_TOOL: FunctionDeclaration = {
  name: 'check_availability',
  description: 'Checks available appointment time slots for a specific date and visit type (in_office or home_visit).',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      date: {
        type: SchemaType.STRING,
        description: 'The date to check in YYYY-MM-DD format (e.g. 2026-09-10).',
      },
      visit_type: {
        type: SchemaType.STRING,
        description: 'Either "in_office" or "home_visit". Defaults to "in_office".',
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
      service: {
        type: SchemaType.STRING,
        description: 'Name of the service (e.g. "General Consultation", "Home Visit Care").',
      },
      address: {
        type: SchemaType.STRING,
        description: 'Physical address of the patient. MANDATORY if visit_type is "home_visit".',
      },
      notes: {
        type: SchemaType.STRING,
        description: 'Any special symptoms or notes provided by the customer.',
      },
    },
    required: ['date', 'time', 'visit_type', 'service'],
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
