import React, { useState } from 'react';
import {
  IconX,
  IconCalendar,
  IconClock,
  IconPhone,
  IconUser,
  IconBuilding,
  IconHome,
  IconMapPin,
  IconAlertCircle,
  IconCheck,
  IconPlus,
} from './Icons';

export interface ManualBookingData {
  phone: string;
  name?: string;
  date: string;
  time: string;
  duration_minutes?: number;
  visit_type: 'in_office' | 'home_visit';
  address?: string;
  service?: string;
  price?: number;
  notes?: string;
  override?: boolean;
  send_whatsapp?: boolean;
}

interface ManualBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ManualBookingData) => Promise<void>;
  defaultDate?: string;
}

export const ManualBookingModal: React.FC<ManualBookingModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  defaultDate,
}) => {
  const todayStr = new Date().toISOString().split('T')[0];

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [date, setDate] = useState(defaultDate || todayStr);
  const [time, setTime] = useState('10:00');
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [visitType, setVisitType] = useState<'in_office' | 'home_visit'>('in_office');
  const [address, setAddress] = useState('');
  const [service, setService] = useState('General Consultation');
  const [price, setPrice] = useState(100);
  const [notes, setNotes] = useState('');
  const [override, setOverride] = useState(false);
  const [sendWhatsApp, setSendWhatsApp] = useState(true);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (forceOverride = false) => {
    setErrorMessage(null);
    if (!phone.trim()) {
      setErrorMessage('Patient phone number is required.');
      return;
    }
    if (!date) {
      setErrorMessage('Appointment date is required.');
      return;
    }
    if (!time) {
      setErrorMessage('Appointment time is required.');
      return;
    }
    if (visitType === 'home_visit' && !address.trim()) {
      setErrorMessage('Home visit requires a physical patient address.');
      return;
    }

    const useOverride = forceOverride || override;
    setLoading(true);
    try {
      await onSubmit({
        phone: phone.trim(),
        name: name.trim() || undefined,
        date,
        time,
        duration_minutes: durationMinutes,
        visit_type: visitType,
        address: visitType === 'home_visit' ? address.trim() : undefined,
        service: service.trim() || 'General Consultation',
        price: Number(price) || 100,
        notes: notes.trim() || undefined,
        override: useOverride,
        send_whatsapp: sendWhatsApp,
      });
      // Reset form
      setPhone('');
      setName('');
      setAddress('');
      setNotes('');
      setOverride(false);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to book appointment');
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
                background: 'rgba(0, 245, 155, 0.12)',
                border: '1px solid rgba(0, 245, 155, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#00f59b',
              }}
            >
              <IconPlus size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: '16px', color: '#fff', fontWeight: 700, margin: 0 }}>
                Manual Appointment Entry
              </h3>
              <div style={{ fontSize: '12.5px', color: '#94a3b8', marginTop: '2px' }}>
                Book walk-in, phone, or in-person visits with optional schedule override.
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

        {/* Form Body */}
        <div
          className="modal-body"
          style={{
            padding: '22px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            maxHeight: '68vh',
            overflowY: 'auto',
          }}
        >
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
              {isConflictError && !override && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setOverride(true);
                      handleSubmit(true);
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
                    ⚡ Enable Override & Book Anyway
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Section 1: Patient Information */}
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
                <IconPhone size={12} /> Patient WhatsApp / Phone *
              </label>
              <input
                type="text"
                placeholder="+961 71 476 193 or 71476193"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
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
                <IconUser size={12} /> Patient Full Name
              </label>
              <input
                type="text"
                placeholder="e.g. Farah Haddad"
                value={name}
                onChange={(e) => setName(e.target.value)}
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

          {/* Section 2: Date & Time */}
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
                <IconCalendar size={12} /> Date *
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
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
                <IconClock size={12} /> Time *
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
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

          {/* Appointment Duration Selector */}
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
              <IconClock size={12} /> Appointment Duration
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
              {[
                { label: '⚡ Short', mins: 30, desc: '30 min' },
                { label: '⭐ Standard', mins: 60, desc: '60 min (Default)' },
                { label: '⏳ Long', mins: 90, desc: '90 min' },
                { label: '⌛ Double', mins: 120, desc: '2 hours' },
              ].map((tier) => (
                <button
                  key={tier.mins}
                  type="button"
                  onClick={() => setDurationMinutes(tier.mins)}
                  style={{
                    padding: '8px 4px',
                    borderRadius: '8px',
                    border: durationMinutes === tier.mins
                      ? '1px solid var(--emerald-primary)'
                      : '1px solid var(--border-default)',
                    background: durationMinutes === tier.mins
                      ? 'rgba(0, 245, 155, 0.12)'
                      : 'var(--bg-input)',
                    color: durationMinutes === tier.mins ? 'var(--emerald-primary)' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 600,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>{tier.label}</span>
                  <span style={{ fontSize: '10px', opacity: 0.75 }}>{tier.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Section 3: Visit Type (In-Office vs Home Visit) */}
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
              Consultation Location / Visit Type *
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setVisitType('in_office')}
                style={{
                  padding: '11px 14px',
                  borderRadius: '8px',
                  background:
                    visitType === 'in_office' ? 'rgba(0, 245, 155, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                  border:
                    visitType === 'in_office' ? '1px solid #00f59b' : '1px solid var(--border-subtle)',
                  color: visitType === 'in_office' ? '#00f59b' : '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <IconBuilding size={16} />
                <span>In-Office Clinic Visit</span>
              </button>

              <button
                type="button"
                onClick={() => setVisitType('home_visit')}
                style={{
                  padding: '11px 14px',
                  borderRadius: '8px',
                  background:
                    visitType === 'home_visit' ? 'rgba(244, 63, 94, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                  border:
                    visitType === 'home_visit' ? '1px solid #f43f5e' : '1px solid var(--border-subtle)',
                  color: visitType === 'home_visit' ? '#f43f5e' : '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <IconHome size={16} />
                <span>Doctor Home Visit</span>
              </button>
            </div>
          </div>

          {/* Conditional Address Field for Home Visits */}
          {visitType === 'home_visit' && (
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
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '6px',
                  background: 'var(--bg-input)',
                  border: '1px solid rgba(244, 63, 94, 0.3)',
                  color: '#fff',
                  fontSize: '13.5px',
                }}
              />
            </div>
          )}

          {/* Section 4: Service & Price */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
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
                Service / Consultation Type
              </label>
              <select
                value={service}
                onChange={(e) => setService(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-default)',
                  color: '#fff',
                  fontSize: '13px',
                }}
              >
                <option value="General Consultation">General Consultation</option>
                <option value="Cardiology Consultation">Cardiology Consultation</option>
                <option value="Routine Follow-up">Routine Follow-up</option>
                <option value="Home Visit Checkup">Home Visit Checkup</option>
                <option value="Urgent Clinical Evaluation">Urgent Clinical Evaluation</option>
              </select>
            </div>

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
                Price ($)
              </label>
              <input
                type="number"
                min="0"
                step="5"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
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

          {/* Section 5: Doctor Notes */}
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
              Notes (Optional)
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Patient came in person to clinic desk / agreed in person."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-default)',
                color: '#fff',
                fontSize: '13px',
                resize: 'none',
              }}
            />
          </div>

          {/* Section 6: Override & WhatsApp Notification Controls */}
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
            {/* Override Switch */}
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
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
                style={{ marginTop: '3px', cursor: 'pointer', accentColor: '#f59e0b' }}
              />
              <div>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: override ? '#fbbf24' : '#e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>Allow Schedule Override</span>
                  {override && (
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
                  Schedule outside standard working hours or bypass conflict/commute checks (useful if you already agreed with the patient in person).
                </div>
              </div>
            </label>

            {/* WhatsApp Confirmation Switch */}
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
                checked={sendWhatsApp}
                onChange={(e) => setSendWhatsApp(e.target.checked)}
                style={{ marginTop: '3px', cursor: 'pointer', accentColor: '#00f59b' }}
              />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
                  Send WhatsApp Confirmation to Patient
                </div>
                <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '2px', lineHeight: 1.4 }}>
                  Sends a booking confirmation via WhatsApp and schedules automatic 24h and 1h reminders.
                </div>
              </div>
            </label>
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
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={loading}
            style={{ padding: '8px 16px', borderRadius: '8px' }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-emerald"
            onClick={() => handleSubmit(false)}
            disabled={loading}
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
            <span>{loading ? 'Saving Appointment...' : 'Book Appointment'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
