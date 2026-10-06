import { beirutDayStart } from '../utils/timezone.js';
import crypto from 'node:crypto';
import { CalendarEvent } from '../types/index.js';
import { withRetry } from '../utils/retry.js';
const REQUEST_OPTIONS={timeout:10000,retry:false};

export interface CalendarProvider {
  createEvent(event: CalendarEvent): Promise<string>;
  updateEvent(eventId: string, event: CalendarEvent): Promise<void>;
  deleteEvent(eventId: string): Promise<void>;
  listEvents(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]>;
}

export class InMemoryCalendarProvider implements CalendarProvider {
  private events: Map<string, CalendarEvent> = new Map();

  public async createEvent(event: CalendarEvent): Promise<string> {
    const id = event.id || 'cal_' + crypto.randomUUID();
    this.events.set(id, { ...event, id });
    return id;
  }

  public async updateEvent(eventId: string, event: CalendarEvent): Promise<void> {
    if (!this.events.has(eventId)) {
      throw new Error(`Calendar event ${eventId} not found`);
    }
    this.events.set(eventId, { ...this.events.get(eventId), ...event, id: eventId });
  }

  public async deleteEvent(eventId: string): Promise<void> {
    this.events.delete(eventId);
  }

  public async listEvents(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
    const results: CalendarEvent[] = [];
    for (const event of this.events.values()) {
      // Check interval overlap: start < timeMax and end > timeMin
      if (event.start < timeMax && event.end > timeMin) {
        results.push({ ...event });
      }
    }
    return results.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  public clear(): void {
    this.events.clear();
  }
}

export interface GoogleCalendarConfig {
  clientId?: string;
  clientSecret?: string;
  calendarId: string;
  refreshToken?: string;
  redirectUri?: string;
  getRefreshToken?: () => string | undefined;
}

export class GoogleCalendarProvider implements CalendarProvider {
  private calendar: any = null;
  private calendarId: string;
  private config: GoogleCalendarConfig;
  private activeToken: string | undefined = undefined;

  constructor(config: GoogleCalendarConfig) {
    this.calendarId = config.calendarId || 'primary';
    this.config = config;
  }

  private async getClient() {
    const currentRefresh = this.config.getRefreshToken ? this.config.getRefreshToken() : this.config.refreshToken;
    if (!this.calendar || this.activeToken !== currentRefresh) {
      const { google } = await import('googleapis');
      const auth = new google.auth.OAuth2({clientId:this.config.clientId,clientSecret:this.config.clientSecret,redirectUri:this.config.redirectUri,transporterOptions:REQUEST_OPTIONS});
      if (currentRefresh) {
        auth.setCredentials({ refresh_token: currentRefresh });
      }
      this.calendar = google.calendar({ version: 'v3', auth });
      this.activeToken = currentRefresh;
    }
    return this.calendar;
  }

  private isConnected(): boolean {
    const token = this.config.getRefreshToken ? this.config.getRefreshToken() : this.config.refreshToken;
    return Boolean(this.config.clientId && this.config.clientSecret && token);
  }


  private requireConnection(): void {
    if (!this.isConnected()) throw new Error('Google Calendar is not connected; reconnect before scheduling');
  }

  public async createEvent(event: CalendarEvent): Promise<string> {
    this.requireConnection(); const client = await this.getClient();
    // A stable Google-compatible ID makes retries safe even if the response is lost.
    const id = event.id || crypto.randomUUID().replaceAll('-', '');
    return withRetry(async () => {
      try {
        const res = await client.events.insert({calendarId:this.calendarId, requestBody:{
          id, summary:event.summary, description:event.description, location:event.location,
          start:{dateTime:event.start.toISOString()}, end:{dateTime:event.end.toISOString()}
        }},REQUEST_OPTIONS);
        if (!res.data.id) throw new Error('Calendar returned no event ID');
        return res.data.id;
      } catch (error: any) {
        if (error.code !== 409 && error.response?.status !== 409) throw error;
        const existing = await client.events.get({calendarId:this.calendarId,eventId:id},REQUEST_OPTIONS);
        if (new Date(existing.data.start?.dateTime || '').getTime() !== event.start.getTime() || new Date(existing.data.end?.dateTime || '').getTime() !== event.end.getTime()) throw new Error('Calendar ID conflict requires reconciliation');
        return id;
      }
    });
  }

  public async updateEvent(eventId: string, event: CalendarEvent): Promise<void> {
    this.requireConnection(); if (eventId.startsWith('local_')) throw new Error('Legacy local event requires reconciliation');
    const client=await this.getClient();
    // Patch preserves attendees and metadata omitted by the application.
    const body: any = {start:{dateTime:event.start.toISOString()},end:{dateTime:event.end.toISOString()}};
    for (const key of ['summary','description','location'] as const) if (event[key] !== undefined) body[key]=event[key];
    await withRetry(()=>client.events.patch({calendarId:this.calendarId,eventId,requestBody:body},REQUEST_OPTIONS));
  }

  public async deleteEvent(eventId: string): Promise<void> {
    this.requireConnection(); if (eventId.startsWith('local_')) throw new Error('Legacy local event requires reconciliation');
    const client=await this.getClient();
    await withRetry(async()=>{
      try {await client.events.delete({calendarId:this.calendarId,eventId},REQUEST_OPTIONS);}
      catch (error:any) {if (![404,410].includes(error.code || error.response?.status)) throw error;}
    });
  }

  public async listEvents(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
    this.requireConnection();const client=await this.getClient();const results:CalendarEvent[]=[];let pageToken:string|undefined;
    do {
      const res:any=await withRetry(()=>client.events.list({calendarId:this.calendarId,timeMin:timeMin.toISOString(),timeMax:timeMax.toISOString(),singleEvents:true,orderBy:'startTime',maxResults:2500,pageToken},REQUEST_OPTIONS));
      for (const item of res.data.items || []) {
        if (item.status==='cancelled') continue;
        results.push({id:item.id,summary:item.summary || '',description:item.description,location:item.location,
          start:item.start.dateTime ? new Date(item.start.dateTime) : beirutDayStart(item.start.date),
          end:item.end.dateTime ? new Date(item.end.dateTime) : beirutDayStart(item.end.date)});
      }
      pageToken=res.data.nextPageToken;
    } while(pageToken);
    return results;
  }
}
