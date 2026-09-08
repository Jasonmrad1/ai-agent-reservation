import React, { useState } from 'react';
import { AvailabilityRule, DateOverride, TimeInterval } from '../types';
import { IconClock, IconCar, IconPlus, IconX, IconTrash, IconCalendar, IconCheck } from './Icons';

interface WorkHoursModalProps {
  isOpen: boolean;
  rules: AvailabilityRule[];
  overrides: DateOverride[];
  commuteBufferMinutes: number;
  onClose: () => void;
  onApplyPreset: (preset: 'standard' | 'split' | 'extended' | 'all') => void;
  onSaveRule: (rule: AvailabilityRule) => void;
  onSaveAllRules: (rules: AvailabilityRule[]) => void;
  onUpdateCommuteBuffer: (minutes: number) => void;
  onAddOverride: (date: string, reason: string) => void;
  onDeleteOverride: (id: string) => void;
}

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon to Sun

export const WorkHoursModal: React.FC<WorkHoursModalProps> = ({
  isOpen,
  rules,
  overrides,
  commuteBufferMinutes,
  onClose,
  onApplyPreset,
  onSaveRule,
  onSaveAllRules,
  onUpdateCommuteBuffer,
  onAddOverride,
  onDeleteOverride,
}) => {
  const [localRules, setLocalRules] = useState<AvailabilityRule[]>([]);
  const [selectedBuffer, setSelectedBuffer] = useState<number>(commuteBufferMinutes || 30);
  const [newDate, setNewDate] = useState('');
  const [newReason, setNewReason] = useState('');

  // Sync rules and buffer when modal opens
  React.useEffect(() => {
    setSelectedBuffer(commuteBufferMinutes || 30);
    if (rules.length > 0) {
      const cloned: AvailabilityRule[] = JSON.parse(JSON.stringify(rules)).map((r: AvailabilityRule) => ({
        ...r,
        shifts: (r.shifts && r.shifts.length > 0) ? r.shifts : [{ start_time: r.start_time || '09:00', end_time: r.end_time || '17:00' }],
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
  }, [rules, commuteBufferMinutes, isOpen]);

  if (!isOpen) return null;

  const handleToggleActive = (day: number) => {
    setLocalRules((prev) =>
      prev.map((r) => (r.day_of_week === day ? { ...r, is_active: !r.is_active } : r))
    );
  };

  const handleShiftChange = (day: number, shiftIndex: number, field: 'start_time' | 'end_time', val: string) => {
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
    onSaveAllRules(localRules);
    if (selectedBuffer !== commuteBufferMinutes) {
      onUpdateCommuteBuffer(selectedBuffer);
    }
  };

  const handleAddOverrideSubmit = () => {
    if (!newDate) return alert('Please choose a date.');
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <IconClock size={18} color="#00ff88" />
              <h3 style={{ margin: 0, color: '#fff', fontSize: '16px', fontWeight: 600 }}>Weekly Work Hours & Commute</h3>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--text-subtle)' }}>
              Configure split shifts, daily working hours, and road commute travel buffers.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-subtle)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px',
            }}
          >
            <IconX size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* Commute & Travel Buffer Section */}
          <div style={{
            background: 'rgba(0, 255, 136, 0.04)',
            border: '1px solid rgba(0, 255, 136, 0.2)',
            borderRadius: '8px',
            padding: '12px 14px',
            marginBottom: '16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <IconCar size={16} color="#00ff88" />
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#00ff88' }}>Home Visit Commute Buffer</span>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Required travel time between visits</span>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-subtle)', margin: '0 0 10px', lineHeight: '1.4' }}>
              Guarantees travel time on the road before and after patient home visits so you are never rushed or double-booked back-to-back.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[15, 30, 45, 60].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => {
                    setSelectedBuffer(mins);
                    onUpdateCommuteBuffer(mins);
                  }}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    background: selectedBuffer === mins ? 'rgba(0, 255, 136, 0.18)' : '#11141a',
                    color: selectedBuffer === mins ? '#00ff88' : 'var(--text-muted)',
                    border: selectedBuffer === mins ? '1px solid #00ff88' : '1px solid #222731',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {mins} mins
                </button>
              ))}
            </div>
          </div>

          {/* Presets */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-subtle)', marginBottom: '6px' }}>
              Schedule Presets
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '5px 9px' }}
                onClick={() => onApplyPreset('standard')}
              >
                Standard 9–5
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '5px 9px', borderColor: 'rgba(0, 255, 136, 0.3)', color: '#00ff88' }}
                onClick={() => onApplyPreset('split')}
              >
                Split Shifts (9–1 & 4–8)
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '5px 9px' }}
                onClick={() => onApplyPreset('extended')}
              >
                Extended 8–6
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '5px 9px' }}
                onClick={() => onApplyPreset('all')}
              >
                All 7 Days Open
              </button>
            </div>
          </div>

          {/* Schedule List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {sortedRules.map((rule) => {
              const dayName = DAY_LABELS[rule.day_of_week];
              const shifts = (rule.shifts && rule.shifts.length > 0)
                ? rule.shifts
                : [{ start_time: rule.start_time, end_time: rule.end_time }];

              return (
                <div
                  key={rule.day_of_week}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: rule.is_active ? '#0d1016' : 'rgba(255, 255, 255, 0.01)',
                    border: rule.is_active ? '1px solid #1f2530' : '1px dashed #1a1e27',
                    opacity: rule.is_active ? 1 : 0.65,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: rule.is_active ? '8px' : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input
                        type="checkbox"
                        id={`active-${rule.day_of_week}`}
                        checked={rule.is_active}
                        onChange={() => handleToggleActive(rule.day_of_week)}
                        style={{ cursor: 'pointer', accentColor: 'var(--emerald)' }}
                      />
                      <label
                        htmlFor={`active-${rule.day_of_week}`}
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          color: rule.is_active ? 'var(--text)' : 'var(--text-subtle)',
                        }}
                      >
                        {dayName}
                      </label>
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: rule.is_active ? 'rgba(0, 255, 136, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                          color: rule.is_active ? '#00ff88' : 'var(--text-subtle)',
                          fontWeight: 500,
                        }}
                      >
                        {rule.is_active ? `${shifts.length} shift${shifts.length > 1 ? 's' : ''}` : 'Closed'}
                      </span>
                    </div>

                    {rule.is_active && (
                      <button
                        type="button"
                        onClick={() => handleAddShift(rule.day_of_week)}
                        style={{
                          background: 'transparent',
                          border: '1px dashed rgba(0, 255, 136, 0.35)',
                          color: '#00ff88',
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <IconPlus size={12} />
                        <span>Add Shift / Break</span>
                      </button>
                    )}
                  </div>

                  {rule.is_active && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                      {shifts.map((shift, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '24px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--text-subtle)', minWidth: '46px' }}>
                            Shift {idx + 1}:
                          </span>
                          <input
                            type="time"
                            className="form-control"
                            value={shift.start_time}
                            onChange={(e) => handleShiftChange(rule.day_of_week, idx, 'start_time', e.target.value)}
                            style={{
                              width: '90px',
                              padding: '4px 6px',
                              fontSize: '12px',
                              background: '#141820',
                              color: '#fff',
                              border: '1px solid #282f3d',
                              borderRadius: '4px',
                            }}
                          />
                          <span style={{ color: 'var(--text-subtle)', fontSize: '11px' }}>to</span>
                          <input
                            type="time"
                            className="form-control"
                            value={shift.end_time}
                            onChange={(e) => handleShiftChange(rule.day_of_week, idx, 'end_time', e.target.value)}
                            style={{
                              width: '90px',
                              padding: '4px 6px',
                              fontSize: '12px',
                              background: '#141820',
                              color: '#fff',
                              border: '1px solid #282f3d',
                              borderRadius: '4px',
                            }}
                          />

                          {shifts.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveShift(rule.day_of_week, idx)}
                              title="Remove shift segment"
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#f87171',
                                cursor: 'pointer',
                                padding: '2px',
                                display: 'flex',
                                alignItems: 'center',
                              }}
                            >
                              <IconTrash size={13} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Date Overrides Section */}
          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
              Date-Specific Blockouts & Overrides
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-subtle)', margin: '0 0 10px' }}>
              Completely block a specific date for holiday, conference, or personal off-time.
            </p>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <input
                type="date"
                className="form-control"
                style={{ width: '140px', fontSize: '12px', background: '#141820', color: '#fff', border: '1px solid #282f3d', borderRadius: '4px', padding: '5px 8px' }}
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
              />
              <input
                type="text"
                className="form-control"
                placeholder="Reason (e.g. Medical Conference)"
                style={{ flex: 1, fontSize: '12px', background: '#141820', color: '#fff', border: '1px solid #282f3d', borderRadius: '4px', padding: '5px 8px' }}
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '12px', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                onClick={handleAddOverrideSubmit}
              >
                <IconPlus size={12} />
                <span>Block Date</span>
              </button>
            </div>

            {overrides && overrides.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {overrides.map((ov) => (
                  <div
                    key={ov.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      background: 'rgba(248, 113, 113, 0.08)',
                      border: '1px solid rgba(248, 113, 113, 0.2)',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, color: '#f87171' }}>{ov.date}</span>
                      <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
                        {ov.reason || 'Unavailable / Closed'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteOverride(ov.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-subtle)',
                        fontSize: '12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <IconTrash size={13} />
                      <span>Delete</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '11px', color: 'var(--text-subtle)', fontStyle: 'italic' }}>
                No active blockout dates configured.
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '14px 18px', borderTop: '1px solid var(--border)' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveAll}
            style={{ fontWeight: 600 }}
          >
            Save All Weekly Hours
          </button>
        </div>
      </div>
    </div>
  );
};
