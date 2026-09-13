import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';
import { Customer, Appointment, AvailabilityRule, AvailabilityOverride, Invoice, Message, PendingBookingWorkflow } from '../types/index.js';

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;
  if (config.supabaseUrl && config.supabaseServiceRoleKey) {
    try {
      supabaseClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
      console.log('⚡ [Supabase] Connected to live cloud database:', config.supabaseUrl);
    } catch (err) {
      console.error('⚠️ [Supabase] Failed to initialize Supabase client:', err);
    }
  }
  return supabaseClient;
}

export class SupabaseSync {
  private static get client() {
    return getSupabaseClient();
  }

  public static async hydrateFromSupabase(db: any): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      // 1. Hydrate customers
      const { data: customers } = await client.from('customers').select('*');
      if (customers) {
        const remoteCustIds = new Set(customers.map((c) => c.id));
        const localCusts = db.appDb.db.prepare('SELECT id FROM customers').all() as any[];
        for (const lc of localCusts) {
          if (!remoteCustIds.has(lc.id)) {
            try {
              db.appDb.db.prepare('DELETE FROM customers WHERE id = ?').run(lc.id);
            } catch {}
          }
        }

        const stmt = db.appDb.db.prepare(`
          INSERT INTO customers (id, phone, name, opted_out, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            phone = excluded.phone,
            name = coalesce(excluded.name, customers.name),
            opted_out = excluded.opted_out,
            updated_at = excluded.updated_at
        `);
        for (const c of customers) {
          try {
            stmt.run(c.id, c.phone, c.name || null, c.opted_out ? 1 : 0, c.created_at, c.updated_at);
          } catch {}
        }
      }

      // 2. Hydrate appointments
      const { data: appointments } = await client.from('appointments').select('*');
      if (appointments) {
        const remoteApptIds = new Set(appointments.map((a) => a.id));
        const localAppts = db.appDb.db.prepare('SELECT id FROM appointments').all() as any[];
        for (const la of localAppts) {
          if (!remoteApptIds.has(la.id)) {
            try {
              db.appDb.db.prepare('DELETE FROM appointments WHERE id = ?').run(la.id);
            } catch {}
          }
        }

        const stmt = db.appDb.db.prepare(`
          INSERT INTO appointments (
            id, customer_id, visit_type, address, service, price,
            start_time, end_time, status, google_event_id,
            reminder_24h_sent, reminder_1h_sent, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            customer_id = excluded.customer_id,
            visit_type = excluded.visit_type,
            address = excluded.address,
            service = excluded.service,
            price = excluded.price,
            start_time = excluded.start_time,
            end_time = excluded.end_time,
            status = excluded.status,
            google_event_id = excluded.google_event_id,
            reminder_24h_sent = excluded.reminder_24h_sent,
            reminder_1h_sent = excluded.reminder_1h_sent,
            notes = excluded.notes,
            updated_at = excluded.updated_at
        `);
        for (const a of appointments) {
          try {
            stmt.run(
              a.id,
              a.customer_id,
              a.visit_type,
              a.address || null,
              a.service,
              a.price,
              a.start_time,
              a.end_time,
              a.status,
              a.google_event_id || null,
              a.reminder_24h_sent ? 1 : 0,
              a.reminder_1h_sent ? 1 : 0,
              a.notes || null,
              a.created_at,
              a.updated_at
            );
          } catch {}
        }
      }

      // 3. Hydrate availability_rules
      const { data: rules } = await client.from('availability_rules').select('*');
      if (rules && rules.length > 0) {
        for (const r of rules) {
          try {
            db.availability.updateRule(Number(r.day_of_week), r.start_time, r.end_time, Boolean(r.is_active), r.shifts);
          } catch {}
        }
      }

      // 4. Hydrate availability_overrides
      const { data: overrides } = await client.from('availability_overrides').select('*');
      if (overrides && overrides.length > 0) {
        for (const ov of overrides) {
          try {
            db.availability.setOverride({
              date: ov.date,
              is_unavailable: Boolean(ov.is_unavailable),
              start_time: ov.start_time || undefined,
              end_time: ov.end_time || undefined,
              reason: ov.reason || undefined,
              shifts: ov.shifts || undefined,
            });
          } catch {}
        }
      }

      // 5. Hydrate settings
      const { data: settings } = await client.from('settings').select('*');
      if (settings && settings.length > 0) {
        for (const s of settings) {
          try {
            db.settings.set(s.key, s.value);
          } catch {}
        }
      }

      // 6. Hydrate pending_booking_workflows
      if (db.workflows) {
        try {
          const { data: workflows } = await client.from('pending_booking_workflows').select('*');
          if (workflows && workflows.length > 0) {
            const stmt = db.appDb.db.prepare(`
              INSERT INTO pending_booking_workflows (
                id, customer_id, conversation_id, state, date, time, service, price,
                visit_type, address, location_lat, location_lng, last_message_sid,
                appointment_id, version, expires_at, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                state = excluded.state,
                date = excluded.date,
                time = excluded.time,
                service = excluded.service,
                price = excluded.price,
                visit_type = excluded.visit_type,
                address = excluded.address,
                location_lat = excluded.location_lat,
                location_lng = excluded.location_lng,
                last_message_sid = excluded.last_message_sid,
                appointment_id = excluded.appointment_id,
                version = excluded.version,
                expires_at = excluded.expires_at,
                updated_at = excluded.updated_at
            `);
            for (const wf of workflows) {
              try {
                stmt.run(
                  wf.id,
                  wf.customer_id,
                  wf.conversation_id,
                  wf.state,
                  wf.date || null,
                  wf.time || null,
                  wf.service || null,
                  wf.price != null ? Number(wf.price) : null,
                  wf.visit_type || null,
                  wf.address || null,
                  wf.location_lat != null ? Number(wf.location_lat) : null,
                  wf.location_lng != null ? Number(wf.location_lng) : null,
                  wf.last_message_sid || null,
                  wf.appointment_id || null,
                  Number(wf.version || 1),
                  wf.expires_at,
                  wf.created_at,
                  wf.updated_at
                );
              } catch {}
            }
          }
        } catch {}
      }

      console.log(`⚡ [Supabase] Hydrated local database with ${customers?.length || 0} customers and ${appointments?.length || 0} appointments from cloud.`);
    } catch (err) {
      console.error('⚠️ [Supabase] Error hydrating local database from cloud:', err);
    }
  }

  public static async syncCustomer(customer: Customer): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      const { data: existing } = await client
        .from('customers')
        .select('id, phone')
        .eq('phone', customer.phone)
        .maybeSingle();

      if (existing && existing.id !== customer.id) {
        await client.from('customers').update({
          name: customer.name,
          opted_out: customer.opted_out ? 1 : 0,
          updated_at: customer.updated_at,
        }).eq('id', existing.id);
        return;
      }

      await client.from('customers').upsert({
        id: customer.id,
        phone: customer.phone,
        name: customer.name,
        opted_out: customer.opted_out ? 1 : 0,
        created_at: customer.created_at,
        updated_at: customer.updated_at,
      });
    } catch (err) {
      console.error('⚠️ [Supabase] Error syncing customer:', err);
    }
  }

  public static async syncAppointment(appt: Appointment): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      // Ensure customer exists in Supabase first
      const { data: cust } = await client.from('customers').select('id').eq('id', appt.customer_id).maybeSingle();
      if (!cust) {
        await client.from('customers').upsert({
          id: appt.customer_id,
          phone: `whatsapp:+${appt.id.replace(/\D/g, '').slice(0, 10) || '0000000000'}`,
          name: 'Patient',
          opted_out: 0,
          created_at: appt.created_at,
          updated_at: appt.updated_at,
        });
      }

      await client.from('appointments').upsert({
        id: appt.id,
        customer_id: appt.customer_id,
        visit_type: appt.visit_type,
        address: appt.address,
        service: appt.service,
        price: appt.price,
        start_time: appt.start_time,
        end_time: appt.end_time,
        status: appt.status,
        google_event_id: appt.google_event_id,
        reminder_24h_sent: appt.reminder_24h_sent ? 1 : 0,
        reminder_1h_sent: appt.reminder_1h_sent ? 1 : 0,
        notes: appt.notes,
        created_at: appt.created_at,
        updated_at: appt.updated_at,
      });
    } catch (err) {
      console.error('⚠️ [Supabase] Error syncing appointment:', err);
    }
  }

  public static async syncAvailabilityRule(rule: AvailabilityRule): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      await client.from('availability_rules').upsert({
        id: `rule-${rule.day_of_week}`,
        day_of_week: rule.day_of_week,
        start_time: rule.start_time,
        end_time: rule.end_time,
        is_active: rule.is_active ? 1 : 0,
        shifts: rule.shifts || null,
      }, { onConflict: 'day_of_week' });
    } catch (err) {
      console.error('⚠️ [Supabase] Error syncing availability rule:', err);
    }
  }

  public static async syncAvailabilityRules(rules: AvailabilityRule[]): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      const payloads = rules.map((rule) => ({
        id: `rule-${rule.day_of_week}`,
        day_of_week: rule.day_of_week,
        start_time: rule.start_time,
        end_time: rule.end_time,
        is_active: rule.is_active ? 1 : 0,
        shifts: rule.shifts || null,
      }));
      await client.from('availability_rules').upsert(payloads, { onConflict: 'day_of_week' });
    } catch (err) {
      console.error('⚠️ [Supabase] Error batch syncing availability rules:', err);
    }
  }

  public static async syncOverride(ov: AvailabilityOverride): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      await client.from('availability_overrides').upsert({
        id: ov.id,
        date: ov.date,
        is_unavailable: ov.is_unavailable ? 1 : 0,
        start_time: ov.start_time || null,
        end_time: ov.end_time || null,
        reason: ov.reason || null,
        shifts: ov.shifts || null,
      }, { onConflict: 'date' });
    } catch (err) {
      console.error('⚠️ [Supabase] Error syncing override:', err);
    }
  }

  public static async deleteOverride(id: string): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      await client.from('availability_overrides').delete().eq('id', id);
    } catch (err) {
      console.error('⚠️ [Supabase] Error deleting override:', err);
    }
  }

  public static async syncInvoice(inv: Invoice): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      const { data: appt } = await client.from('appointments').select('id').eq('id', inv.appointment_id).maybeSingle();
      if (!appt) {
        console.warn(`[Supabase] Appointment ${inv.appointment_id} does not exist in Supabase yet. Skipping invoice sync.`);
        return;
      }
      await client.from('invoices').upsert({
        id: inv.id,
        appointment_id: inv.appointment_id,
        customer_id: inv.customer_id,
        service_description: inv.service_description,
        amount: inv.amount,
        currency: inv.currency,
        status: inv.status,
        payment_link: inv.payment_link,
        created_at: inv.created_at,
        paid_at: inv.paid_at,
      });
    } catch (err) {
      console.error('⚠️ [Supabase] Error syncing invoice:', err);
    }
  }

  public static async syncSetting(key: string, value: string): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      await client.from('settings').upsert({ key, value });
    } catch (err) {
      console.error('⚠️ [Supabase] Error syncing setting:', err);
    }
  }

  public static async syncConversation(conv: { id: string; customer_id: string; channel?: string; status?: string; created_at: string; updated_at: string }): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      await client.from('conversations').upsert({
        id: conv.id,
        customer_id: conv.customer_id,
        status: conv.status || 'active',
        created_at: conv.created_at,
        updated_at: conv.updated_at,
      });
    } catch (err) {
      console.warn('⚠️ [Supabase] Error syncing conversation:', err);
    }
  }

  public static async syncWorkflow(wf: PendingBookingWorkflow): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      // Ensure customer exists in Supabase first
      const { data: cust } = await client.from('customers').select('id').eq('id', wf.customer_id).maybeSingle();
      if (!cust) {
        await client.from('customers').upsert({
          id: wf.customer_id,
          phone: `whatsapp:+${wf.id.replace(/\D/g, '').slice(0, 10) || '0000000000'}`,
          name: 'Patient',
          opted_out: 0,
          created_at: wf.created_at,
          updated_at: wf.updated_at,
        });
      }

      // Ensure conversation exists in Supabase
      await client.from('conversations').upsert({
        id: wf.conversation_id,
        customer_id: wf.customer_id,
        status: 'active',
        created_at: wf.created_at,
        updated_at: wf.updated_at,
      });

      const { error } = await client.from('pending_booking_workflows').upsert({
        id: wf.id,
        customer_id: wf.customer_id,
        conversation_id: wf.conversation_id,
        state: wf.state,
        date: wf.date || null,
        time: wf.time || null,
        service: wf.service || null,
        price: wf.price != null ? Number(wf.price) : null,
        visit_type: wf.visit_type || null,
        address: wf.address || null,
        location_lat: wf.location_lat != null ? Number(wf.location_lat) : null,
        location_lng: wf.location_lng != null ? Number(wf.location_lng) : null,
        last_message_sid: wf.last_message_sid || null,
        appointment_id: wf.appointment_id || null,
        version: wf.version,
        expires_at: wf.expires_at,
        created_at: wf.created_at,
        updated_at: wf.updated_at,
      });
      if (error) {
        console.warn('⚠️ [Supabase] Workflow sync warning:', error.message);
      }
    } catch (err) {
      console.warn('⚠️ [Supabase] Note: Pending workflow sync skipped or failed:', err);
    }
  }
}
