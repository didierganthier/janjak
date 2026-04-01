// ─── Google Calendar Integration ───────────────────────────────────
// Fetches today's events, upcoming meetings, and free slots.
// Uses the same OAuth2 flow as Gmail (calendar.readonly scope).

import { google, calendar_v3 } from "googleapis";
import { getAuthenticatedClient, isAuthenticated } from "./gmail-auth.js";

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  location: string;
  isAllDay: boolean;
  status: "upcoming" | "now" | "passed";
  minutesUntil: number;
  organizer: string;
  meetLink: string | null;
}

export interface FreeSlot {
  start: Date;
  end: Date;
  durationMinutes: number;
}

function parseEventTime(dt: calendar_v3.Schema$EventDateTime | undefined): Date | null {
  if (!dt) return null;
  if (dt.dateTime) return new Date(dt.dateTime);
  if (dt.date) return new Date(dt.date + "T00:00:00");
  return null;
}

/** Fetch today's calendar events. */
export async function getTodayEvents(): Promise<CalendarEvent[]> {
  if (!isAuthenticated()) return [];

  try {
    const auth = await getAuthenticatedClient();
    const calendar = google.calendar({ version: "v3", auth });

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 20,
    });

    const events = res.data.items ?? [];
    return events
      .filter((e) => e.status !== "cancelled")
      .map((e) => {
        const start = parseEventTime(e.start) ?? now;
        const end = parseEventTime(e.end) ?? now;
        const isAllDay = !e.start?.dateTime;
        const diffMs = start.getTime() - now.getTime();
        const minutesUntil = Math.round(diffMs / 60000);

        let status: "upcoming" | "now" | "passed";
        if (now >= start && now <= end) status = "now";
        else if (now < start) status = "upcoming";
        else status = "passed";

        // Extract Google Meet link
        let meetLink: string | null = null;
        if (e.hangoutLink) meetLink = e.hangoutLink;
        else if (e.conferenceData?.entryPoints) {
          const video = e.conferenceData.entryPoints.find((ep) => ep.entryPointType === "video");
          if (video?.uri) meetLink = video.uri;
        }

        return {
          id: e.id ?? "",
          title: e.summary ?? "(No title)",
          start,
          end,
          location: e.location ?? "",
          isAllDay,
          status,
          minutesUntil,
          organizer: e.organizer?.displayName ?? e.organizer?.email ?? "",
          meetLink,
        };
      });
  } catch (err) {
    // If calendar scope not granted, fail silently
    return [];
  }
}

/** Get events that are happening now or coming up soon. */
export async function getUpcomingEvents(withinMinutes = 60): Promise<CalendarEvent[]> {
  const events = await getTodayEvents();
  return events.filter(
    (e) => !e.isAllDay && (e.status === "now" || (e.status === "upcoming" && e.minutesUntil <= withinMinutes))
  );
}

/** Find free time blocks between events today (during work hours 8am-6pm). */
export async function getFreeSlots(minMinutes = 30): Promise<FreeSlot[]> {
  const events = await getTodayEvents();
  const now = new Date();

  const workStart = new Date(now);
  workStart.setHours(8, 0, 0, 0);
  const workEnd = new Date(now);
  workEnd.setHours(18, 0, 0, 0);

  // Only non-all-day events that haven't fully passed
  const busy = events
    .filter((e) => !e.isAllDay && e.end > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const slots: FreeSlot[] = [];
  let cursor = now > workStart ? now : workStart;

  for (const event of busy) {
    if (event.start > cursor) {
      const end = event.start < workEnd ? event.start : workEnd;
      const dur = Math.round((end.getTime() - cursor.getTime()) / 60000);
      if (dur >= minMinutes) {
        slots.push({ start: new Date(cursor), end, durationMinutes: dur });
      }
    }
    if (event.end > cursor) cursor = new Date(event.end.getTime());
  }

  // Final slot after last event
  if (cursor < workEnd) {
    const dur = Math.round((workEnd.getTime() - cursor.getTime()) / 60000);
    if (dur >= minMinutes) {
      slots.push({ start: new Date(cursor), end: workEnd, durationMinutes: dur });
    }
  }

  return slots;
}

// ─── Formatting ─────────────────────────────────────────────────

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatEventLine(e: CalendarEvent): string {
  const time = e.isAllDay ? "All day" : `${formatTime(e.start)} – ${formatTime(e.end)}`;
  const statusIcon = e.status === "now" ? "🔴" : e.status === "upcoming" ? "⏳" : "✅";
  const meetBadge = e.meetLink ? " 📹" : "";

  let detail = "";
  if (e.status === "now") detail = " (NOW)";
  else if (e.status === "upcoming" && e.minutesUntil <= 15) detail = ` (in ${e.minutesUntil}m)`;
  else if (e.status === "upcoming" && e.minutesUntil <= 60) detail = ` (in ${e.minutesUntil}m)`;

  return `  ${statusIcon} ${time}  ${e.title}${meetBadge}${detail}`;
}

export async function formatCalendarReport(): Promise<string> {
  const events = await getTodayEvents();

  let output = "\n📅 Today's Calendar\n";
  output += "═".repeat(48) + "\n\n";

  if (events.length === 0) {
    output += "  No events today. Clear schedule! 🎉\n";
    return output;
  }

  const allDay = events.filter((e) => e.isAllDay);
  const timed = events.filter((e) => !e.isAllDay);

  if (allDay.length > 0) {
    output += "  📌 All Day:\n";
    for (const e of allDay) output += `    • ${e.title}\n`;
    output += "\n";
  }

  if (timed.length > 0) {
    output += "  📋 Schedule:\n";
    for (const e of timed) output += formatEventLine(e) + "\n";
  }

  // Free slots
  const slots = await getFreeSlots();
  if (slots.length > 0) {
    output += "\n  🟢 Free for deep work:\n";
    for (const s of slots) {
      output += `    ${formatTime(s.start)} – ${formatTime(s.end)}  (${s.durationMinutes}m)\n`;
    }
  }

  // Meeting alert
  const upcoming = timed.filter((e) => e.status === "upcoming" && e.minutesUntil <= 15 && e.minutesUntil > 0);
  if (upcoming.length > 0) {
    output += "\n  ⚠️  Meeting soon: " + upcoming.map((e) => `${e.title} in ${e.minutesUntil}m`).join(", ") + "\n";
  }

  return output;
}

/** Short summary for dashboard panel. */
export async function getCalendarSummary(): Promise<{
  nextEvent: CalendarEvent | null;
  currentEvent: CalendarEvent | null;
  totalMeetings: number;
  freeMinutes: number;
}> {
  const events = await getTodayEvents();
  const timed = events.filter((e) => !e.isAllDay);

  const currentEvent = timed.find((e) => e.status === "now") ?? null;
  const nextEvent = timed.find((e) => e.status === "upcoming") ?? null;
  const totalMeetings = timed.filter((e) => e.status !== "passed").length;

  const slots = await getFreeSlots();
  const freeMinutes = slots.reduce((s, sl) => s + sl.durationMinutes, 0);

  return { nextEvent, currentEvent, totalMeetings, freeMinutes };
}

// ─── Event Creation ─────────────────────────────────────────────

export interface NewCalendarEvent {
  title: string;
  date: string;       // YYYY-MM-DD
  startTime?: string; // HH:MM (24h) — if absent, creates all-day event
  durationMinutes?: number; // default 60
  description?: string;
}

/** Create a Google Calendar event. Returns the event ID or null on failure. */
export async function createCalendarEvent(event: NewCalendarEvent): Promise<{ id: string; htmlLink: string } | null> {
  if (!isAuthenticated()) return null;

  try {
    const auth = await getAuthenticatedClient();
    const calendar = google.calendar({ version: "v3", auth });

    let requestBody: calendar_v3.Schema$Event;

    if (event.startTime) {
      // Timed event
      const start = new Date(`${event.date}T${event.startTime}:00`);
      const durationMs = (event.durationMinutes ?? 60) * 60000;
      const end = new Date(start.getTime() + durationMs);
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      requestBody = {
        summary: event.title,
        description: event.description ?? `Created by Janjak`,
        start: { dateTime: start.toISOString(), timeZone },
        end: { dateTime: end.toISOString(), timeZone },
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] },
      };
    } else {
      // All-day event (reminder-style)
      requestBody = {
        summary: event.title,
        description: event.description ?? `Created by Janjak`,
        start: { date: event.date },
        end: { date: event.date },
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 480 }] }, // 8 hours = morning
      };
    }

    const res = await calendar.events.insert({
      calendarId: "primary",
      requestBody,
    });

    return {
      id: res.data.id ?? "",
      htmlLink: res.data.htmlLink ?? "",
    };
  } catch (err) {
    console.error("  ⚠️  Could not create calendar event:", (err as Error).message);
    return null;
  }
}

/** Get meeting alert for nudge system (returns string if meeting within 10 min). */
export async function getMeetingAlert(): Promise<string | null> {
  const events = await getTodayEvents();
  const soon = events.filter(
    (e) => !e.isAllDay && e.status === "upcoming" && e.minutesUntil > 0 && e.minutesUntil <= 10
  );
  if (soon.length === 0) return null;
  const e = soon[0]!;
  const meet = e.meetLink ? ` — Join: ${e.meetLink}` : "";
  return `📅 Meeting in ${e.minutesUntil}m: ${e.title}${meet}`;
}
