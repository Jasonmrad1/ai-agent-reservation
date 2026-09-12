import React, { useState } from 'react';
import { Appointment } from '../types';
import { IconX, IconSparkles, IconCalendar, IconClock, IconMessage, IconAlertCircle, IconSun } from './Icons';

interface RescheduleModalProps {
  appointment: Appointment | null;
  onClose: () => void;
  onSubmit: (params: {
    appointmentId: string;
    doctorPrompt: string;
    proposedDate?: string;
    proposedTime?: string;
    language: string;
  }) => Promise<void>;
}

export const RescheduleModal: React.FC<RescheduleModalProps> = ({
  appointment,
  onClose,
  onSubmit,
}) => {
  const [prompt, setPrompt] = useState('');
  const [proposedDate, setProposedDate] = useState('');
  const [proposedTime, setProposedTime] = useState('');
  const [language, setLanguage] = useState('auto');
  const [loading, setLoading] = useState(false);

  if (!appointment) return null;

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onSubmit({
        appointmentId: appointment.id,
        doctorPrompt: prompt,
        proposedDate: proposedDate || undefined,
        proposedTime: proposedTime || undefined,
        language,
      });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card modal-card-spacious"
        style={{ maxWidth: '620px', width: '92vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header" style={{ padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: 'rgba(168, 85, 247, 0.15)',
                border: '1px solid rgba(168, 85, 247, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#c084fc',
              }}
            >
              <IconSparkles size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: '16px', color: '#fff', fontWeight: 700, margin: 0 }}>
                AI Reschedule Request
              </h3>
              <div style={{ fontSize: '12.5px', color: '#94a3b8', marginTop: '2px' }}>
                Gemini will craft a polite WhatsApp message offering candidate slots to the patient.
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

        {/* Body */}
        <div className="modal-body" style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Patient summary badge */}
          <div
            style={{
              background: '#0c0e12',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '10px',
              padding: '14px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em', fontWeight: 600 }}>
                Current Appointment
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
              {new Date(appointment.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>

          {/* Specific proposed slot */}
          <div
            style={{
              background: 'rgba(0, 255, 136, 0.03)',
              border: '1px solid rgba(0, 255, 136, 0.15)',
              borderRadius: '10px',
              padding: '14px 16px',
            }}
          >
            <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#00ff88', marginBottom: '4px' }}>
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
          <button className="btn btn-secondary" onClick={onClose} style={{ padding: '8px 16px', borderRadius: '8px' }}>
            Cancel
          </button>
          <button
            className="btn btn-purple"
            disabled={loading}
            onClick={handleSubmit}
            style={{ padding: '8px 18px', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <IconSparkles size={14} />
            <span>{loading ? 'Dispatching...' : 'Dispatch WhatsApp Request'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
