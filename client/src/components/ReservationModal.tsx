import React, { useState } from 'react';
import { Appointment } from '../types';
import { parseTimeInfo } from './CalendarGrid';
import {
  IconCalendar,
  IconX,
  IconMapPin,
  IconPhone,
  IconMessage,
  IconSparkles,
  IconCheck,
  IconClock,
  IconUser,
  IconChevronRight,
  IconBuilding,
  IconHome,
} from './Icons';

interface ReservationModalProps {
  appointment: Appointment | null;
  onClose: () => void;
  onCancel: (appt: Appointment) => void;
  onComplete: (appt: Appointment) => void;
  onOpenReschedule: (appt: Appointment) => void;
  onOpenQuickMsg: (appt: Appointment) => void;
}

function formatPhone(phone?: string) {
  if (!phone) return '-';
  const cleaned = phone.replace(/^whatsapp:/i, '').trim();
  if (cleaned.startsWith('+961') && cleaned.length === 12) {
    return `+961 ${cleaned.slice(4, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9)}`;
  }
  return cleaned;
}

export const ReservationModal: React.FC<ReservationModalProps> = ({
  appointment,
  onClose,
  onCancel,
  onComplete,
  onOpenReschedule,
  onOpenQuickMsg,
}) => {
  const [activeTab, setActiveTab] = useState<'details' | 'chat'>('details');

  if (!appointment) return null;

  const isHome = appointment.visit_type === 'home_visit';
  const sInfo = parseTimeInfo(appointment.start_time);
  const eInfo = appointment.end_time ? parseTimeInfo(appointment.end_time) : null;
  const daysFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthsFull = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const dObj = new Date(sInfo.year, sInfo.month, sInfo.date);
  const dateStr = `${daysFull[dObj.getDay()]}, ${monthsFull[sInfo.month]} ${sInfo.date}, ${sInfo.year}`;
  const timeStr = `${sInfo.timeStr12}${eInfo ? ` – ${eInfo.timeStr12}` : ''}`;
  const durationVal = eInfo && eInfo.totalMinutes > sInfo.totalMinutes ? eInfo.totalMinutes - sInfo.totalMinutes : 60;
  const rawPhone = appointment.customer_phone || '-';
  const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
  const statusStr = (appointment.status || 'confirmed').toLowerCase();

  const chatMessages = appointment.conversation_history || [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card modal-card-spacious"
        style={{ maxWidth: '680px', width: '92vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="modal-header" style={{ padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                background: isHome ? 'rgba(244, 63, 94, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                border: `1px solid ${isHome ? 'rgba(244, 63, 94, 0.25)' : 'rgba(16, 185, 129, 0.25)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isHome ? '#f43f5e' : 'var(--emerald-primary)',
              }}
            >
              {isHome ? <IconHome size={20} /> : <IconBuilding size={20} />}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: '17px', color: '#fff', fontWeight: 700, margin: 0 }}>
                  {appointment.customer_name || 'Patient Appointment'}
                </h3>
                <span className={`badge ${isHome ? 'badge-home' : 'badge-office'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  {isHome ? <IconHome size={12} /> : <IconBuilding size={12} />}
                  <span>{isHome ? 'HOME VISIT' : 'IN-OFFICE'}</span>
                </span>
                <span
                  className={`badge ${
                    statusStr === 'confirmed' || statusStr === 'booked'
                      ? 'badge-paid'
                      : statusStr === 'rescheduled'
                      ? 'badge-rescheduled'
                      : statusStr === 'completed'
                      ? 'badge-paid'
                      : 'badge-pending'
                  }`}
                >
                  {statusStr.toUpperCase()}
                </span>
              </div>
              <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '2px' }}>
                {appointment.service || 'General Medical Consultation'}
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
              transition: 'all 0.15s ease',
            }}
          >
            <IconX size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', background: '#090b0e', padding: '0 24px' }}>
          <button
            onClick={() => setActiveTab('details')}
            style={{
              padding: '12px 18px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'details' ? '2px solid var(--emerald-primary)' : '2px solid transparent',
              color: activeTab === 'details' ? 'var(--emerald-primary)' : '#64748b',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            Reservation Details
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            style={{
              padding: '12px 18px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'chat' ? '2px solid var(--emerald-primary)' : '2px solid transparent',
              color: activeTab === 'chat' ? 'var(--emerald-primary)' : '#64748b',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s',
            }}
          >
            <span>WhatsApp Transcript</span>
            {chatMessages.length > 0 && (
              <span
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  fontSize: '11px',
                  color: '#e2e8f0',
                }}
              >
                {chatMessages.length}
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body" style={{ padding: '22px 24px', maxHeight: '560px', overflowY: 'auto' }}>
          {activeTab === 'details' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Primary Schedule Hero Card */}
              <div
                style={{
                  background: 'linear-gradient(135deg, rgba(0, 255, 136, 0.05) 0%, rgba(16, 185, 129, 0.02) 100%)',
                  border: '1px solid rgba(0, 255, 136, 0.18)',
                  borderRadius: '12px',
                  padding: '16px 18px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '10px',
                      background: 'rgba(16, 185, 129, 0.12)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--emerald-primary)',
                    }}
                  >
                    <IconCalendar size={22} color="var(--emerald-primary)" />
                  </div>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: '#ffffff' }}>
                      {dateStr}
                    </div>
                    <div
                      style={{
                        fontSize: '13.5px',
                        color: '#a7f3d0',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 600,
                        marginTop: '3px',
                      }}
                    >
                      {timeStr}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      background: 'rgba(0,0,0,0.4)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '8px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontFamily: "'JetBrains Mono', monospace",
                      color: '#94a3b8',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <IconClock size={13} />
                    <span>{durationVal} min slot</span>
                  </span>
                </div>
              </div>

              {/* 2-Column Grid: Patient Contact + Location */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
                {/* Patient Information Card */}
                <div
                  style={{
                    background: '#0c0e12',
                    border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: '12px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.06em', fontWeight: 600, marginBottom: '8px' }}>
                      Patient Information
                    </div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>
                      {appointment.customer_name || 'Patient'}
                    </div>
                    <div className="mono" style={{ fontSize: '13px', color: '#94a3b8', marginTop: '3px' }}>
                      {formatPhone(rawPhone)}
                    </div>
                  </div>

                  {cleanPhone && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
                      <a
                        href={`https://wa.me/${cleanPhone}`}
                        target="_blank"
                        rel="noreferrer"
                        className="contact-chip whatsapp"
                        style={{
                          flex: 1,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          fontWeight: 600,
                        }}
                      >
                        <IconMessage size={14} />
                        <span>WhatsApp Chat</span>
                      </a>
                      <a
                        href={`tel:+${cleanPhone}`}
                        className="contact-chip call"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          padding: '8px 14px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          fontWeight: 600,
                        }}
                      >
                        <IconPhone size={14} />
                        <span>Call</span>
                      </a>
                    </div>
                  )}
                </div>

                {/* Location / Office Card */}
                <div
                  style={{
                    background: '#0c0e12',
                    border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: '12px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.06em', fontWeight: 600, marginBottom: '8px' }}>
                      Visit Location
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      <div style={{ color: isHome ? '#f43f5e' : 'var(--emerald-primary)', paddingTop: '2px' }}>
                        <IconMapPin size={18} color={isHome ? '#f43f5e' : 'var(--emerald-primary)'} />
                      </div>
                      <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: 1.5 }}>
                        {isHome ? (
                          <>
                            <div style={{ fontWeight: 600, color: '#fff' }}>Home Visit Address</div>
                            <div style={{ marginTop: '2px', color: '#cbd5e1' }}>
                              {appointment.address || 'Address provided over WhatsApp'}
                            </div>
                          </>
                        ) : (
                          <>
                            <div style={{ fontWeight: 600, color: '#fff' }}>Medical Clinic Office</div>
                            <div style={{ marginTop: '2px', color: '#94a3b8' }}>In-Person Consultation (Room 204)</div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {isHome && appointment.address && (
                    <div style={{ marginTop: '14px' }}>
                      <a
                        href={`https://maps.google.com/?q=${encodeURIComponent(appointment.address)}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          color: '#38bdf8',
                          fontSize: '12px',
                          fontWeight: 600,
                          textDecoration: 'none',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          background: 'rgba(56, 189, 248, 0.08)',
                          border: '1px solid rgba(56, 189, 248, 0.2)',
                        }}
                      >
                        <span>Open in Google Maps</span>
                        <IconChevronRight size={13} />
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Clinical Notes & AI Directives Card */}
              <div
                style={{
                  background: '#0c0e12',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: '12px',
                  padding: '16px',
                }}
              >
                <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.06em', fontWeight: 600, marginBottom: '8px' }}>
                  Symptoms & AI Intake Directives
                </div>
                <div
                  style={{
                    fontSize: '13px',
                    color: '#e2e8f0',
                    lineHeight: 1.6,
                    background: 'rgba(255,255,255,0.02)',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  {appointment.notes || 'No special intake symptoms or preparation notes recorded.'}
                </div>
              </div>
            </div>
          ) : (
            /* WhatsApp Conversation Tab */
            <div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.06em', fontWeight: 600, marginBottom: '10px' }}>
                Full Real-time WhatsApp Transcript
              </div>
              {chatMessages.length === 0 ? (
                <div style={{ padding: '36px 20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                  No previous chat messages recorded for this appointment.
                </div>
              ) : (
                <div
                  className="chat-thread-container"
                  style={{
                    maxHeight: '380px',
                    padding: '14px',
                    borderRadius: '12px',
                    background: '#080a0d',
                    border: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  {chatMessages.map((msg, i) => {
                    const isInbound = msg.direction === 'inbound';
                    return (
                      <div
                        key={i}
                        className={`chat-bubble ${isInbound ? 'patient' : 'gemini'}`}
                        style={{
                          maxWidth: '82%',
                          padding: '10px 14px',
                          borderRadius: '12px',
                          fontSize: '13px',
                          lineHeight: 1.5,
                          alignSelf: isInbound ? 'flex-start' : 'flex-end',
                          background: isInbound ? '#161b22' : 'rgba(0, 255, 136, 0.1)',
                          border: `1px solid ${isInbound ? 'rgba(255,255,255,0.08)' : 'rgba(0, 255, 136, 0.25)'}`,
                          color: isInbound ? '#f1f5f9' : '#ffffff',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '10.5px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            color: isInbound ? '#38bdf8' : 'var(--emerald-primary)',
                            marginBottom: '4px',
                          }}
                        >
                          {isInbound ? appointment.customer_name || 'Patient' : 'Gemini AI Receptionist'}
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.body}</div>
                        {msg.created_at && (
                          <div
                            style={{
                              fontSize: '10px',
                              color: '#64748b',
                              textAlign: 'right',
                              marginTop: '4px',
                            }}
                          >
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Roomy Action Footer */}
        <div
          className="modal-footer"
          style={{
            padding: '16px 24px',
            borderTop: '1px solid rgba(255,255,255,0.07)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
            background: '#090b0e',
          }}
        >
          <button
            className="btn btn-danger"
            onClick={() => onCancel(appointment)}
            style={{ padding: '8px 16px', fontSize: '12.5px', borderRadius: '8px' }}
          >
            Cancel Visit
          </button>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              onClick={() => onOpenQuickMsg(appointment)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                fontSize: '12.5px',
                borderRadius: '8px',
              }}
            >
              <IconMessage size={14} />
              <span>Quick WhatsApp</span>
            </button>
            <button
              className="btn btn-purple"
              onClick={() => onOpenReschedule(appointment)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                fontSize: '12.5px',
                borderRadius: '8px',
              }}
            >
              <IconSparkles size={14} />
              <span>Move / Reschedule</span>
            </button>
            <button
              className="btn btn-emerald"
              onClick={() => onComplete(appointment)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                fontSize: '12.5px',
                borderRadius: '8px',
                fontWeight: 600,
              }}
            >
              <IconCheck size={14} />
              <span>Complete Visit</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
