import crypto from 'node:crypto';
import { CalendarEvent } from '../types/index.js';
import { withRetry } from '../utils/retry.js';

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
    this.events.set(eventId, { ...event, id: eventId });
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
      const auth = new google.auth.OAuth2(
        this.config.clientId,
        this.config.clientSecret,
        this.config.redirectUri
      );
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

  public async createEvent(event: CalendarEvent): Promise<string> {
    if (!this.isConnected()) {
      return `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    }
    try {
      const client = await this.getClient();
      return await withRetry(async () => {
        const res = await client.events.insert({
          calendarId: this.calendarId,
          requestBody: {
            summary: event.summary,
            description: event.description,
            location: event.location,
            start: { dateTime: event.start.toISOString() },
            end: { dateTime: event.end.toISOString() },
          },
        });
        return res.data.id!;
      });
    } catch (err: any) {
      console.warn(`[GoogleCalendarProvider] Warning: could not sync createEvent to Google Calendar: ${err?.message || err}`);
      return `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    }
  }

  public async updateEvent(eventId: string, event: CalendarEvent): Promise<void> {
    if (!this.isConnected() || eventId.startsWith('local_')) {
      return;
    }
    try {
      const client = await this.getClient();
      await withRetry(async () => {
        await client.events.update({
          calendarId: this.calendarId,
          eventId,
          requestBody: {
            summary: event.summary,
            description: event.description,
            location: event.location,
            start: { dateTime: event.start.toISOString() },
            end: { dateTime: event.end.toISOString() },
          },
        });
      });
    } catch (err: any) {
      console.warn(`[GoogleCalendarProvider] Warning: could not sync updateEvent to Google Calendar: ${err?.message || err}`);
    }
  }

  public async deleteEvent(eventId: string): Promise<void> {
    if (!this.isConnected() || eventId.startsWith('local_')) {
      return;
    }
    try {
      const client = await this.getClient();
      await withRetry(async () => {
        await client.events.delete({
          calendarId: this.calendarId,
          eventId,
        });
      });
    } catch (err: any) {
      console.warn(`[GoogleCalendarProvider] Warning: could not sync deleteEvent to Google Calendar: ${err?.message || err}`);
    }
  }

  public async listEvents(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
    if (!this.isConnected()) {
      return [];
    }
    try {
      const client = await this.getClient();
      return await withRetry(async () => {
        const res = await client.events.list({
          calendarId: this.calendarId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
        });

        const items = res.data.items || [];
        return items.map((item: any) => ({
          id: item.id,
          summary: item.summary || '',
          description: item.description,
          location: item.location,
          start: new Date(item.start.dateTime || item.start.date),
          end: new Date(item.end.dateTime || item.end.date),
        }));
      });
    } catch (err: any) {
      console.warn(`[GoogleCalendarProvider] Warning: could not listEvents from Google Calendar: ${err?.message || err}`);
      return [];
    }
  }
}
