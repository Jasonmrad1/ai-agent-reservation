import React, { useState } from 'react';
import { Appointment } from '../types';
import { IconX, IconClock, IconMapPin, IconCar, IconSparkles, IconMessage } from './Icons';

interface QuickMessageModalProps {
  appointment: Appointment | null;
  onClose: () => void;
  onSubmit: (appointmentId: string, messageText: string) => Promise<void>;
}

export const QuickMessageModal: React.FC<QuickMessageModalProps> = ({
  appointment,
  onClose,
  onSubmit,
}) => {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  if (!appointment) return null;

  const patientName = appointment.customer_name || 'Patient';

  const applyTemplate = (type: string) => {
    if (type === 'late') {
      setText(`Hello ${patientName}, the doctor is running about 15 minutes behind schedule due to a prior case. Thank you for your patience!`);
    } else if (type === 'pin') {
      setText(`Hello ${patientName}, please share your live WhatsApp location pin with us so the doctor can navigate directly to your address for the home visit. Thank you!`);
    } else if (type === 'arrived') {
      setText(`Hello ${patientName}, the doctor has arrived at your address / building for your appointment!`);
    } else if (type === 'rx') {
      setText(`Hello ${patientName}, your medical prescription and treatment notes are prepared. Please let us know if you have any questions.`);
    } else if (type === 'lebanese_late') {
      setText(`أهلاً ${patientName}، الحكيم متأخر حوالي ١٥ دقيقة بسبب حالة طارئة بالمستشفى، منعتذر عالإزعاج وتكرم عينك.`);
    }
  };

  const handleSubmit = async () => {
    if (!text.trim()) return alert('Please enter message text to send.');
    setLoading(true);
    try {
      await onSubmit(appointment.id, text.trim());
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card modal-card-spacious"
        style={{ maxWidth: '600px', width: '92vw' }}
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
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38bdf8',
              }}
            >
              <IconMessage size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: '16px', color: '#fff', fontWeight: 700, margin: 0 }}>
                Direct WhatsApp Message
              </h3>
              <div style={{ fontSize: '12.5px', color: '#94a3b8', marginTop: '2px' }}>
                Sends directly to the patient's WhatsApp chat.
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
          {/* Patient info chip */}
          <div
            style={{
              background: '#0c0e12',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '10px',
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#fff' }}>
              Patient: {patientName}
            </div>
            <div
              style={{
                fontSize: '12.5px',
                color: '#94a3b8',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {appointment.customer_phone || '-'}
            </div>
          </div>

          <div>
            <label style={{ fontSize: '11px', textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '8px', letterSpacing: '0.05em', fontWeight: 600 }}>
              One-Click Quick Templates
            </label>
            <div className="chip-group" style={{ gap: '8px' }}>
              <span className="chip" onClick={() => applyTemplate('late')}>
                <IconClock size={13} style={{ marginRight: '5px' }} /> Running 15 Mins Late
              </span>
              <span className="chip" onClick={() => applyTemplate('pin')}>
                <IconMapPin size={13} style={{ marginRight: '5px' }} /> Request Google Maps Pin
              </span>
              <span className="chip" onClick={() => applyTemplate('arrived')}>
                <IconCar size={13} style={{ marginRight: '5px' }} /> Doctor Has Arrived
              </span>
              <span className="chip" onClick={() => applyTemplate('rx')}>
                <IconSparkles size={13} style={{ marginRight: '5px' }} /> Prescription Ready
              </span>
              <span className="chip" onClick={() => applyTemplate('lebanese_late')}>
                <IconMessage size={13} style={{ marginRight: '5px' }} /> دقيقة وواصل (عربي)
              </span>
            </div>
          </div>

          <div>
            <label style={{ fontSize: '11px', textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '6px', letterSpacing: '0.05em', fontWeight: 600 }}>
              Message Text
            </label>
            <textarea
              rows={4}
              style={{ width: '100%', padding: '12px 14px', borderRadius: '8px', lineHeight: 1.5, fontSize: '13.5px' }}
              placeholder="Type message to send directly to patient over WhatsApp..."
              value={text}
              onChange={(e) => setText(e.target.value)}
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
            className="btn btn-emerald"
            disabled={loading}
            onClick={handleSubmit}
            style={{ padding: '8px 18px', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
          >
            <IconMessage size={14} />
            <span>{loading ? 'Sending...' : 'Send via WhatsApp'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
