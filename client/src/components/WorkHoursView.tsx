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
} from './Icons';

interface WorkHoursViewProps {
  rules: AvailabilityRule[];
  overrides: DateOverride[];
  commuteBufferMinutes: number;
  onApplyPreset: (preset: 'standard' | 'split' | 'extended' | 'all') => void;
  onSaveRule: (rule: AvailabilityRule) => void;
  onSaveAllRules: (rules: AvailabilityRule[]) => void;
  onSaveWeekOverrides?: (overrides: Array<{ date: string; is_unavailable: boolean; start_time?: string; end_time?: string; reason?: string; shifts?: TimeInterval[] }>) => void;
  onResetWeekOverrides?: (startDate: string, endDate: string) => void;
  onUpdateCommuteBuffer: (minutes: number) => void;
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
  onApplyPreset,
  onSaveRule,
  onSaveAllRules,
  onSaveWeekOverrides,
  onResetWeekOverrides,
  onUpdateCommuteBuffer,
  onAddOverride,
  onDeleteOverride,
}) => {
  const [scopeMode, setScopeMode] = useState<'default' | 'week'>('default');
  const [selectedWeekMonday, setSelectedWeekMonday] = useState<Date>(() => getMonday(new Date()));
  const [viewMode, setViewMode] = useState<'visual' | 'form'>('visual');
  const [localRules, setLocalRules] = useState<AvailabilityRule[]>([]);
  const [selectedBuffer, setSelectedBuffer] = useState<number>(commuteBufferMinutes || 30);
  const [newDate, setNewDate] = useState('');
  const [newReason, setNewReason] = useState('');

  // Drag state for visual mode
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  dragStateRef.current = dragState;

  // Sync rules, overrides, and buffer when props or scopeMode / selectedWeekMonday update
  useEffect(() => {
    setSelectedBuffer(commuteBufferMinutes || 30);

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
  }, [rules, overrides, commuteBufferMinutes, scopeMode, selectedWeekMonday]);

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

    if (dragState) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
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
      const weekOverrides = DISPLAY_ORDER.map((dayNum) => {
        const offset = dayNum === 0 ? 6 : dayNum - 1;
        const dayDate = addDays(selectedWeekMonday, offset);
        const dateStr = formatDateIso(dayDate);
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
      });
      onSaveWeekOverrides(weekOverrides);
    }

    if (selectedBuffer !== commuteBufferMinutes) {
      onUpdateCommuteBuffer(selectedBuffer);
    }
  };

  const handleAddOverrideSubmit = () => {
    if (!newDate) return alert('Please choose a date to block out.');
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

  const weekEndSunday = addDays(selectedWeekMonday, 6);

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
                Configure your all-time recurring template or customize hours for any specific week.
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

            <button className="btn btn-emerald save-all-btn" onClick={handleSaveAll}>
              <IconCheck size={16} />
              <span>
                {scopeMode === 'default'
                  ? 'Save All-Time Default Hours'
                  : `Save Schedule for Week (${formatDateIso(selectedWeekMonday)})`}
              </span>
            </button>
          </div>
        </div>

        {/* Scope Selector: All-Time Default vs Specific Week Override */}
        <div className="schedule-scope-bar">
          <div className="scope-tabs-group">
            <button
              type="button"
              className={`scope-tab-btn ${scopeMode === 'default' ? 'active' : ''}`}
              onClick={() => setScopeMode('default')}
            >
              <IconSliders size={14} />
              <span>All-Time Default Template</span>
            </button>
            <button
              type="button"
              className={`scope-tab-btn ${scopeMode === 'week' ? 'active' : ''}`}
              onClick={() => setScopeMode('week')}
            >
              <IconCalendar size={14} />
              <span>Specific Week Override</span>
            </button>
          </div>

          {scopeMode === 'week' && (
            <div className="week-scope-navigator">
              <button
                type="button"
                className="btn btn-secondary week-nav-arrow"
                onClick={() => setSelectedWeekMonday(addDays(selectedWeekMonday, -7))}
                title="Previous Week"
              >
                <IconChevronLeft size={14} />
                <span>Prev Week</span>
              </button>
              <span className="week-scope-badge">
                <IconCalendar size={13} style={{ marginRight: '6px' }} />
                <span>Week of {selectedWeekMonday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {weekEndSunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
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
              <button
                type="button"
                className="btn btn-secondary week-nav-today"
                onClick={() => setSelectedWeekMonday(getMonday(new Date()))}
              >
                This Week
              </button>
              {onResetWeekOverrides && (
                <button
                  type="button"
                  className="btn btn-secondary week-reset-btn"
                  onClick={() => {
                    const start = formatDateIso(selectedWeekMonday);
                    const end = formatDateIso(weekEndSunday);
                    onResetWeekOverrides(start, end);
                  }}
                  title="Clear overrides for this week and restore default template"
                >
                  <IconRotateCcw size={13} style={{ marginRight: '5px' }} />
                  <span>Reset Week to Default</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Schedule Presets */}
        <div className="presets-bar">
          <span className="presets-label">Schedule Presets:</span>
          <div className="presets-buttons">
            <button type="button" className="preset-btn" onClick={() => handleApplyPresetLocal('standard')}>
              Standard (Mon–Fri 9–5)
            </button>
            <button type="button" className="preset-btn" onClick={() => handleApplyPresetLocal('split')}>
              Split Shifts (9–1 & 4–8)
            </button>
            <button type="button" className="preset-btn" onClick={() => handleApplyPresetLocal('extended')}>
              Extended (Mon–Sat 8–6)
            </button>
            <button type="button" className="preset-btn" onClick={() => handleApplyPresetLocal('all')}>
              All 7 Days Open
            </button>
          </div>
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
                  <span className="legend-item" style={{ color: '#38bdf8' }}>
                    <span className="legend-dot" style={{ background: '#38bdf8' }}></span> Specific Week Customization Active
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
                    <div key={dayNum} className="day-column" data-day={dayNum}>
                      {/* Column Header */}
                      <div className={`day-col-header ${hasCustomOverride ? 'has-override' : ''}`}>
                        <div className="day-header-meta">
                          <span className="day-abbr">
                            {dayShort}
                            {scopeMode === 'week' && (
                              <span style={{ fontSize: '10px', color: 'var(--text-subtle)', marginLeft: '4px' }}>
                                {dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="day-header-actions">
                          <span
                            className={`day-col-status ${isActive ? '' : 'closed'}`}
                            onClick={() => handleToggleActive(dayNum)}
                            title="Click to toggle Open / Closed"
                          >
                            {statusLabel}
                          </span>
                        </div>
                      </div>

                      {/* Column Track */}
                      <div
                        className={`day-col-track ${isActive ? '' : 'day-closed'}`}
                        style={{ height: `${TRACK_HEIGHT}px`, cursor: 'crosshair' }}
                        onMouseDown={(e) => handleTrackMouseDown(dayNum, e)}
                      >
                        {!isActive && !isCreatingOnThisCol && (
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
              const isActive = Boolean(rule.is_active);
              const shifts: TimeInterval[] =
                rule.shifts && rule.shifts.length > 0
                  ? rule.shifts
                  : [{ start_time: rule.start_time || '09:00', end_time: rule.end_time || '17:00' }];

              return (
                <div key={dayNum} className={`day-schedule-row ${isActive ? 'is-active' : 'is-closed'}`}>
                  {/* Day Meta & Switch */}
                  <div className="day-meta-cell">
                    <label className="switch-wrap">
                      <div className="switch">
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={() => handleToggleActive(dayNum)}
                        />
                        <span className="slider"></span>
                      </div>
                      <span className="day-name-text">{dayLabel}</span>
                    </label>
                    <span className={`day-state-tag ${isActive ? 'active' : 'closed'}`}>
                      {isActive ? (shifts.length > 1 ? `${shifts.length} Shifts` : 'Open') : 'Closed'}
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
                              className="time-picker-input"
                              value={shift.start_time}
                              onChange={(e) =>
                                handleShiftChange(dayNum, sIdx, 'start_time', e.target.value)
                              }
                            />
                            <span className="time-separator">to</span>
                            <input
                              type="time"
                              className="time-picker-input"
                              value={shift.end_time}
                              onChange={(e) =>
                                handleShiftChange(dayNum, sIdx, 'end_time', e.target.value)
                              }
                            />

                            {shifts.length > 1 && (
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

                        <button
                          type="button"
                          className="add-shift-btn"
                          onClick={() => handleAddShift(dayNum)}
                        >
                          <IconPlus size={12} />
                          <span>Add Split Shift</span>
                        </button>
                      </div>
                    ) : (
                      <div className="day-closed-msg">
                        <span>Doctor unavailable / clinic closed</span>
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
              <IconCar size={18} color="#38bdf8" />
              <div>
                <h4 className="extra-card-title">Home Visit Commute Buffer</h4>
                <p className="extra-card-desc">Travel time reserved on road before & after visits</p>
              </div>
            </div>

            <div className="commute-buttons-row">
              {[15, 30, 45, 60].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  className={`buffer-btn ${selectedBuffer === mins ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedBuffer(mins);
                    onUpdateCommuteBuffer(mins);
                  }}
                >
                  {mins} mins
                </button>
              ))}
            </div>
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
        <div className="work-hours-bottom-bar">
          <button className="btn btn-emerald save-all-btn-large" onClick={handleSaveAll}>
            <IconCheck size={16} />
            <span>
              {scopeMode === 'default'
                ? 'Save All-Time Default Hours'
                : `Save Custom Schedule for Week (${formatDateIso(selectedWeekMonday)})`}
            </span>
          </button>
        </div>
      </div>
    </main>
  );
};
