import React, { useState, useEffect, useRef } from 'react';
import { AvailabilityRule, DateOverride, TimeInterval } from '../types';
import {
  IconClock,
  IconCar,
  IconPlus,
  IconTrash,
  IconCalendar,
  IconCheck,
  IconSliders,
  IconPause,
  IconChevronLeft,
  IconChevronRight,
  IconRotateCcw,
  IconZap,
} from './Icons';

interface WorkHoursViewProps {
  rules: AvailabilityRule[];
  overrides: DateOverride[];
  commuteBufferMinutes: number;
  adminKey: string;
  onApplyPreset: (preset: 'standard' | 'split' | 'extended' | 'all') => void;
  onSaveRule: (rule: AvailabilityRule) => void;
  onSaveAllRules: (rules: AvailabilityRule[]) => void;
  onSaveWeekOverrides?: (overrides: Array<{ date: string; is_unavailable: boolean; start_time?: string; end_time?: string; reason?: string; shifts?: TimeInterval[] }>) => void;
  onResetWeekOverrides?: (startDate: string, endDate: string) => void;
  onUpdateCommuteBuffer: (minutes: number, weekDate?: string, setAsDefault?: boolean) => void;
  onAddOverride: (date: string, reason: string) => void;
  onDeleteOverride: (id: string) => void;
}

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon to Sun

const START_HOUR = 7;
const END_HOUR = 21;
const TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60; // 840
const TRACK_HEIGHT = 560;
const PX_PER_MIN = TRACK_HEIGHT / TOTAL_MINUTES;

function getMonday(d: Date | string | number): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.getFullYear(), date.getMonth(), diff, 0, 0, 0, 0);
  return monday;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, 0, 0, 0);
}

function formatDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timeToMinutes(tStr?: string) {
  if (!tStr) return START_HOUR * 60;
  const parts = tStr.split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

function minutesToTimeStr(mins: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, mins));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function minutesToY(mins: number) {
  const clamped = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60, mins));
  return (clamped - START_HOUR * 60) * PX_PER_MIN;
}

function normalizeShifts(shifts: TimeInterval[]): TimeInterval[] {
  if (!shifts || shifts.length === 0) return [];
  const valid = shifts.filter(
    (s) => s.start_time && s.end_time && timeToMinutes(s.end_time) > timeToMinutes(s.start_time)
  );
  const sorted = [...valid].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
  const merged: TimeInterval[] = [];

  for (const s of sorted) {
    const sStart = timeToMinutes(s.start_time);
    const sEnd = timeToMinutes(s.end_time);

    if (merged.length === 0) {
      merged.push({ start_time: minutesToTimeStr(sStart), end_time: minutesToTimeStr(sEnd) });
    } else {
      const prev = merged[merged.length - 1];
      const prevEnd = timeToMinutes(prev.end_time);
      if (sStart <= prevEnd) {
        prev.end_time = minutesToTimeStr(Math.max(prevEnd, sEnd));
      } else {
        merged.push({ start_time: minutesToTimeStr(sStart), end_time: minutesToTimeStr(sEnd) });
      }
    }
  }
  return merged;
}

interface DragState {
  dayOfWeek: number;
  shiftIndex?: number;
  mode: 'start' | 'end' | 'move' | 'create';
  initialClientY: number;
  initialStartM: number;
  initialEndM: number;
  currentStartM: number;
  currentEndM: number;
}

export const WorkHoursView: React.FC<WorkHoursViewProps> = ({
  rules,
  overrides,
  commuteBufferMinutes,
  adminKey,
  onApplyPreset,
  onSaveRule,
  onSaveAllRules,
  onSaveWeekOverrides,
  onResetWeekOverrides,
  onUpdateCommuteBuffer,
  onAddOverride,
  onDeleteOverride,
}) => {
  const [scopeMode, setScopeMode] = useState<'default' | 'week'>('week');
  const [selectedWeekMonday, setSelectedWeekMonday] = useState<Date>(() => getMonday(new Date()));
  const [viewMode, setViewMode] = useState<'visual' | 'form'>('visual');
  const [localRules, setLocalRules] = useState<AvailabilityRule[]>([]);
  const [selectedBuffer, setSelectedBuffer] = useState<number>(commuteBufferMinutes || 30);
  const [defaultBuffer, setDefaultBuffer] = useState<number>(commuteBufferMinutes || 30);
  const [newDate, setNewDate] = useState('');
  const [newReason, setNewReason] = useState('');

  // Drag state for visual mode
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  dragStateRef.current = dragState;

  // Keep defaultBuffer in sync whenever the prop changes (global default loaded from DB)
  useEffect(() => {
    setDefaultBuffer(commuteBufferMinutes || 30);
  }, [commuteBufferMinutes]);

  // Sync rules and overrides when props, scopeMode or selectedWeekMonday change
  useEffect(() => {
    if (scopeMode === 'default') {
      if (rules.length > 0) {
        const cloned: AvailabilityRule[] = JSON.parse(JSON.stringify(rules)).map((r: AvailabilityRule) => ({
          ...r,
          shifts:
            r.shifts && r.shifts.length > 0
              ? r.shifts
              : [{ start_time: r.start_time || '09:00', end_time: r.end_time || '17:00' }],
        }));
        setLocalRules(cloned);
      } else {
        const initRules: AvailabilityRule[] = [];
        for (let d = 0; d < 7; d++) {
          initRules.push({
            day_of_week: d,
            start_time: '09:00',
            end_time: '17:00',
            is_active: d >= 1 && d <= 5,
            shifts: [{ start_time: '09:00', end_time: '17:00' }],
          });
        }
        setLocalRules(initRules);
      }
    } else {
      // Week-specific mode: compute dates for this week and check for overrides
      const weekRules: AvailabilityRule[] = [];
      for (let dayNum = 0; dayNum < 7; dayNum++) {
        const offset = dayNum === 0 ? 6 : dayNum - 1;
        const dayDate = addDays(selectedWeekMonday, offset);
        const dateStr = formatDateIso(dayDate);
        const ov = overrides.find((o) => o.date === dateStr);
        const baseRule = rules.find((r) => r.day_of_week === dayNum) || {
          day_of_week: dayNum,
          start_time: '09:00',
          end_time: '17:00',
          is_active: dayNum >= 1 && dayNum <= 5,
          shifts: [{ start_time: '09:00', end_time: '17:00' }],
        };

        if (ov) {
          weekRules.push({
            day_of_week: dayNum,
            start_time: ov.start_time || baseRule.start_time || '09:00',
            end_time: ov.end_time || baseRule.end_time || '17:00',
            is_active: !ov.is_unavailable,
            shifts:
              ov.shifts && ov.shifts.length > 0
                ? ov.shifts
                : [{ start_time: ov.start_time || '09:00', end_time: ov.end_time || '17:00' }],
          });
        } else {
          weekRules.push({
            day_of_week: dayNum,
            start_time: baseRule.start_time || '09:00',
            end_time: baseRule.end_time || '17:00',
            is_active: Boolean(baseRule.is_active),
            shifts:
              baseRule.shifts && baseRule.shifts.length > 0
                ? JSON.parse(JSON.stringify(baseRule.shifts))
                : [{ start_time: baseRule.start_time || '09:00', end_time: baseRule.end_time || '17:00' }],
          });
        }
      }
      setLocalRules(weekRules);
    }
  }, [rules, overrides, scopeMode, selectedWeekMonday]);

  // Fetch week-specific buffer from API whenever week or scope changes
  useEffect(() => {
    if (scopeMode !== 'week') {
      // In default mode, show the global default
      setSelectedBuffer(defaultBuffer);
      return;
    }
    const weekDate = formatDateIso(selectedWeekMonday);
    let cancelled = false;
    fetch(`/admin/api/settings&week=${weekDate}`, {
      headers: { Authorization: `Bearer ${adminKey}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          const val = Number(data.home_visit_buffer_minutes);
          setSelectedBuffer(val > 0 ? val : defaultBuffer);
        }
      })
      .catch(() => {
        if (!cancelled) setSelectedBuffer(defaultBuffer);
      });
    return () => { cancelled = true; };
  }, [scopeMode, selectedWeekMonday, adminKey, defaultBuffer]);

  // Handle local preset selection without prematurely wiping DB

  const handleApplyPresetLocal = (preset: 'standard' | 'split' | 'extended' | 'all') => {
    const days = [0, 1, 2, 3, 4, 5, 6];
    const updated: AvailabilityRule[] = days.map((day) => {
      let isActive = false;
      let start = '09:00';
      let end = '17:00';
      let shifts: TimeInterval[] = [{ start_time: '09:00', end_time: '17:00' }];

      if (preset === 'standard') {
        isActive = day >= 1 && day <= 5;
        start = '09:00';
        end = '17:00';
        shifts = [{ start_time: '09:00', end_time: '17:00' }];
      } else if (preset === 'split') {
        isActive = day >= 1 && day <= 5;
        start = '09:00';
        end = '20:00';
        shifts = [
          { start_time: '09:00', end_time: '13:00' },
          { start_time: '16:00', end_time: '20:00' },
        ];
      } else if (preset === 'extended') {
        isActive = day >= 1 && day <= 6;
        start = '08:00';
        end = '18:00';
        shifts = [{ start_time: '08:00', end_time: '18:00' }];
      } else if (preset === 'all') {
        isActive = true;
        start = '09:00';
        end = '18:00';
        shifts = [{ start_time: '09:00', end_time: '18:00' }];
      }
      return {
        day_of_week: day,
        is_active: isActive,
        start_time: start,
        end_time: end,
        shifts,
      };
    });
    setLocalRules(updated);
  };

  // Handle Dragging in Visual Mode
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const cur = dragStateRef.current;
      if (!cur) return;

      const deltaY = e.clientY - cur.initialClientY;
      const deltaMinutes = Math.round(deltaY / PX_PER_MIN / 15) * 15; // 15-min snapping

      let nextStartM = cur.initialStartM;
      let nextEndM = cur.initialEndM;

      if (cur.mode === 'start') {
        nextStartM = Math.min(
          cur.initialEndM - 30,
          Math.max(START_HOUR * 60, cur.initialStartM + deltaMinutes)
        );
      } else if (cur.mode === 'end') {
        nextEndM = Math.max(
          cur.initialStartM + 30,
          Math.min(END_HOUR * 60, cur.initialEndM + deltaMinutes)
        );
      } else if (cur.mode === 'move') {
        const duration = cur.initialEndM - cur.initialStartM;
        nextStartM = Math.max(
          START_HOUR * 60,
          Math.min(END_HOUR * 60 - duration, cur.initialStartM + deltaMinutes)
        );
        nextEndM = nextStartM + duration;
      } else if (cur.mode === 'create') {
        if (deltaMinutes >= 0) {
          nextStartM = cur.initialStartM;
          nextEndM = Math.min(
            END_HOUR * 60,
            Math.max(cur.initialStartM + 30, cur.initialStartM + deltaMinutes)
          );
        } else {
          nextStartM = Math.max(
            START_HOUR * 60,
            Math.min(cur.initialStartM - 30, cur.initialStartM + deltaMinutes)
          );
          nextEndM = cur.initialStartM;
        }
      }

      setDragState({
        ...cur,
        currentStartM: nextStartM,
        currentEndM: nextEndM,
      });
    };

    const handleMouseUp = () => {
      const cur = dragStateRef.current;
      if (cur) {
        setLocalRules((prev) =>
          prev.map((rule) => {
            if (rule.day_of_week !== cur.dayOfWeek) return rule;

            if (cur.mode === 'create') {
              let sM = Math.min(cur.currentStartM, cur.currentEndM);
              let eM = Math.max(cur.currentStartM, cur.currentEndM);
              if (eM - sM < 30) {
                eM = Math.min(END_HOUR * 60, sM + 60);
              }

              const existingShifts =
                rule.is_active && rule.shifts && rule.shifts.length > 0
                  ? [...rule.shifts]
                  : rule.is_active
                  ? [{ start_time: rule.start_time, end_time: rule.end_time }]
                  : [];

              existingShifts.push({
                start_time: minutesToTimeStr(sM),
                end_time: minutesToTimeStr(eM),
              });

              const merged = normalizeShifts(existingShifts);
              return {
                ...rule,
                is_active: true,
                start_time: merged[0]?.start_time || '09:00',
                end_time: merged[merged.length - 1]?.end_time || '17:00',
                shifts: merged,
              };
            } else if (cur.shiftIndex !== undefined) {
              const currentShifts = [
                ...(rule.shifts || [{ start_time: rule.start_time, end_time: rule.end_time }]),
              ];
              currentShifts[cur.shiftIndex] = {
                start_time: minutesToTimeStr(cur.currentStartM),
                end_time: minutesToTimeStr(cur.currentEndM),
              };

              const merged = normalizeShifts(currentShifts);
              return {
                ...rule,
                is_active: true,
                start_time: merged[0]?.start_time || rule.start_time,
                end_time: merged[merged.length - 1]?.end_time || rule.end_time,
                shifts: merged,
              };
            }
            return rule;
          })
        );
      }
      setDragState(null);
    };

    // Touch equivalents — map touch Y coords to the same delta logic
    const handleTouchMove = (e: TouchEvent) => {
      const cur = dragStateRef.current;
      if (!cur || e.touches.length === 0) return;
      e.preventDefault(); // prevent page scroll while dragging a shift
      handleMouseMove({ clientY: e.touches[0].clientY } as MouseEvent);
    };

    const handleTouchEnd = () => handleMouseUp();

    if (dragState) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [dragState]);

  const handleTrackMouseDown = (dayOfWeek: number, e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.avail-block')) {
      return;
    }

    const trackElem = e.currentTarget;
    const rect = trackElem.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const rawMin = START_HOUR * 60 + offsetY / PX_PER_MIN;
    const snapStartM = Math.max(
      START_HOUR * 60,
      Math.min(END_HOUR * 60 - 30, Math.round(rawMin / 15) * 15)
    );
    const snapEndM = Math.min(END_HOUR * 60, snapStartM + 60);

    setDragState({
      dayOfWeek,
      mode: 'create',
      initialClientY: e.clientY,
      initialStartM: snapStartM,
      initialEndM: snapEndM,
      currentStartM: snapStartM,
      currentEndM: snapEndM,
    });
  };

  // Touch equivalent — finger tap on empty track starts a new shift
  const handleTrackTouchStart = (dayOfWeek: number, e: React.TouchEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.avail-block')) return;
    if (e.touches.length === 0) return;
    const trackElem = e.currentTarget;
    const rect = trackElem.getBoundingClientRect();
    const offsetY = e.touches[0].clientY - rect.top;
    const rawMin = START_HOUR * 60 + offsetY / PX_PER_MIN;
    const snapStartM = Math.max(
      START_HOUR * 60,
      Math.min(END_HOUR * 60 - 30, Math.round(rawMin / 15) * 15)
    );
    const snapEndM = Math.min(END_HOUR * 60, snapStartM + 60);
    setDragState({
      dayOfWeek,
      mode: 'create',
      initialClientY: e.touches[0].clientY,
      initialStartM: snapStartM,
      initialEndM: snapEndM,
      currentStartM: snapStartM,
      currentEndM: snapEndM,
    });
  };

  const handleDeleteShiftFromVisual = (dayOfWeek: number, shiftIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setLocalRules((prev) =>
      prev.map((rule) => {
        if (rule.day_of_week !== dayOfWeek) return rule;
        const currentShifts = [
          ...(rule.shifts || [{ start_time: rule.start_time, end_time: rule.end_time }]),
        ];
        currentShifts.splice(shiftIndex, 1);

        if (currentShifts.length === 0) {
          return {
            ...rule,
            is_active: false,
            shifts: [],
          };
        }
        const merged = normalizeShifts(currentShifts);
        return {
          ...rule,
          is_active: true,
          start_time: merged[0]?.start_time || '09:00',
          end_time: merged[merged.length - 1]?.end_time || '17:00',
          shifts: merged,
        };
      })
    );
  };

  const handleToggleActive = (day: number) => {
    setLocalRules((prev) =>
      prev.map((r) => (r.day_of_week === day ? { ...r, is_active: !r.is_active } : r))
    );
  };

  const handleShiftChange = (
    day: number,
    shiftIndex: number,
    field: 'start_time' | 'end_time',
    val: string
  ) => {
    setLocalRules((prev) =>
      prev.map((r) => {
        if (r.day_of_week !== day) return r;
        const currentShifts = [...(r.shifts || [{ start_time: r.start_time, end_time: r.end_time }])];
        currentShifts[shiftIndex] = {
          ...currentShifts[shiftIndex],
          [field]: val,
        };
        const sortedStarts = [...currentShifts].map((s) => s.start_time).sort();
        const sortedEnds = [...currentShifts].map((s) => s.end_time).sort();
        return {
          ...r,
          shifts: currentShifts,
          start_time: sortedStarts[0] || r.start_time,
          end_time: sortedEnds[sortedEnds.length - 1] || r.end_time,
        };
      })
    );
  };

  const handleAddShift = (day: number) => {
    setLocalRules((prev) =>
      prev.map((r) => {
        if (r.day_of_week !== day) return r;
        const currentShifts = [...(r.shifts || [{ start_time: r.start_time, end_time: r.end_time }])];
        const lastShift = currentShifts[currentShifts.length - 1];
        let newStart = '16:00';
        let newEnd = '20:00';
        if (lastShift) {
          const [lastEndH] = lastShift.end_time.split(':').map(Number);
          const nextH = Math.min(22, lastEndH + 2);
          const nextEndH = Math.min(23, nextH + 3);
          newStart = `${String(nextH).padStart(2, '0')}:00`;
          newEnd = `${String(nextEndH).padStart(2, '0')}:00`;
        }
        const updatedShifts = [...currentShifts, { start_time: newStart, end_time: newEnd }];
        const sortedStarts = [...updatedShifts].map((s) => s.start_time).sort();
        const sortedEnds = [...updatedShifts].map((s) => s.end_time).sort();
        return {
          ...r,
          shifts: updatedShifts,
          start_time: sortedStarts[0],
          end_time: sortedEnds[sortedEnds.length - 1],
        };
      })
    );
  };

  const handleRemoveShift = (day: number, shiftIndex: number) => {
    setLocalRules((prev) =>
      prev.map((r) => {
        if (r.day_of_week !== day) return r;
        const currentShifts = [...(r.shifts || [])];
        if (currentShifts.length <= 1) return r;
        currentShifts.splice(shiftIndex, 1);
        const sortedStarts = [...currentShifts].map((s) => s.start_time).sort();
        const sortedEnds = [...currentShifts].map((s) => s.end_time).sort();
        return {
          ...r,
          shifts: currentShifts,
          start_time: sortedStarts[0] || '09:00',
          end_time: sortedEnds[sortedEnds.length - 1] || '17:00',
        };
      })
    );
  };

  const handleSaveAll = () => {
    if (scopeMode === 'default') {
      onSaveAllRules(localRules);
    } else if (onSaveWeekOverrides) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = formatDateIso(today);

      const weekOverrides = DISPLAY_ORDER
        .map((dayNum) => {
          const offset = dayNum === 0 ? 6 : dayNum - 1;
          const dayDate = addDays(selectedWeekMonday, offset);
          const dateStr = formatDateIso(dayDate);
          // Only save overrides for the current day and forward (never past days)
          if (dateStr < todayStr) return null;

          const dayRule = localRules.find((r) => r.day_of_week === dayNum);
          const isActive = Boolean(dayRule?.is_active);
          const shifts = dayRule?.shifts && dayRule.shifts.length > 0
            ? dayRule.shifts
            : isActive ? [{ start_time: dayRule?.start_time || '09:00', end_time: dayRule?.end_time || '17:00' }] : [];
          return {
            date: dateStr,
            is_unavailable: !isActive,
            start_time: dayRule?.start_time || '09:00',
            end_time: dayRule?.end_time || '17:00',
            shifts: shifts,
            reason: `Custom hours for week of ${formatDateIso(selectedWeekMonday)}`,
          };
        })
        .filter(Boolean) as Array<{ date: string; is_unavailable: boolean; start_time?: string; end_time?: string; reason?: string; shifts?: TimeInterval[] }>;

      onSaveWeekOverrides(weekOverrides);
    }

    // Always save the buffer alongside the schedule (week-specific when in week mode)
    if (scopeMode === 'week') {
      onUpdateCommuteBuffer(selectedBuffer, formatDateIso(selectedWeekMonday), false);
    } else {
      onUpdateCommuteBuffer(selectedBuffer, undefined, true);
    }
  };

  const handleSaveAsDefault = () => {
    onSaveAllRules(localRules);
    // Promote buffer to global default
    onUpdateCommuteBuffer(selectedBuffer, undefined, true);
  };

  const handleAddOverrideSubmit = () => {
    if (!newDate) return alert('Please choose a date to block out.');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = formatDateIso(today);
    if (newDate < todayStr) {
      alert('Cannot set work hours or block dates in the past. Please select today or a future date.');
      return;
    }
    onAddOverride(newDate, newReason);
    setNewDate('');
    setNewReason('');
  };

  const sortedRules = DISPLAY_ORDER.map((d) => {
    return (
      localRules.find((r) => r.day_of_week === d) || {
        day_of_week: d,
        start_time: '09:00',
        end_time: '17:00',
        is_active: false,
        shifts: [{ start_time: '09:00', end_time: '17:00' }],
      }
    );
  });

  // Time labels for visual grid (07:00 to 21:00)
  const timeLabels: string[] = [];
  for (let h = START_HOUR; h <= END_HOUR; h++) {
    timeLabels.push(`${String(h).padStart(2, '0')}:00`);
  }

  const currentMonday = getMonday(new Date());
  const weekEndSunday = addDays(selectedWeekMonday, 6);
  const diffDays = Math.round((selectedWeekMonday.getTime() - currentMonday.getTime()) / 86400000);
  const weekDiff = Math.round(diffDays / 7);

  let weekRelativeLabel = 'This Week (Current)';
  if (weekDiff === 1) weekRelativeLabel = 'Next Week (+1)';
  else if (weekDiff === 2) weekRelativeLabel = 'In 2 Weeks (+2)';
  else if (weekDiff === 3) weekRelativeLabel = 'In 3 Weeks (+3)';
  else if (weekDiff === 4) weekRelativeLabel = 'In 4 Weeks (+4)';
  else if (weekDiff === -1) weekRelativeLabel = 'Last Week (-1)';
  else if (weekDiff < -1) weekRelativeLabel = `${Math.abs(weekDiff)} Weeks Ago`;
  else if (weekDiff > 4) weekRelativeLabel = `In ${weekDiff} Weeks`;

  return (
    <main className="work-hours-page-container">
      <div className="work-hours-card">
        {/* Top Header */}
        <div className="work-hours-card-header">
          <div className="header-title-group">
            <div className="header-icon-box">
              <IconSliders size={20} color="#00ff88" />
            </div>
            <div>
              <h2 className="work-hours-heading">Weekly Work Hours & Availability</h2>
              <p className="work-hours-subheading">
                {scopeMode === 'week'
                  ? `Editing specific schedule for ${weekRelativeLabel} (${selectedWeekMonday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEndSunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}).`
                  : 'Editing the all-time recurring template applied to all future weeks by default.'}
              </p>
            </div>
          </div>

          <div className="header-actions">
            {/* View Mode Toggle: Visual Drag Planner vs Form Inputs */}
            <div className="view-mode-toggle-group">
              <button
                type="button"
                className={`view-mode-btn ${viewMode === 'visual' ? 'active' : ''}`}
                onClick={() => setViewMode('visual')}
                title="Interactive drag-and-drop shift canvas"
              >
                <IconClock size={13} />
                <span>Visual Drag Planner</span>
              </button>
              <button
                type="button"
                className={`view-mode-btn ${viewMode === 'form' ? 'active' : ''}`}
                onClick={() => setViewMode('form')}
                title="Text / time inputs list"
              >
                <IconSliders size={13} />
                <span>Time Inputs Form</span>
              </button>
            </div>

            {scopeMode === 'week' && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ borderColor: 'rgba(0, 255, 136, 0.35)', color: '#00ff88', display: 'flex', alignItems: 'center', gap: '6px' }}
                onClick={handleSaveAsDefault}
                title="Save this week's hours as the all-time recurring template for all weeks in the future"
              >
                <IconSliders size={14} />
                <span>Apply as Default for All Future Weeks</span>
              </button>
            )}

            <button className="btn btn-emerald save-all-btn" onClick={handleSaveAll}>
              <IconCheck size={16} />
              <span>
                {scopeMode === 'default'
                  ? 'Save All-Time Default Hours'
                  : `Save Schedule for ${weekRelativeLabel}`}
              </span>
            </button>
          </div>
        </div>

        {/* Scope Selector: Specific Week Override (Default) vs All-Time Default Template */}
        <div className="schedule-scope-bar">
          <div className="scope-tabs-group">
            <button
              type="button"
              className={`scope-tab-btn ${scopeMode === 'week' ? 'active' : ''}`}
              onClick={() => setScopeMode('week')}
            >
              <IconCalendar size={14} />
              <span>Specific Week Schedule</span>
            </button>
            <button
              type="button"
              className={`scope-tab-btn ${scopeMode === 'default' ? 'active' : ''}`}
              onClick={() => setScopeMode('default')}
            >
              <IconSliders size={14} />
              <span>All-Time Default Template</span>
            </button>
          </div>

          {scopeMode === 'week' && (
            <div className="week-scope-navigator" style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary week-nav-arrow"
                    disabled={selectedWeekMonday.getTime() <= currentMonday.getTime()}
                    onClick={() => setSelectedWeekMonday(addDays(selectedWeekMonday, -7))}
                    title={selectedWeekMonday.getTime() <= currentMonday.getTime() ? "Cannot view or edit hours in the past" : "Previous Week"}
                    style={selectedWeekMonday.getTime() <= currentMonday.getTime() ? { opacity: 0.35, cursor: 'not-allowed' } : {}}
                  >
                    <IconChevronLeft size={14} />
                    <span>Prev Week</span>
                  </button>
                  <span className="week-scope-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                    <IconCalendar size={14} color="var(--amber-primary)" />
                    <span>
                      <strong>{weekRelativeLabel}:</strong> {selectedWeekMonday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {weekEndSunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary week-nav-arrow"
                    onClick={() => setSelectedWeekMonday(addDays(selectedWeekMonday, 7))}
                    title="Next Week"
                  >
                    <span>Next Week</span>
                    <IconChevronRight size={14} />
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>Jump to:</span>
                    <input
                      type="date"
                      className="override-date-input"
                      style={{ padding: '3px 8px', fontSize: '11.5px', height: '28px' }}
                      min={formatDateIso(currentMonday)}
                      value={formatDateIso(selectedWeekMonday)}
                      onChange={(e) => {
                        if (e.target.value) {
                          const [y, m, d] = e.target.value.split('-').map(Number);
                          const picked = new Date(y, m - 1, d);
                          const monday = getMonday(picked);
                          if (monday.getTime() < currentMonday.getTime()) {
                            setSelectedWeekMonday(currentMonday);
                          } else {
                            setSelectedWeekMonday(monday);
                          }
                        }
                      }}
                    />
                  </div>

                  {onResetWeekOverrides && (
                    <button
                      type="button"
                      className="btn btn-danger week-reset-btn"
                      style={{ marginLeft: '4px' }}
                      onClick={() => {
                        const start = formatDateIso(selectedWeekMonday);
                        const end = formatDateIso(weekEndSunday);
                        onResetWeekOverrides(start, end);
                      }}
                      title="Clear overrides for this week and restore default template"
                    >
                      <IconRotateCcw size={13} style={{ marginRight: '4px' }} />
                      <span>Reset Week</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Schedule Presets (Clean Single Dropdown) */}
        <div className="presets-bar" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="presets-label" style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <IconZap size={13} />
            <span>Quick Presets:</span>
          </span>
          <select
            className="nav-buffer-select"
            style={{
              background: 'var(--bg-elevated)',
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-default)',
              color: 'var(--emerald-primary)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              outline: 'none',
            }}
            value=""
            onChange={(e) => {
              if (e.target.value) {
                handleApplyPresetLocal(e.target.value as any);
              }
            }}
          >
            <option value="" disabled>Choose a schedule preset...</option>
            <option value="standard">Standard Mon–Fri (09:00 – 17:00)</option>
            <option value="split">Split Shifts (09:00–13:00, 16:00–20:00)</option>
            <option value="extended">Extended Mon–Sat (08:00 – 18:00)</option>
            <option value="all">Full Week 7 Days (09:00 – 18:00)</option>
          </select>
        </div>

        {/* VISUAL DRAGGABLE TIMELINE MODE */}
        {viewMode === 'visual' ? (
          <div className="visual-hours-planner">
            <div className="visual-planner-legend">
              <div className="subbar-legend">
                <span className="legend-item">
                  <span className="legend-dot shift"></span> Working Shift (Click & drag track to add, drag handles to resize)
                </span>
                {scopeMode === 'week' && (
                  <span className="legend-item" style={{ color: 'var(--emerald-primary)' }}>
                    <span className="legend-dot" style={{ background: 'var(--emerald-primary)' }}></span> Specific Week Customization Active
                  </span>
                )}
              </div>
            </div>

            <div className="visual-planner-grid-wrapper">
              {/* Time axis */}
              <div className="time-axis" style={{ height: `${TRACK_HEIGHT}px` }}>
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
                {DISPLAY_ORDER.map((dayNum, colIdx) => {
                  const dayLabel = DAY_LABELS[dayNum];
                  const dayShort = DAY_SHORT[dayNum];
                  const offset = dayNum === 0 ? 6 : dayNum - 1;
                  const dayDate = addDays(selectedWeekMonday, offset);
                  const dateStr = formatDateIso(dayDate);
                  const hasCustomOverride = scopeMode === 'week' && overrides.some((o) => o.date === dateStr);
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const isPastDay = scopeMode === 'week' && dayDate.getTime() < today.getTime();

                  const rule =
                    localRules.find((r) => r.day_of_week === dayNum) || {
                      day_of_week: dayNum,
                      start_time: '09:00',
                      end_time: '17:00',
                      is_active: false,
                      shifts: [{ start_time: '09:00', end_time: '17:00' }],
                    };

                  const isActive = Boolean(rule.is_active);
                  const shifts: TimeInterval[] =
                    rule.shifts && rule.shifts.length > 0
                      ? rule.shifts
                      : isActive
                      ? [{ start_time: rule.start_time, end_time: rule.end_time }]
                      : [];

                  let statusLabel = 'Closed';
                  if (isActive && shifts.length > 0) {
                    if (shifts.length === 1) {
                      statusLabel = `${shifts[0].start_time} - ${shifts[0].end_time}`;
                    } else {
                      statusLabel = `${shifts.length} Shifts`;
                    }
                  }

                  const isCreatingOnThisCol =
                    dragState && dragState.mode === 'create' && dragState.dayOfWeek === dayNum;
                  const createStartM = isCreatingOnThisCol
                    ? Math.min(dragState.currentStartM, dragState.currentEndM)
                    : 0;
                  const createEndM = isCreatingOnThisCol
                    ? Math.max(dragState.currentStartM, dragState.currentEndM)
                    : 0;
                  const createTop = minutesToY(createStartM);
                  const createHeight = Math.max(28, minutesToY(createEndM) - createTop);

                  return (
                    <div key={dayNum} className={`day-column ${isPastDay ? 'is-past-day' : ''}`} data-day={dayNum}>
                      {/* Column Header */}
                      <div className={`day-col-header ${hasCustomOverride ? 'has-override' : ''} ${isPastDay ? 'is-past-header' : ''}`}>
                        <div className="day-header-meta">
                          <span className="day-abbr">
                            {dayShort}
                            {scopeMode === 'week' && (
                              <span style={{ fontSize: '10px', color: isPastDay ? 'var(--text-muted)' : 'var(--text-subtle)', marginLeft: '4px' }}>
                                {dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                          </span>
                          {isPastDay && (
                            <span style={{ fontSize: '9px', background: 'rgba(255, 255, 255, 0.07)', color: 'var(--text-subtle)', padding: '1px 5px', borderRadius: '3px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Past
                            </span>
                          )}
                        </div>
                        <div className="day-header-actions">
                          <span
                            className={`day-col-status ${isActive ? '' : 'closed'}`}
                            style={isPastDay ? { opacity: 0.45, cursor: 'not-allowed' } : {}}
                            onClick={() => {
                              if (isPastDay) return;
                              handleToggleActive(dayNum);
                            }}
                            title={isPastDay ? "Past day schedule cannot be modified" : "Click to toggle Open / Closed"}
                          >
                            {statusLabel}
                          </span>
                        </div>
                      </div>

                      {/* Column Track */}
                      <div
                        className={`day-col-track ${isActive ? '' : 'day-closed'} ${isPastDay ? 'day-past-track' : ''}`}
                        style={{ height: `${TRACK_HEIGHT}px`, cursor: isPastDay ? 'not-allowed' : 'crosshair' }}
                        onMouseDown={(e) => {
                          if (isPastDay) return;
                          handleTrackMouseDown(dayNum, e);
                        }}
                        onTouchStart={(e) => {
                          if (isPastDay) return;
                          handleTrackTouchStart(dayNum, e);
                        }}
                      >
                        {isPastDay && (
                          <div style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            background: 'repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.015), rgba(255, 255, 255, 0.015) 10px, transparent 10px, transparent 20px)',
                            pointerEvents: 'auto',
                            cursor: 'not-allowed',
                            zIndex: 40,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                          }}>
                            <span style={{ fontSize: '10px', color: 'var(--text-subtle)', background: 'rgba(10, 12, 18, 0.9)', border: '1px solid var(--border-subtle)', padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                              Past Day
                            </span>
                          </div>
                        )}

                        {!isActive && !isCreatingOnThisCol && !isPastDay && (
                          <div className="day-closed-notice">
                            <span>Closed</span>
                            <small style={{ fontSize: '9px', opacity: 0.7 }}>Click & drag to open shift</small>
                          </div>
                        )}

                        {/* Working Shifts overlay blocks with Drag-and-Drop */}
                        {isActive && (
                          <>
                            {shifts.map((shift, sIdx) => {
                              const isBeingDragged =
                                dragState &&
                                dragState.dayOfWeek === dayNum &&
                                dragState.shiftIndex === sIdx;

                              const sStartM = isBeingDragged
                                ? dragState.currentStartM
                                : timeToMinutes(shift.start_time);
                              const sEndM = isBeingDragged
                                ? dragState.currentEndM
                                : timeToMinutes(shift.end_time);
                              const sTop = minutesToY(sStartM);
                              const sBottom = minutesToY(sEndM);
                              const sHeight = Math.max(24, sBottom - sTop);

                              // Gap/break overlay between split shifts
                              let breakBlock = null;
                              if (sIdx > 0 && !isBeingDragged) {
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
                                      <IconPause
                                        size={11}
                                        color="var(--text-subtle)"
                                        style={{ marginRight: '4px' }}
                                      />
                                      <span>Break</span>
                                    </div>
                                  );
                                }
                              }

                              return (
                                <React.Fragment key={`shift-${sIdx}`}>
                                  {breakBlock}
                                  <div
                                    className={`avail-block ${isBeingDragged ? 'is-dragging' : ''}`}
                                    style={{ top: `${sTop}px`, height: `${sHeight}px` }}
                                  >
                                    {/* Top Drag Handle (Resize Start) */}
                                    <div
                                      className="avail-drag-handle top"
                                      title="Drag to change start time"
                                      onMouseDown={(e) => {
                                        e.stopPropagation();
                                        setDragState({
                                          dayOfWeek: dayNum,
                                          shiftIndex: sIdx,
                                          mode: 'start',
                                          initialClientY: e.clientY,
                                          initialStartM: sStartM,
                                          initialEndM: sEndM,
                                          currentStartM: sStartM,
                                          currentEndM: sEndM,
                                        });
                                      }}
                                      onTouchStart={(e) => {
                                        e.stopPropagation();
                                        if (e.touches.length === 0) return;
                                        setDragState({
                                          dayOfWeek: dayNum,
                                          shiftIndex: sIdx,
                                          mode: 'start',
                                          initialClientY: e.touches[0].clientY,
                                          initialStartM: sStartM,
                                          initialEndM: sEndM,
                                          currentStartM: sStartM,
                                          currentEndM: sEndM,
                                        });
                                      }}
                                    />

                                    {/* Move Handle & Label */}
                                    <div
                                      className="avail-block-label"
                                      title="Drag block to move shift hours"
                                      onMouseDown={(e) => {
                                        e.stopPropagation();
                                        setDragState({
                                          dayOfWeek: dayNum,
                                          shiftIndex: sIdx,
                                          mode: 'move',
                                          initialClientY: e.clientY,
                                          initialStartM: sStartM,
                                          initialEndM: sEndM,
                                          currentStartM: sStartM,
                                          currentEndM: sEndM,
                                        });
                                      }}
                                      onTouchStart={(e) => {
                                        if ((e.target as HTMLElement).closest('.shift-delete-btn')) return;
                                        e.stopPropagation();
                                        if (e.touches.length === 0) return;
                                        setDragState({
                                          dayOfWeek: dayNum,
                                          shiftIndex: sIdx,
                                          mode: 'move',
                                          initialClientY: e.touches[0].clientY,
                                          initialStartM: sStartM,
                                          initialEndM: sEndM,
                                          currentStartM: sStartM,
                                          currentEndM: sEndM,
                                        });
                                      }}
                                    >
                                      <span className="shift-title-text">
                                        {shifts.length > 1 ? `Shift ${sIdx + 1}: ` : ''}
                                        {minutesToTimeStr(sStartM)} - {minutesToTimeStr(sEndM)}
                                      </span>

                                      {/* Delete Shift Button */}
                                      <button
                                        type="button"
                                        className="shift-delete-btn"
                                        title="Delete this shift"
                                        onClick={(e) => handleDeleteShiftFromVisual(dayNum, sIdx, e)}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                      >
                                        <IconTrash size={11} />
                                      </button>
                                    </div>

                                    {/* Floating Live Time Tooltip when dragging */}
                                    {isBeingDragged && (
                                      <div className="drag-time-tooltip">
                                        <IconClock size={12} color="#00ff88" />
                                        <span>
                                          {minutesToTimeStr(sStartM)} – {minutesToTimeStr(sEndM)}
                                        </span>
                                      </div>
                                    )}

                                    {/* Bottom Drag Handle (Resize End) */}
                                    <div
                                      className="avail-drag-handle bottom"
                                      title="Drag to change end time"
                                      onMouseDown={(e) => {
                                        e.stopPropagation();
                                        setDragState({
                                          dayOfWeek: dayNum,
                                          shiftIndex: sIdx,
                                          mode: 'end',
                                          initialClientY: e.clientY,
                                          initialStartM: sStartM,
                                          initialEndM: sEndM,
                                          currentStartM: sStartM,
                                          currentEndM: sEndM,
                                        });
                                      }}
                                      onTouchStart={(e) => {
                                        e.stopPropagation();
                                        if (e.touches.length === 0) return;
                                        setDragState({
                                          dayOfWeek: dayNum,
                                          shiftIndex: sIdx,
                                          mode: 'end',
                                          initialClientY: e.touches[0].clientY,
                                          initialStartM: sStartM,
                                          initialEndM: sEndM,
                                          currentStartM: sStartM,
                                          currentEndM: sEndM,
                                        });
                                      }}
                                    />
                                  </div>
                                </React.Fragment>
                              );
                            })}
                          </>
                        )}

                        {/* Active creation ghost highlighter */}
                        {isCreatingOnThisCol && (
                          <div
                            className="avail-block is-creating"
                            style={{ top: `${createTop}px`, height: `${createHeight}px` }}
                          >
                            <div className="avail-block-label">
                              <IconPlus size={12} style={{ marginRight: '4px' }} />
                              <span>
                                + Shift: {minutesToTimeStr(createStartM)} - {minutesToTimeStr(createEndM)}
                              </span>
                            </div>
                            <div className="drag-time-tooltip">
                              <IconClock size={12} color="#00ff88" />
                              <span>
                                {minutesToTimeStr(createStartM)} – {minutesToTimeStr(createEndM)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* FORM / TIME INPUTS MODE */
          <div className="days-schedule-list">
            {sortedRules.map((rule) => {
              const dayNum = Number(rule.day_of_week);
              const dayLabel = DAY_LABELS[dayNum];
              const offset = dayNum === 0 ? 6 : dayNum - 1;
              const dayDate = addDays(selectedWeekMonday, offset);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const isPastDay = scopeMode === 'week' && dayDate.getTime() < today.getTime();
              const isActive = Boolean(rule.is_active);
              const shifts: TimeInterval[] =
                rule.shifts && rule.shifts.length > 0
                  ? rule.shifts
                  : [{ start_time: rule.start_time || '09:00', end_time: rule.end_time || '17:00' }];

              return (
                <div key={dayNum} className={`day-schedule-row ${isActive ? 'is-active' : 'is-closed'} ${isPastDay ? 'is-past-day' : ''}`} style={isPastDay ? { opacity: 0.6 } : {}}>
                  {/* Day Meta & Switch */}
                  <div className="day-meta-cell">
                    <label className="switch-wrap" style={isPastDay ? { cursor: 'not-allowed' } : {}}>
                      <div className="switch">
                        <input
                          type="checkbox"
                          checked={isActive}
                          disabled={isPastDay}
                          onChange={() => {
                            if (!isPastDay) handleToggleActive(dayNum);
                          }}
                        />
                        <span className="slider" style={isPastDay ? { opacity: 0.4 } : {}}></span>
                      </div>
                      <span className="day-name-text">
                        {dayLabel}
                        {scopeMode === 'week' && (
                          <span style={{ fontSize: '11px', color: 'var(--text-subtle)', marginLeft: '6px' }}>
                            ({dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})
                          </span>
                        )}
                      </span>
                    </label>
                    <span className={`day-state-tag ${isActive ? 'active' : 'closed'}`}>
                      {isPastDay ? 'Past (Locked)' : isActive ? (shifts.length > 1 ? `${shifts.length} Shifts` : 'Open') : 'Closed'}
                    </span>
                  </div>

                  {/* Shifts Editor */}
                  <div className="shifts-editor-cell">
                    {isActive ? (
                      <div className="shifts-list-container">
                        {shifts.map((shift, sIdx) => (
                          <div key={sIdx} className="shift-time-picker-row">
                            <span className="shift-index-badge">
                              {shifts.length > 1 ? `Shift ${sIdx + 1}` : 'Hours'}
                            </span>

                            <input
                              type="time"
                              disabled={isPastDay}
                              className="time-picker-input"
                              value={shift.start_time}
                              onChange={(e) =>
                                !isPastDay && handleShiftChange(dayNum, sIdx, 'start_time', e.target.value)
                              }
                            />
                            <span className="time-separator">to</span>
                            <input
                              type="time"
                              disabled={isPastDay}
                              className="time-picker-input"
                              value={shift.end_time}
                              onChange={(e) =>
                                !isPastDay && handleShiftChange(dayNum, sIdx, 'end_time', e.target.value)
                              }
                            />

                            {shifts.length > 1 && !isPastDay && (
                              <button
                                type="button"
                                className="remove-shift-btn"
                                title="Remove this shift"
                                onClick={() => handleRemoveShift(dayNum, sIdx)}
                              >
                                <IconTrash size={13} />
                              </button>
                            )}
                          </div>
                        ))}

                        {!isPastDay && (
                          <button
                            type="button"
                            className="add-shift-btn"
                            onClick={() => handleAddShift(dayNum)}
                          >
                            <IconPlus size={12} />
                            <span>Add Split Shift</span>
                          </button>
                        )}
                        {isPastDay && (
                          <span style={{ fontSize: '11px', color: 'var(--text-subtle)', fontStyle: 'italic' }}>
                            Past day schedule cannot be modified.
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="day-closed-msg">
                        <span>{isPastDay ? 'Clinic was closed (Past Day)' : 'Doctor unavailable / clinic closed'}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Commute Buffer & Date Blockouts Grid */}
        <div className="extras-grid">
          {/* Commute Buffer Card */}
          <div className="extra-card">
            <div className="extra-card-header">
              <IconCar size={18} color="var(--cyan-primary)" />
              <div>
                <h4 className="extra-card-title">Home Visit Commute Buffer</h4>
                <p className="extra-card-desc">
                  Travel time reserved on road before &amp; after visits
                  {scopeMode === 'week' && selectedBuffer !== defaultBuffer && (
                    <span style={{ marginLeft: '8px', color: 'var(--cyan-primary)', fontWeight: 600 }}>
                      — Week override active: {selectedBuffer} min (default: {defaultBuffer} min)
                    </span>
                  )}
                  {scopeMode === 'week' && selectedBuffer === defaultBuffer && (
                    <span style={{ marginLeft: '8px', color: 'var(--text-subtle)', fontStyle: 'italic' }}>
                      — Using default ({defaultBuffer} min)
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="commute-buttons-row">
              {[15, 30, 45, 60].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  className={`buffer-btn ${selectedBuffer === mins ? 'selected' : ''}`}
                  onClick={() => setSelectedBuffer(mins)}
                >
                  {mins} mins
                </button>
              ))}
            </div>
            <p style={{ fontSize: '11.5px', color: 'var(--text-subtle)', marginTop: '6px' }}>
              Buffer is saved when you click Save below.
            </p>
          </div>

          {/* Date Overrides / Blockouts Card */}
          <div className="extra-card">
            <div className="extra-card-header">
              <IconCalendar size={18} color="#00ff88" />
              <div>
                <h4 className="extra-card-title">Specific Date Blockouts</h4>
                <p className="extra-card-desc">Block out vacation or holiday exceptions</p>
              </div>
            </div>

            <div className="add-override-form">
              <input
                type="date"
                min={formatDateIso(new Date())}
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="override-date-input"
              />
              <input
                type="text"
                placeholder="Reason (e.g. Vacation, Medical Conference)"
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                className="override-reason-input"
              />
              <button
                type="button"
                className="btn btn-secondary add-override-btn"
                onClick={handleAddOverrideSubmit}
              >
                <IconPlus size={14} />
                <span>Block Date</span>
              </button>
            </div>

            {overrides && overrides.length > 0 ? (
              <div className="overrides-chips-list">
                {overrides.map((ov) => (
                  <div key={ov.id} className="override-chip-item">
                    <span className="override-date-badge">{ov.date}</span>
                    <span className="override-reason-text">{ov.reason || 'Blocked'}</span>
                    <button
                      type="button"
                      className="override-delete-btn"
                      onClick={() => onDeleteOverride(ov.id)}
                      title="Remove date blockout"
                    >
                      <IconTrash size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="no-overrides-text">No active date blockouts.</div>
            )}
          </div>
        </div>

        {/* Bottom Save Bar */}
        <div className="work-hours-bottom-bar" style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
          {scopeMode === 'week' && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ borderColor: 'rgba(0, 255, 136, 0.35)', color: '#00ff88', padding: '10px 18px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              onClick={handleSaveAsDefault}
              title="Save this week's hours as the all-time recurring template for all weeks in the future"
            >
              <IconSliders size={15} />
              <span>Apply as Default for All Future Weeks</span>
            </button>
          )}
          <button className="btn btn-emerald save-all-btn-large" onClick={handleSaveAll}>
            <IconCheck size={16} />
            <span>
              {scopeMode === 'default'
                ? 'Save All-Time Default Hours'
                : `Save Schedule for ${weekRelativeLabel} (${formatDateIso(selectedWeekMonday)})`}
            </span>
          </button>
        </div>
      </div>
    </main>
  );
};
