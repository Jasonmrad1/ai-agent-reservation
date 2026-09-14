import React, { useState, useEffect, useRef } from 'react';
import { Appointment, AvailabilityRule, DateOverride, TimeInterval } from '../types';
import { IconClock, IconCar, IconMapPin, IconPause, IconTrash, IconPlus, IconBuilding, IconHome } from './Icons';

interface CalendarGridProps {
  currentWeekMonday: Date;
  appointments: Appointment[];
  rules: AvailabilityRule[];
  overrides?: DateOverride[];
  showHoursOverlay?: boolean;
  commuteBufferMinutes?: number;
  onSelectAppointment: (appt: Appointment) => void;
  onSlotClick?: (date: string, time: string) => void;
}

const START_HOUR = 7;
const END_HOUR = 21;
const TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60; // 840
const TRACK_HEIGHT = 672; // 14 * 48px
const PX_PER_MIN = TRACK_HEIGHT / TOTAL_MINUTES; // 0.8 px/min
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function parseTimeInfo(isoStr: string) {
  if (!isoStr) {
    return {
      year: 2026,
      month: 0,
      date: 1,
      hours: 9,
      minutes: 0,
      totalMinutes: 540,
      timeStr12: '09:00 AM',
      timeStr24: '09:00',
      dateKey: '2026-01-01',
    };
  }
  const parts = String(isoStr).split(/[T\s]/);
  const datePart = parts[0] || '';
  const timePart = parts[1] || '00:00:00';

  const dComps = datePart.split('-');
  const y = parseInt(dComps[0], 10) || 2026;
  const m = (parseInt(dComps[1], 10) || 1) - 1;
  const d = parseInt(dComps[2], 10) || 1;

  const tComps = timePart.split(':');
  const h = parseInt(tComps[0], 10) || 0;
  const min = parseInt(tComps[1], 10) || 0;

  const h12 = h % 12 || 12;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const minStr = String(min).padStart(2, '0');
  const timeStr12 = `${h12}:${minStr} ${ampm}`;
  const timeStr24 = `${String(h).padStart(2, '0')}:${minStr}`;
  const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  return {
    year: y,
    month: m,
    date: d,
    hours: h,
    minutes: min,
    totalMinutes: h * 60 + min,
    timeStr12,
    timeStr24,
    dateKey,
  };
}

export function timeToMinutes(tStr?: string) {
  if (!tStr) return START_HOUR * 60;
  const parts = tStr.split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

export function minutesToTimeStr(mins: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, mins));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function minutesToY(mins: number) {
  const clamped = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60, mins));
  return (clamped - START_HOUR * 60) * PX_PER_MIN;
}

function getInitials(name?: string): string {
  if (!name) return 'P';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const CalendarGrid: React.FC<CalendarGridProps> = ({
  currentWeekMonday,
  appointments,
  rules,
  overrides = [],
  showHoursOverlay = true,
  commuteBufferMinutes = 30,
  onSelectAppointment,
  onSlotClick,
}) => {
  const weekDates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(currentWeekMonday.getFullYear(), currentWeekMonday.getMonth(), currentWeekMonday.getDate() + i);
    weekDates.push(d);
  }

  const todayObj = new Date();
  const todayKey = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(
    todayObj.getDate()
  ).padStart(2, '0')}`;
  const nowMin = todayObj.getHours() * 60 + todayObj.getMinutes();
  const isNowInGrid = nowMin >= START_HOUR * 60 && nowMin <= END_HOUR * 60;
  const nowY = minutesToY(nowMin);

  // Time labels (07:00 to 21:00)
  const timeLabels: string[] = [];
  for (let h = START_HOUR; h <= END_HOUR; h++) {
    timeLabels.push(`${String(h).padStart(2, '0')}:00`);
  }

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>, colDateKey: string) => {
    if (!onSlotClick) return;
    const target = e.target as HTMLElement;
    if (target.closest('.teams-meeting-card')) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const clickedMin = Math.floor(clickY / PX_PER_MIN) + START_HOUR * 60;
    const slotMin = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - 30, Math.floor(clickedMin / 30) * 30));
    const timeStr = minutesToTimeStr(slotMin);
    onSlotClick(colDateKey, timeStr);
  };

  return (
    <main className="calendar-app-container">
      <div className="calendar-card">
        {/* Calendar Legend Bar */}
        <div className="calendar-subbar">
          <div className="subbar-legend">
            <span className="legend-item"><span className="legend-dot in-office"></span> In-Office Visit</span>
            <span className="legend-item"><span className="legend-dot home-visit"></span> Home Visit</span>
            <span className="legend-item"><span className="legend-dot shift"></span> Open Clinic Hours</span>
          </div>
        </div>

        <div className="calendar-body-scroll">
          {/* Time axis */}
          <div className="time-axis">
            {timeLabels.map((label, idx) => (
              <div
                key={label}
                className={`time-axis-slot ${idx === timeLabels.length - 1 ? 'last-slot' : ''}`}
              >
                {label}
              </div>
            ))}
          </div>

          {/* 7 Day Columns */}
          <div className="days-columns-grid">
            {weekDates.map((colDate, colIdx) => {
              const dayOfWeek = colDate.getDay();
              const colDateKey = `${colDate.getFullYear()}-${String(colDate.getMonth() + 1).padStart(2, '0')}-${String(
                colDate.getDate()
              ).padStart(2, '0')}`;
              const isToday = colDateKey === todayKey;

              const ov = overrides.find((o) => o.date === colDateKey);
              const baseRule =
                rules.find((r) => Number(r.day_of_week) === dayOfWeek) || {
                  day_of_week: dayOfWeek,
                  start_time: '09:00',
                  end_time: '17:00',
                  is_active: false,
                  shifts: [{ start_time: '09:00', end_time: '17:00' }],
                };

              let isActive = Boolean(baseRule.is_active);
              let shifts: TimeInterval[] = (baseRule.shifts && baseRule.shifts.length > 0)
                ? baseRule.shifts
                : (isActive ? [{ start_time: baseRule.start_time, end_time: baseRule.end_time }] : []);

              if (ov) {
                if (ov.is_unavailable) {
                  isActive = false;
                  shifts = [];
                } else {
                  isActive = true;
                  if (ov.shifts && ov.shifts.length > 0) {
                    shifts = ov.shifts;
                  } else if (ov.start_time && ov.end_time) {
                    shifts = [{ start_time: ov.start_time, end_time: ov.end_time }];
                  }
                }
              }

              // Format header status
              let statusLabel = 'Closed';
              if (isActive && shifts.length > 0) {
                if (shifts.length === 1) {
                  statusLabel = `${shifts[0].start_time} - ${shifts[0].end_time}`;
                } else {
                  statusLabel = `${shifts.length} Shifts`;
                }
              }

              // Gather appointments for this day column
              const dayItems: Array<{
                appt: Appointment;
                sInfo: ReturnType<typeof parseTimeInfo>;
                eInfo: ReturnType<typeof parseTimeInfo> | null;
                startMin: number;
                endMin: number;
                subCol: number;
                totalCols: number;
              }> = [];

              for (const appt of appointments) {
                if (appt.status === 'cancelled') continue;
                const sInfo = parseTimeInfo(appt.start_time);
                if (sInfo.dateKey !== colDateKey) continue;

                const eInfo = appt.end_time ? parseTimeInfo(appt.end_time) : null;
                const startMin = sInfo.totalMinutes;
                let endMin = eInfo && eInfo.dateKey === sInfo.dateKey ? eInfo.totalMinutes : startMin + 45;
                if (endMin <= startMin) endMin = startMin + 45;

                dayItems.push({
                  appt,
                  sInfo,
                  eInfo,
                  startMin,
                  endMin,
                  subCol: 0,
                  totalCols: 1,
                });
              }

              // Sort by startMin ascending
              dayItems.sort((a, b) => a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin));

              // Cluster overlapping appointments
              const clusters: typeof dayItems[] = [];
              let curCluster: typeof dayItems = [];
              let clusterEnd = -1;

              for (const item of dayItems) {
                if (curCluster.length === 0) {
                  curCluster.push(item);
                  clusterEnd = item.endMin;
                } else if (item.startMin < clusterEnd) {
                  curCluster.push(item);
                  if (item.endMin > clusterEnd) clusterEnd = item.endMin;
                } else {
                  clusters.push(curCluster);
                  curCluster = [item];
                  clusterEnd = item.endMin;
                }
              }
              if (curCluster.length > 0) clusters.push(curCluster);

              // Assign side-by-side sub-columns in each cluster
              for (const cluster of clusters) {
                const subCols: number[] = [];
                for (const it of cluster) {
                  let placed = false;
                  for (let sc = 0; sc < subCols.length; sc++) {
                    if (subCols[sc] <= it.startMin) {
                      subCols[sc] = it.endMin;
                      it.subCol = sc;
                      placed = true;
                      break;
                    }
                  }
                  if (!placed) {
                    it.subCol = subCols.length;
                    subCols.push(it.endMin);
                  }
                }
                const totalSubCols = subCols.length;
                for (const it of cluster) {
                  it.totalCols = totalSubCols;
                }
              }

              return (
                <div key={colDateKey} className={`day-column ${isToday ? 'is-today' : ''}`} data-day={dayOfWeek}>
                  {/* Column Header */}
                  <div className="day-col-header">
                    <div className="day-header-meta">
                      <span className="day-abbr">{DAY_NAMES[colIdx]}</span>
                      <span className={`day-num ${isToday ? 'today' : ''}`}>{colDate.getDate()}</span>
                    </div>
                    <div className="day-header-actions">
                      <span className={`day-col-status ${isActive ? '' : 'closed'}`}>
                        {statusLabel}
                      </span>
                    </div>
                  </div>

                  {/* Column Track */}
                  <div
                    className={`day-col-track ${isActive ? '' : 'day-closed'}`}
                    onClick={(e) => handleTrackClick(e, colDateKey)}
                    title="Click on empty slot to schedule appointment"
                  >
                    {/* Realtime "Now" indicator line on today */}
                    {isToday && isNowInGrid && (
                      <div className="current-time-line" style={{ top: `${nowY}px` }}>
                        <div className="current-time-bullet"></div>
                      </div>
                    )}

                    {/* Closed Notice background pattern */}
                    {!isActive && (
                      <div className="day-closed-notice">
                        <span>Closed</span>
                      </div>
                    )}

                    {/* Working Shifts background overlay */}
                    {showHoursOverlay && isActive && (
                      <>
                        {shifts.map((shift, sIdx) => {
                          const sStartM = timeToMinutes(shift.start_time);
                          const sEndM = timeToMinutes(shift.end_time);
                          const sTop = minutesToY(sStartM);
                          const sBottom = minutesToY(sEndM);
                          const sHeight = Math.max(24, sBottom - sTop);

                          // Check if there is a gap/break between shifts
                          let breakBlock = null;
                          if (sIdx > 0) {
                            const prevEndM = timeToMinutes(shifts[sIdx - 1].end_time);
                            const bTop = minutesToY(prevEndM);
                            const bHeight = Math.max(16, sTop - bTop);
                            if (sStartM > prevEndM) {
                              breakBlock = (
                                <div
                                  key={`break-${sIdx}`}
                                  className="shift-break-overlay"
                                  style={{ top: `${bTop}px`, height: `${bHeight}px` }}
                                >
                                  <IconPause size={11} color="var(--text-subtle)" style={{ marginRight: '4px' }} />
                                  <span>Break / Gap</span>
                                </div>
                              );
                            }
                          }

                          return (
                            <React.Fragment key={`shift-${sIdx}`}>
                              {breakBlock}
                              <div
                                className="avail-block avail-block-display"
                                style={{ top: `${sTop}px`, height: `${sHeight}px` }}
                              >
                                <div className="avail-block-label">
                                  <span className="shift-title-text">
                                    {shifts.length > 1 ? `Shift ${sIdx + 1}: ` : ''}
                                    {shift.start_time} - {shift.end_time}
                                  </span>
                                </div>
                              </div>
                            </React.Fragment>
                          );
                        })}
                      </>
                    )}

                    {/* Scheduled Appointments Cards */}
                    {dayItems.map((item) => {
                      const aTop = minutesToY(item.startMin);
                      const aHeight = Math.max(42, (item.endMin - item.startMin) * PX_PER_MIN);
                      const isHome = item.appt.visit_type === 'home_visit';
                      const timeStr = item.sInfo.timeStr12;
                      const widthPct = 100 / item.totalCols;
                      const leftPct = item.subCol * widthPct;
                      const patientName = item.appt.customer_name || 'Patient';
                      const initials = getInitials(patientName);

                      return (
                        <div
                          key={item.appt.id}
                          className={`teams-meeting-card ${isHome ? 'home-visit' : 'in-office'}`}
                          style={{
                            top: `${aTop}px`,
                            height: `${aHeight}px`,
                            left: `calc(${leftPct}% + 3px)`,
                            width: `calc(${widthPct}% - 6px)`,
                          }}
                          onClick={() => onSelectAppointment(item.appt)}
                          title={`${patientName} - ${item.appt.service}`}
                        >
                          <div className="meeting-row-top">
                            <div className="patient-avatar-badge">{initials}</div>
                            <span className="meeting-patient">{patientName}</span>
                            <span className="meeting-time">{timeStr}</span>
                          </div>
                          <div className="meeting-row-bottom">
                            <span className="meeting-title">{item.appt.service || 'Consultation'}</span>
                            <span className={`meeting-chip ${isHome ? 'home' : 'office'}`}>
                              {isHome ? 'HOME VISIT' : 'IN-OFFICE'}
                            </span>
                          </div>
                          {isHome && (
                            <div className="meeting-commute-tag">
                              <IconCar size={10} color="var(--cyan-primary)" />
                              <span>+{commuteBufferMinutes}m Commute Buffer</span>
                            </div>
                          )}
                          {isHome && aHeight >= 72 && item.appt.address && (
                            <div className="meeting-card-addr" style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                              <IconMapPin size={10} color="#94a3b8" />
                              <span>{item.appt.address}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
};
