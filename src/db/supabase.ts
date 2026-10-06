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

  public static async hydrateFromSupabase(_db:any):Promise<void> {
    throw new Error('Implicit hydration is disabled; use explicit restore into a new empty database');
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
