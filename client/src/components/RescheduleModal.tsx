import { parseTimeInfo } from './CalendarGrid';
import React, { useState, useEffect } from 'react';
import { Appointment } from '../types';
import {
  IconX,
  IconSparkles,
  IconCalendar,
  IconClock,
  IconMessage,
  IconAlertCircle,
  IconSun,
  IconCheck,
  IconBuilding,
  IconHome,
  IconMapPin,
  IconRotateCcw,
  IconZap,
} from './Icons';

export interface DirectMoveParams {
  appointmentId: string;
  date: string;
  time: string;
  visit_type?: 'in_office' | 'home_visit';
  address?: string;
  notes?: string;
  override?: boolean;
  send_whatsapp?: boolean;
}

export interface AiOutreachParams {
  appointmentId: string;
  doctorPrompt: string;
  proposedDate?: string;
  proposedTime?: string;
  language: string;
}

interface RescheduleModalProps {
  appointment: Appointment | null;
  onClose: () => void;
  onSubmit: (params: AiOutreachParams) => Promise<void>;
  onDirectMove?: (params: DirectMoveParams) => Promise<void>;
}

export const RescheduleModal: React.FC<RescheduleModalProps> = ({
  appointment,
  onClose,
  onSubmit,
  onDirectMove,
}) => {
  const [activeTab, setActiveTab] = useState<'direct' | 'ai'>('direct');

  // Direct Move state
  const [directDate, setDirectDate] = useState('');
  const [directTime, setDirectTime] = useState('');
  const [directVisitType, setDirectVisitType] = useState<'in_office' | 'home_visit'>('in_office');
  const [directAddress, setDirectAddress] = useState('');
  const [directOverride, setDirectOverride] = useState(false);
  const [directSendWhatsApp, setDirectSendWhatsApp] = useState(true);
  const [directNotes, setDirectNotes] = useState('');

  // AI Outreach state
  const [prompt, setPrompt] = useState('');
  const [proposedDate, setProposedDate] = useState('');
  const [proposedTime, setProposedTime] = useState('');
  const [language, setLanguage] = useState('auto');

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync state with selected appointment
  useEffect(() => {
    if (appointment) {
      const info = parseTimeInfo(appointment.start_time);
      setDirectDate(info.dateKey);
      setDirectTime(info.timeStr24);
      setDirectVisitType(appointment.visit_type === 'home_visit' ? 'home_visit' : 'in_office');
      setDirectAddress(appointment.address || '');
      setDirectOverride(false);
      setDirectSendWhatsApp(true);
      setDirectNotes('');
      setErrorMessage(null);
    }
  }, [appointment]);

  if (!appointment) return null;

  const handleDirectSubmit = async (forceOverride = false) => {
    if (!onDirectMove) return;
    setErrorMessage(null);
    if (!directDate) {
      setErrorMessage('Please select a new date.');
      return;
    }
    if (!directTime) {
      setErrorMessage('Please select a new time.');
      return;
    }
    if (directVisitType === 'home_visit' && !directAddress.trim()) {
      setErrorMessage('Home visits require a physical address.');
      return;
    }

    const useOverride = forceOverride || directOverride;
    setLoading(true);
    try {
      await onDirectMove({
        appointmentId: appointment.id,
        date: directDate,
        time: directTime,
        visit_type: directVisitType,
        address: directVisitType === 'home_visit' ? directAddress.trim() : undefined,
        notes: directNotes.trim() || undefined,
        override: useOverride,
        send_whatsapp: directSendWhatsApp,
      });
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to move appointment');
    } finally {
      setLoading(false);
    }
  };

  const handleAiSubmit = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      await onSubmit({
        appointmentId: appointment.id,
        doctorPrompt: prompt,
        proposedDate: proposedDate || undefined,
        proposedTime: proposedTime || undefined,
        language,
      });
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to dispatch AI reschedule request');
    } finally {
      setLoading(false);
    }
  };

  const isConflictError =
    errorMessage &&
    (errorMessage.toLowerCase().includes('conflict') ||
      errorMessage.toLowerCase().includes('outside') ||
      errorMessage.toLowerCase().includes('buffer'));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card modal-card-spacious"
        style={{ maxWidth: '640px', width: '92vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="modal-header"
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: activeTab === 'direct' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(168, 85, 247, 0.15)',
                border: activeTab === 'direct' ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(168, 85, 247, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: activeTab === 'direct' ? 'var(--emerald-primary)' : '#c084fc',
                transition: 'all 0.2s ease',
              }}
            >
              {activeTab === 'direct' ? <IconRotateCcw size={18} /> : <IconSparkles size={18} />}
            </div>
            <div>
              <h3 style={{ fontSize: '16px', color: '#fff', fontWeight: 700, margin: 0 }}>
                Reschedule & Move Appointment
              </h3>
              <div style={{ fontSize: '12.5px', color: '#94a3b8', marginTop: '2px' }}>
                {activeTab === 'direct'
                  ? 'Instantly relocate appointment on calendar with manual override.'
                  : 'Let Gemini AI propose new candidate dates over WhatsApp.'}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="modal-close-btn"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '8px',
              color: '#94a3b8',
              cursor: 'pointer',
              display: 'flex',
              padding: '6px',
            }}
          >
            <IconX size={18} />
          </button>
        </div>

        {/* Tab Switcher: Direct Move vs AI Outreach */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            background: '#090b0e',
            padding: '0 24px',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setActiveTab('direct');
              setErrorMessage(null);
            }}
            style={{
              padding: '12px 18px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'direct' ? '2px solid #00f59b' : '2px solid transparent',
              color: activeTab === 'direct' ? '#00f59b' : '#64748b',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
          >
            <IconRotateCcw size={13} />
            <span>Direct Move (Instant Override)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('ai');
              setErrorMessage(null);
            }}
            style={{
              padding: '12px 18px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'ai' ? '2px solid #a78bfa' : '2px solid transparent',
              color: activeTab === 'ai' ? '#a78bfa' : '#64748b',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
          >
            <IconSparkles size={13} />
            <span>AI WhatsApp Outreach</span>
          </button>
        </div>

        {/* Modal Body */}
        <div
          className="modal-body"
          style={{
            padding: '20px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            maxHeight: '62vh',
            overflowY: 'auto',
          }}
        >
          {/* Current appointment badge */}
          <div
            style={{
              background: '#0c0e12',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '10px',
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em', fontWeight: 600 }}>
                Patient & Service
              </div>
              <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#fff', marginTop: '2px' }}>
                {appointment.customer_name || 'Patient'} • {appointment.service}
              </div>
            </div>
            <div
              style={{
                fontSize: '12.5px',
                color: '#a7f3d0',
                fontFamily: "'JetBrains Mono', monospace",
                background: 'rgba(0, 255, 136, 0.08)',
                border: '1px solid rgba(0, 255, 136, 0.2)',
                padding: '4px 10px',
                borderRadius: '6px',
              }}
            >
              Current: {new Date(appointment.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>

          {/* Error Banner with Override Retry */}
          {errorMessage && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '10px',
                padding: '12px 16px',
                color: '#fca5a5',
                fontSize: '13px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <IconAlertCircle size={16} color="#ef4444" />
                <span style={{ fontWeight: 600 }}>{errorMessage}</span>
              </div>
              {isConflictError && activeTab === 'direct' && !directOverride && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setDirectOverride(true);
                      handleDirectSubmit(true);
                    }}
                    style={{
                      background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '6px 14px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <IconZap size={13} /> Enable Override & Move Anyway
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 1: DIRECT MOVE CONTENT */}
          {activeTab === 'direct' && (
            <>
              {/* Date & Time */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label
                    style={{
                      fontSize: '11px',
                      color: '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginBottom: '6px',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}
                  >
                    <IconCalendar size={12} /> New Date *
                  </label>
                  <input
                    type="date"
                    value={directDate}
                    onChange={(e) => setDirectDate(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: '#fff',
                      fontSize: '13.5px',
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      fontSize: '11px',
                      color: '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginBottom: '6px',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}
                  >
                    <IconClock size={12} /> New Time *
                  </label>
                  <input
                    type="time"
                    value={directTime}
                    onChange={(e) => setDirectTime(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: '#fff',
                      fontSize: '13.5px',
                    }}
                  />
                </div>
              </div>

              {/* Visit Type Toggle */}
              <div>
                <label
                  style={{
                    fontSize: '11px',
                    color: '#64748b',
                    display: 'block',
                    marginBottom: '6px',
                    textTransform: 'uppercase',
                    fontWeight: 600,
                  }}
                >
                  Consultation Location
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setDirectVisitType('in_office')}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background:
                        directVisitType === 'in_office' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                      border:
                        directVisitType === 'in_office' ? '1px solid var(--emerald-primary)' : '1px solid var(--border-subtle)',
                      color: directVisitType === 'in_office' ? 'var(--emerald-primary)' : '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      fontWeight: 600,
                      fontSize: '12.5px',
                      cursor: 'pointer',
                    }}
                  >
                    <IconBuilding size={15} />
                    <span>In-Office Clinic</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDirectVisitType('home_visit')}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background:
                        directVisitType === 'home_visit' ? 'rgba(244, 63, 94, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                      border:
                        directVisitType === 'home_visit' ? '1px solid #f43f5e' : '1px solid var(--border-subtle)',
                      color: directVisitType === 'home_visit' ? '#f43f5e' : '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      fontWeight: 600,
                      fontSize: '12.5px',
                      cursor: 'pointer',
                    }}
                  >
                    <IconHome size={15} />
                    <span>Home Visit</span>
                  </button>
                </div>
              </div>

              {/* Address for home visit */}
              {directVisitType === 'home_visit' && (
                <div
                  style={{
                    background: 'rgba(244, 63, 94, 0.04)',
                    border: '1px solid rgba(244, 63, 94, 0.2)',
                    borderRadius: '8px',
                    padding: '12px 14px',
                  }}
                >
                  <label
                    style={{
                      fontSize: '11px',
                      color: '#f43f5e',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginBottom: '6px',
                      textTransform: 'uppercase',
                      fontWeight: 700,
                    }}
                  >
                    <IconMapPin size={12} /> Patient Physical Address *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Achrafieh, Rue Monot, Bldg 14, 3rd Floor"
                    value={directAddress}
                    onChange={(e) => setDirectAddress(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '6px',
                      background: 'var(--bg-input)',
                      border: '1px solid rgba(244, 63, 94, 0.3)',
                      color: '#fff',
                      fontSize: '13px',
                    }}
                  />
                </div>
              )}

              {/* Doctor Reschedule Note */}
              <div>
                <label
                  style={{
                    fontSize: '11px',
                    color: '#64748b',
                    display: 'block',
                    marginBottom: '6px',
                    textTransform: 'uppercase',
                    fontWeight: 600,
                  }}
                >
                  Doctor Note / Reason (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Patient requested morning move in person at clinic."
                  value={directNotes}
                  onChange={(e) => setDirectNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-default)',
                    color: '#fff',
                    fontSize: '13px',
                  }}
                />
              </div>

              {/* Override & WhatsApp Checkboxes */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '10px',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                {/* Override */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={directOverride}
                    onChange={(e) => setDirectOverride(e.target.checked)}
                    style={{ marginTop: '3px', cursor: 'pointer', accentColor: '#f59e0b' }}
                  />
                  <div>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: directOverride ? '#fbbf24' : '#e2e8f0',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>Allow Schedule Override</span>
                      {directOverride && (
                        <span
                          style={{
                            fontSize: '10.5px',
                            background: 'rgba(245, 158, 11, 0.2)',
                            border: '1px solid rgba(245, 158, 11, 0.4)',
                            color: '#fbbf24',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontWeight: 700,
                          }}
                        >
                          OVERRIDE ACTIVE
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '2px', lineHeight: 1.4 }}>
                      Move outside active clinic shifts or bypass commute buffer/conflict checks.
                    </div>
                  </div>
                </label>

                {/* WhatsApp Notification */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={directSendWhatsApp}
                    onChange={(e) => setDirectSendWhatsApp(e.target.checked)}
                    style={{ marginTop: '3px', cursor: 'pointer', accentColor: '#00f59b' }}
                  />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
                      Send Updated WhatsApp Confirmation to Patient
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '2px', lineHeight: 1.4 }}>
                      Notifies patient on WhatsApp about their new appointment time and location.
                    </div>
                  </div>
                </label>
              </div>
            </>
          )}

          {/* TAB 2: AI OUTREACH CONTENT */}
          {activeTab === 'ai' && (
            <>
              {/* Specific proposed slot */}
              <div
                style={{
                  background: 'rgba(168, 85, 247, 0.04)',
                  border: '1px solid rgba(168, 85, 247, 0.2)',
                  borderRadius: '10px',
                  padding: '14px 16px',
                }}
              >
                <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#c084fc', marginBottom: '4px' }}>
                  Target Proposed Slot (Optional)
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.4, marginBottom: '12px' }}>
                  If left blank, AI automatically queries your open calendar shifts and suggests 2–3 alternative slots.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 600 }}>Proposed Date</label>
                    <input
                      type="date"
                      value={proposedDate}
                      onChange={(e) => setProposedDate(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '8px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 600 }}>Proposed Time</label>
                    <input
                      type="time"
                      value={proposedTime}
                      onChange={(e) => setProposedTime(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '8px' }}
                    />
                  </div>
                </div>
              </div>

              {/* Language selector */}
              <div>
                <label style={{ fontSize: '11px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  Language & Dialect
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px' }}
                >
                  <option value="auto">Auto (Match Patient / Lebanese Clinic Default)</option>
                  <option value="lebanese_arabic">Lebanese Arabic (عربي لبناني)</option>
                  <option value="arabizi">Lebanese Arabizi (Franco-Arabe e.g. Marhaba)</option>
                  <option value="english">English</option>
                  <option value="french">Français</option>
                </select>
              </div>

              {/* Reason / Directive */}
              <div>
                <label style={{ fontSize: '11px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  Doctor Directive / Quick Reason Presets
                </label>
                <div className="chip-group" style={{ marginBottom: '10px' }}>
                  <span className="chip" onClick={() => setPrompt('Hospital emergency, doctor called into urgent case')}>
                    <IconAlertCircle size={13} style={{ marginRight: '5px' }} /> Hospital Emergency
                  </span>
                  <span className="chip" onClick={() => setPrompt('Doctor unavailable this morning, suggest afternoon slots')}>
                    <IconSun size={13} style={{ marginRight: '5px' }} /> Morning Conflict
                  </span>
                  <span className="chip" onClick={() => setPrompt('Offer Wednesday 2pm or Thursday 11am')}>
                    <IconCalendar size={13} style={{ marginRight: '5px' }} /> Suggest Wed / Thu
                  </span>
                  <span className="chip" onClick={() => setPrompt('ظرف طارئ بالمستشفى، يرجى اختيار موعد آخر')}>
                    <IconMessage size={13} style={{ marginRight: '5px' }} /> طارئ (عربي)
                  </span>
                </div>

                <textarea
                  rows={3}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', lineHeight: 1.5 }}
                  placeholder="e.g. Doctor in urgent surgery. Propose alternative afternoon slots or ask patient for preferred hours."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="modal-footer"
          style={{
            padding: '16px 24px',
            borderTop: '1px solid rgba(255,255,255,0.07)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
            background: '#090b0e',
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={loading}
            style={{ padding: '8px 16px', borderRadius: '8px' }}
          >
            Cancel
          </button>

          {activeTab === 'direct' ? (
            <button
              type="button"
              className="btn btn-emerald"
              disabled={loading}
              onClick={() => handleDirectSubmit(false)}
              style={{
                padding: '8px 20px',
                borderRadius: '8px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 700,
              }}
            >
              <IconCheck size={15} />
              <span>{loading ? 'Moving Appointment...' : 'Move Appointment'}</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-purple"
              disabled={loading}
              onClick={handleAiSubmit}
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 700,
              }}
            >
              <IconSparkles size={14} />
              <span>{loading ? 'Dispatching...' : 'Dispatch WhatsApp Request'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
