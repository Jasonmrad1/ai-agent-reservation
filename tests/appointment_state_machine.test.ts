import { clinicIso } from './clinic-time.js';
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, AppInstance } from '../src/app.js';
import { createDatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { MockGeminiClient } from '../src/gemini/agent.js';

describe('🏛️ DURABLE APPOINTMENT STATE MACHINE & PERSISTED WORKFLOWS', () => {
  let appInstance: AppInstance;
  let gateway: MockWhatsAppGateway;
  let calendar: InMemoryCalendarProvider;
  let geminiClient: MockGeminiClient;

  const ADMIN_SECRET = 'dr_ziad_secret_2026';
  const CLINIC_WHATSAPP = 'whatsapp:+14155238886';
  const DOCTOR_PHONE = 'whatsapp:+96171476193';
  const PATIENT_PHONE = 'whatsapp:+96170112233';
  const PATIENT_NAME = 'Jason Bourne';

  beforeEach(() => {
    const db = createDatabaseContext(':memory:');
    gateway = new MockWhatsAppGateway();
    calendar = new InMemoryCalendarProvider();
    geminiClient = new MockGeminiClient();

    appInstance = createApp({
      config: {
        port: 3000,
        databaseUrl: ':memory:',
        adminSessionSecret: ADMIN_SECRET,
        adminWhatsappNumber: DOCTOR_PHONE,
        twilioWhatsappNumber: CLINIC_WHATSAPP,
        homeVisitBufferMinutes: 30,
        nodeEnv: 'test',
      },
      db,
      gateway,
      calendar,
      geminiClient,
      skipSignatureVerification: true,
    });
  });

  it('1. Persists active workflow state transitions across steps', async () => {
    const { db } = appInstance;
    const customer = db.customers.findOrCreate(PATIENT_PHONE, PATIENT_NAME);
    const conversation = db.conversations.getOrCreateActive(customer.id);

    // Initial creation: collecting preferences
    const wf = db.workflows.create({
      customer_id: customer.id,
      conversation_id: conversation.id,
      state: 'collecting_preferences',
      date: '2026-09-25',
      time: '11:00',
    });

    expect(wf.id).toBeDefined();
    expect(wf.state).toBe('collecting_preferences');
    expect(wf.version).toBe(1);

    // Transition to awaiting_visit_type
    const t1 = db.workflows.transition(wf.id, 'awaiting_visit_type');
    expect(t1?.state).toBe('awaiting_visit_type');
    expect(t1?.version).toBe(2);

    // Transition to awaiting_address
    const t2 = db.workflows.transition(wf.id, 'awaiting_address', {
      visit_type: 'home_visit',
    });
    expect(t2?.state).toBe('awaiting_address');
    expect(t2?.visit_type).toBe('home_visit');
    expect(t2?.version).toBe(3);

    // Transition to ready_to_book with location pin
    const t3 = db.workflows.transition(wf.id, 'ready_to_book', {
      address: '📍 Shared Location: Beirut Central District (GPS: 33.8938, 35.5018)',
      location_lat: 33.8938,
      location_lng: 35.5018,
    });
    expect(t3?.state).toBe('ready_to_book');
    expect(t3?.address).toContain('Beirut Central District');
    expect(t3?.location_lat).toBe(33.8938);

    // Transition to booked
    const t4 = db.workflows.transition(wf.id, 'booked', {
      appointment_id: 'appt-12345',
    });
    expect(t4?.state).toBe('booked');
    expect(t4?.appointment_id).toBe('appt-12345');

    // Once booked, findActive returns null because workflow is finished
    const active = db.workflows.findActiveByCustomerId(customer.id);
    expect(active).toBeNull();
  });

  it('2. End-to-end multi-turn booking survives with persisted workflow and separate location pin', async () => {
    const { app, db } = appInstance;

    // Step 1: Patient asks for a slot
    geminiClient.mockReplyText = 'Wednesday, September 23 at 12:00 PM is available. Would you prefer in-office or home visit?';
    await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        Body: 'Can I book September 23 from 12 to 1?',
        MessageSid: 'SM_TURN_01',
        ProfileName: PATIENT_NAME,
      });

    // Check active workflow in database
    const customer = db.customers.findByPhone(PATIENT_PHONE)!;
    const wf1 = db.workflows.findActiveByCustomerId(customer.id);
    expect(wf1).toBeDefined();
    expect(wf1?.date).toBe('2026-09-23');
    expect(wf1?.time).toBe('12:00');
    expect(wf1?.state).toBe('awaiting_visit_type');

    // Step 2: Patient says "home visit"
    gateway.clear();
    geminiClient.mockReplyText = null;
    const res2 = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        Body: 'home visit please',
        MessageSid: 'SM_TURN_02',
        ProfileName: PATIENT_NAME,
      });

    expect(res2.status).toBe(200);
    expect(gateway.sentMessages[0].body).toContain('Sep 23');
    expect(gateway.sentMessages[0].body).toContain('12:00 PM');
    expect(gateway.sentMessages[0].body).toMatch(/address|location pin/i);

    const wf2 = db.workflows.findActiveByCustomerId(customer.id);
    expect(wf2?.state).toBe('awaiting_address');
    expect(wf2?.visit_type).toBe('home_visit');

    // Step 3: Location pin arrives as a separate message
    gateway.clear();
    const res3 = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        Body: '',
        Latitude: '33.8938',
        Longitude: '35.5018',
        Address: 'Hamra Street, Beirut',
        Label: 'Jason Home',
        MessageSid: 'SM_TURN_03',
        ProfileName: PATIENT_NAME,
      });

    expect(res3.status).toBe(200);
    const patientReply = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(patientReply?.body).toMatch(/confirmed|appointment/i);

    // Verified appointment created in DB
    const appts = db.appointments.listUpcoming(10);
    expect(appts).toHaveLength(1);
    expect(appts[0].visit_type).toBe('home_visit');
    expect(appts[0].start_time).toBe(clinicIso('2026-09-23T12:00:00.000Z'));
    expect(appts[0].address).toContain('Jason Home');

    // Active workflow transitioned to booked
    const wf3 = db.workflows.findActiveByCustomerId(customer.id);
    expect(wf3).toBeNull(); // No active pending workflow left

    const allWf = db.workflows.listAll();
    expect(allWf[0].state).toBe('booked');
    expect(allWf[0].appointment_id).toBe(appts[0].id);
  });

  it('3. Replaces address and returns confirmed summary on subsequent/updated location pin', async () => {
    const { app, db } = appInstance;

    // Direct booking tool call
    geminiClient.mockToolCall = {
      name: 'book_appointment',
      args: {
        date: '2026-09-24',
        time: '10:00',
        visit_type: 'home_visit',
        service: 'Home Visit Care',
        address: '📍 Shared Location: Old Pin (GPS: 33.8800, 35.5000)',
        customer_name: PATIENT_NAME,
      },
    };

    await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        Body: 'Book home visit for Thursday at 10am',
        MessageSid: 'SM_PIN_01',
        ProfileName: PATIENT_NAME,
      });

    const appts = db.appointments.listUpcoming(10);
    expect(appts).toHaveLength(1);
    expect(appts[0].address).toContain('Old Pin');

    // Customer sends updated location pin
    gateway.clear();
    geminiClient.mockToolCall = null;
    const res = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        Body: '',
        Latitude: '33.8999',
        Longitude: '35.5111',
        Address: 'Updated Pin Address',
        Label: 'New Villa Pin',
        MessageSid: 'SM_PIN_02',
        ProfileName: PATIENT_NAME,
      });

    expect(res.status).toBe(200);
    expect(gateway.sentMessages[0].body).toContain('already been confirmed');

    // The appointment in DB was updated with the newest pin!
    const updatedAppts = db.appointments.listUpcoming(10);
    expect(updatedAppts).toHaveLength(1);
    expect(updatedAppts[0].address).toContain('New Villa Pin');
  });

  it('4. Expires stale workflows past the 24-hour TTL', () => {
    const { db } = appInstance;
    const customer = db.customers.findOrCreate(PATIENT_PHONE, PATIENT_NAME);
    const conversation = db.conversations.getOrCreateActive(customer.id);

    // Create workflow with past expiry
    const wf = db.workflows.create({
      customer_id: customer.id,
      conversation_id: conversation.id,
      state: 'awaiting_address',
      date: '2026-09-20',
      time: '14:00',
      ttlHours: -2, // Expired 2 hours ago
    });

    const expiredCount = db.workflows.expireOldWorkflows();
    expect(expiredCount).toBeGreaterThanOrEqual(1);

    const refreshed = db.workflows.findById(wf.id);
    expect(refreshed?.state).toBe('expired');

    const active = db.workflows.findActiveByCustomerId(customer.id);
    expect(active).toBeNull();
  });

  it('5. Cancels active workflow when patient cancels', async () => {
    const { app, db } = appInstance;
    const customer = db.customers.findOrCreate(PATIENT_PHONE, PATIENT_NAME);
    const conversation = db.conversations.getOrCreateActive(customer.id);

    db.workflows.create({
      customer_id: customer.id,
      conversation_id: conversation.id,
      state: 'awaiting_address',
      date: '2026-09-25',
      time: '15:00',
    });

    expect(db.workflows.findActiveByCustomerId(customer.id)).not.toBeNull();

    // Patient sends cancellation
    geminiClient.mockToolCall = {
      name: 'cancel_appointment',
      args: { reason: 'Changed mind' },
    };

    // First book an appointment so cancel_appointment has something to cancel
    await db.appointments.create({
      customer_id: customer.id,
      visit_type: 'in_office',
      service: 'General Consultation',
      price: 120,
      start_time: clinicIso('2026-09-25T15:00:00.000Z'),
      end_time: clinicIso('2026-09-25T15:45:00.000Z'),
    });

    await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        Body: 'Please cancel my appointment',
        MessageSid: 'SM_CANCEL_01',
        ProfileName: PATIENT_NAME,
      });

    const active = db.workflows.findActiveByCustomerId(customer.id);
    expect(active).toBeNull();
  });
});
