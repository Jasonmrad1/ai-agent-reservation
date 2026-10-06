import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';
import { Customer, Appointment, AvailabilityRule, AvailabilityOverride, Invoice, Message, PendingBookingWorkflow } from '../types/index.js';

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(cfg:{supabaseUrl?:string;supabaseServiceRoleKey?:string}=config):SupabaseClient|null {
  if(!cfg.supabaseUrl || !cfg.supabaseServiceRoleKey) return null;
  return createClient(cfg.supabaseUrl,cfg.supabaseServiceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
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


  private static async upsert(table:string,payload:any,onConflict='id'):Promise<void> {
    const client=this.client;if(!client) return;
    const result=await client.from(table).upsert(payload,{onConflict});if(result.error) throw new Error(result.error.message);
  }
  public static syncCustomer(customer:Customer) {return this.upsert('customers',{...customer,opted_out:customer.opted_out ? 1 : 0});}
  public static syncAppointment(appt:Appointment) {return this.upsert('appointments',{...appt,reminder_24h_sent:appt.reminder_24h_sent ? 1 : 0,reminder_1h_sent:appt.reminder_1h_sent ? 1 : 0});}
  public static syncAvailabilityRule(rule:AvailabilityRule) {return this.upsert('availability_rules',{...rule,is_active:rule.is_active ? 1 : 0},'day_of_week');}
  public static async syncAvailabilityRules(rules:AvailabilityRule[]) {for(const rule of rules) await this.syncAvailabilityRule(rule);}
  public static syncOverride(override:AvailabilityOverride) {return this.upsert('availability_overrides',{...override,is_unavailable:override.is_unavailable ? 1 : 0},'date');}
  public static async deleteOverride(id:string) {const client=this.client;if(!client) return;const r=await client.from('availability_overrides').delete().eq('id',id);if(r.error) throw new Error(r.error.message);}
  public static syncInvoice(invoice:Invoice) {return this.upsert('invoices',invoice);}
  public static syncSetting(key:string,value:string) {return this.upsert('settings',{key,value},'key');}
  public static syncConversation(conversation:any) {return this.upsert('conversations',conversation);}
  public static syncWorkflow(workflow:PendingBookingWorkflow) {return this.upsert('pending_booking_workflows',workflow);}
}
