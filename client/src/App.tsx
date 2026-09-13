import React, { useState, useEffect, useCallback } from 'react';
import { Appointment, AvailabilityRule, DateOverride, TimeInterval } from './types';
import { Header } from './components/Header';
import { CalendarGrid, parseTimeInfo } from './components/CalendarGrid';
import { ReservationModal } from './components/ReservationModal';
import { WorkHoursModal } from './components/WorkHoursModal';
import { WorkHoursView } from './components/WorkHoursView';
import { RescheduleModal, DirectMoveParams, AiOutreachParams } from './components/RescheduleModal';
import { QuickMessageModal } from './components/QuickMessageModal';
import { WhatsAppSimulator } from './components/WhatsAppSimulator';
import { ManualBookingModal, ManualBookingData } from './components/ManualBookingModal';

declare global {
  interface Window {
    __ADMIN_KEY__?: string;
  }
}

function getMonday(d: Date | string | number) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export const App: React.FC = () => {
  // Get admin key from window global or URL search params
  const [adminKey] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      if (window.__ADMIN_KEY__) return window.__ADMIN_KEY__;
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('key') || 'admin-secret-2026';
    }
    return 'admin-secret-2026';
  });

  const isSimulatorRoute = typeof window !== 'undefined' && window.location.pathname.includes('simulator');
  const [activeTab, setActiveTab] = useState<'appointments' | 'work_hours' | 'simulator'>(() => {
    return isSimulatorRoute ? 'simulator' : 'appointments';
  });
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [overrides, setOverrides] = useState<DateOverride[]>([]);
  const [commuteBufferMinutes, setCommuteBufferMinutes] = useState<number>(30);
  const [currentWeekMonday, setCurrentWeekMonday] = useState<Date>(() => getMonday(new Date()));
  const [showHoursOverlay, setShowHoursOverlay] = useState<boolean>(true);

  // Modals state
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [rescheduleAppt, setRescheduleAppt] = useState<Appointment | null>(null);
  const [quickMsgAppt, setQuickMsgAppt] = useState<Appointment | null>(null);
  const [isWorkHoursOpen, setIsWorkHoursOpen] = useState<boolean>(false);
  const [isManualBookingOpen, setIsManualBookingOpen] = useState<boolean>(false);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast(null);
    }, 4000);
  }, []);

  const getHeaders = useCallback(() => {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminKey}`,
    };
  }, [adminKey]);

  // Load appointments
  const loadAppointments = useCallback(async () => {
    try {
      const res = await fetch(`/admin/api/appointments?key=${adminKey}`, {
        headers: getHeaders(),
      });
      const data = await res.json();
      const appts: Appointment[] = data.appointments || [];
      setAppointments(appts);
    } catch (err) {
      console.error('Failed to load appointments:', err);
    }
  }, [adminKey, getHeaders]);

  // Load availability
  const loadAvailability = useCallback(async () => {
    try {
      const res = await fetch(`/admin/api/availability?key=${adminKey}`, {
        headers: getHeaders(),
      });
      const data = await res.json();
      setRules(data.rules || []);
      setOverrides(data.overrides || []);
    } catch (err) {
      console.error('Failed to load availability:', err);
    }
  }, [adminKey, getHeaders]);

  // Load settings (commute buffer)
  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch(`/admin/api/settings?key=${adminKey}`, {
        headers: getHeaders(),
      });
      const data = await res.json();
      if (data.home_visit_buffer_minutes !== undefined) {
        setCommuteBufferMinutes(Number(data.home_visit_buffer_minutes));
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }, [adminKey, getHeaders]);

  // Load Google Calendar status
  const [googleStatus, setGoogleStatus] = useState<{ configured: boolean; connected: boolean; calendarId?: string } | null>(null);

  const loadGoogleStatus = useCallback(async () => {
    try {
      const res = await fetch(`/admin/api/google-calendar/status?key=${adminKey}`, {
        headers: getHeaders(),
      });
      const data = await res.json();
      setGoogleStatus(data);
    } catch {
      // ignore
    }
  }, [adminKey, getHeaders]);

  const handleConnectGoogle = () => {
    window.location.href = `/admin/auth/google?key=${adminKey}`;
  };

  const handleDisconnectGoogle = async () => {
    if (!confirm('Disconnect Google Calendar? Future appointments will no longer sync to Google Calendar.')) return;
    try {
      await fetch(`/admin/api/google-calendar/disconnect?key=${adminKey}`, {
        method: 'POST',
        headers: getHeaders(),
      });
      showToast('Google Calendar disconnected.');
      loadGoogleStatus();
    } catch {
      showToast('Failed to disconnect Google Calendar.');
    }
  };

  useEffect(() => {
    loadAppointments();
    loadAvailability();
    loadSettings();
    loadGoogleStatus();

    // Check if redirected back from Google OAuth
    const params = new URLSearchParams(window.location.search);
    if (params.get('google_connected') === '1') {
      showToast('🎉 Google Calendar connected and synced successfully!');
      window.history.replaceState({}, '', window.location.pathname + `?key=${adminKey}`);
    }
  }, [loadAppointments, loadAvailability, loadSettings, loadGoogleStatus, adminKey, showToast]);

  // Keyboard Escape listener to dismiss any active modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedAppt(null);
        setRescheduleAppt(null);
        setQuickMsgAppt(null);
        setIsWorkHoursOpen(false);
        setIsManualBookingOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Navigation handlers
  const handlePrevWeek = () => {
    const d = new Date(currentWeekMonday);
    d.setDate(d.getDate() - 7);
    setCurrentWeekMonday(d);
  };

  const handleNextWeek = () => {
    const d = new Date(currentWeekMonday);
    d.setDate(d.getDate() + 7);
    setCurrentWeekMonday(d);
  };

  const handleTodayWeek = () => {
    setCurrentWeekMonday(getMonday(new Date()));
  };

  // Toggle Day bookable / closed directly on calendar
  const handleToggleDayOpen = async (day: number) => {
    const rule = rules.find((r) => Number(r.day_of_week) === day);
    const newActive = rule ? !rule.is_active : true;
    const start = rule ? rule.start_time : '09:00';
    const end = rule ? rule.end_time : '17:00';
    const shifts = rule?.shifts || [{ start_time: start, end_time: end }];

    try {
      const res = await fetch(`/admin/api/availability/rules?key=${adminKey}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          day_of_week: day,
          start_time: start,
          end_time: end,
          is_active: newActive,
          shifts,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.affectedCount > 0) {
          showToast(`Saved! Automatically messaged ${data.affectedCount} affected patient(s) on WhatsApp to reschedule.`);
          loadAppointments();
          loadAlerts();
        } else {
          showToast(newActive ? 'Day marked as bookable.' : 'Day marked as closed.');
        }
        loadAvailability();
      }
    } catch (err: any) {
      alert(`Error updating schedule: ${err.message}`);
    }
  };

  // Update commute travel buffer
  const handleUpdateCommuteBuffer = async (minutes: number, weekDate?: string, setAsDefault: boolean = false) => {
    setCommuteBufferMinutes(minutes);
    try {
      await fetch(`/admin/api/settings?key=${adminKey}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          home_visit_buffer_minutes: minutes,
          week_date: weekDate,
          set_as_default: setAsDefault,
        }),
      });
      showToast(`Commute buffer saved (${minutes} mins).`);
    } catch (err: any) {
      alert(`Error updating commute buffer: ${err.message}`);
    }
  };

  // Preset schedules
  const handleApplyPreset = async (preset: 'standard' | 'split' | 'extended' | 'all') => {
    const days = [0, 1, 2, 3, 4, 5, 6];
    const newRules = days.map((day) => {
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

    try {
      const res = await fetch(`/admin/api/availability/rules/batch?key=${adminKey}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ rules: newRules }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.affectedCount > 0) {
          showToast(`Preset applied. Messaged ${data.affectedCount} affected patient(s) on WhatsApp.`);
          loadAppointments();
          loadAlerts();
        } else {
          showToast(`Applied ${preset.toUpperCase()} schedule preset.`);
        }
        loadAvailability();
      }
    } catch (err: any) {
      alert(`Failed to apply preset: ${err.message}`);
    }
  };

  const handleSaveRule = async (rule: AvailabilityRule) => {
    try {
      const res = await fetch(`/admin/api/availability/rules?key=${adminKey}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(rule),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.affectedCount > 0) {
          showToast(`Schedule saved. Notified ${data.affectedCount} affected patient(s) via WhatsApp.`);
          loadAppointments();
          loadAlerts();
        } else {
          showToast('Schedule updated.');
        }
        loadAvailability();
        setActiveTab('appointments');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleSaveAllRules = async (allRules: AvailabilityRule[], targetWeekMonday?: Date) => {
    try {
      const res = await fetch(`/admin/api/availability/rules/batch?key=${adminKey}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ rules: allRules }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.affectedCount > 0) {
          showToast(`All hours saved! Automatically contacted ${data.affectedCount} affected patient(s) via WhatsApp.`);
          loadAppointments();
          loadAlerts();
        } else {
          showToast('All weekly work hours saved successfully!');
        }
        if (targetWeekMonday) {
          setCurrentWeekMonday(targetWeekMonday);
        }
        loadAvailability();
        setIsWorkHoursOpen(false);
        setActiveTab('appointments');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleAddOverride = async (date: string, reason: string) => {
    try {
      const res = await fetch(`/admin/api/availability/overrides?key=${adminKey}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ date, is_unavailable: true, reason }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.affectedCount > 0) {
          showToast(`Blockout added. Messaged ${data.affectedCount} affected patient(s) on WhatsApp.`);
          loadAppointments();
          loadAlerts();
        } else {
          showToast('Date blockout added.');
        }
        loadAvailability();
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleSaveWeekOverrides = async (
    overridesList: Array<{ date: string; is_unavailable: boolean; start_time?: string; end_time?: string; reason?: string; shifts?: TimeInterval[] }>,
    targetWeekMonday?: Date
  ) => {
    try {
      const res = await fetch(`/admin/api/availability/overrides/batch?key=${adminKey}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ overrides: overridesList }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.affectedCount > 0) {
          showToast(`Week customized! Contacted ${data.affectedCount} affected patient(s) on WhatsApp.`);
          loadAppointments();
          loadAlerts();
        } else {
          showToast('Custom schedule saved for this specific week!');
        }
        if (targetWeekMonday) {
          setCurrentWeekMonday(targetWeekMonday);
        }
        loadAvailability();
        setActiveTab('appointments');
      }
    } catch (err: any) {
      alert(`Error saving week schedule: ${err.message}`);
    }
  };

  const handleResetWeekOverrides = async (startDate: string, endDate: string) => {
    try {
      const res = await fetch(`/admin/api/availability/overrides/range?key=${adminKey}`, {
        method: 'DELETE',
        headers: getHeaders(),
        body: JSON.stringify({ start_date: startDate, end_date: endDate }),
      });
      if (res.ok) {
        showToast('This week was reset to the default template.');
        loadAvailability();
      }
    } catch (err: any) {
      alert(`Error resetting week: ${err.message}`);
    }
  };

  const handleDeleteOverride = async (id: string) => {
    try {
      await fetch(`/admin/api/availability/overrides/${id}?key=${adminKey}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      showToast('Date blockout removed.');
      loadAvailability();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  // Appointment actions
  const handleCancelAppointment = async (appt: Appointment) => {
    if (!confirm('Are you sure you want to cancel this visit?')) return;
    try {
      await fetch(`/admin/api/appointments/${appt.id}/cancel?key=${adminKey}`, {
        method: 'POST',
        headers: getHeaders(),
      });
      showToast('Appointment cancelled.');
      setSelectedAppt(null);
      loadAppointments();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleCompleteAppointment = async (appt: Appointment) => {
    if (!confirm('Mark this visit as completed?')) return;
    try {
      await fetch(`/admin/api/appointments/${appt.id}/complete?key=${adminKey}`, {
        method: 'POST',
        headers: getHeaders(),
      });
      showToast('Appointment marked as completed.');
      setSelectedAppt(null);
      loadAppointments();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleSubmitReschedule = async (params: {
    appointmentId: string;
    doctorPrompt: string;
    proposedDate?: string;
    proposedTime?: string;
    language: string;
  }) => {
    const res = await fetch(`/admin/api/appointments/${params.appointmentId}/request-reschedule?key=${adminKey}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        doctorPrompt: params.doctorPrompt,
        proposedDate: params.proposedDate,
        proposedTime: params.proposedTime,
        language: params.language,
      }),
    });
    const data = await res.json();
    if (data.success) {
      showToast('AI reschedule outreach sent to patient via WhatsApp.');
      loadAppointments();
    } else {
      alert(`Error: ${data.error || 'Failed to trigger AI reschedule'}`);
    }
  };

  const handleSubmitQuickMessage = async (appointmentId: string, messageText: string) => {
    const res = await fetch(`/admin/api/appointments/${appointmentId}/send-message?key=${adminKey}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ messageText }),
    });
    const data = await res.json();
    if (data.success) {
      showToast('WhatsApp message dispatched to patient.');
      loadAppointments();
    } else {
      alert(`Error: ${data.error || 'Failed to dispatch message'}`);
    }
  };

  const handleManualBooking = async (formData: ManualBookingData) => {
    const res = await fetch(`/admin/api/appointments/manual?key=${adminKey}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(formData),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to book appointment');
    }
    const waNote = data.whatsappSent ? ' Confirmation sent to patient on WhatsApp.' : '';
    showToast(`Appointment booked successfully!${waNote}`);
    loadAppointments();
  };

  const handleDirectReschedule = async (params: DirectMoveParams) => {
    const res = await fetch(`/admin/api/appointments/${params.appointmentId}/reschedule-direct?key=${adminKey}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to move appointment');
    }
    const waNote = data.whatsappSent ? ' Patient updated via WhatsApp.' : '';
    showToast(`Appointment moved to ${params.date} at ${params.time}!${waNote}`);
    loadAppointments();
  };

  return (
    <div className="react-calendar-app">
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        currentWeekMonday={currentWeekMonday}
        commuteBufferMinutes={commuteBufferMinutes}
        onUpdateCommuteBuffer={handleUpdateCommuteBuffer}
        onPrevWeek={handlePrevWeek}
        onNextWeek={handleNextWeek}
        onTodayWeek={handleTodayWeek}
        showHoursOverlay={showHoursOverlay}
        onToggleHoursOverlay={() => setShowHoursOverlay(!showHoursOverlay)}
        onNewAppointment={() => setIsManualBookingOpen(true)}
        googleStatus={googleStatus}
        onConnectGoogle={handleConnectGoogle}
        onDisconnectGoogle={handleDisconnectGoogle}
      />

      {activeTab === 'appointments' && (
        <CalendarGrid
          currentWeekMonday={currentWeekMonday}
          appointments={appointments}
          rules={rules}
          overrides={overrides}
          showHoursOverlay={showHoursOverlay}
          commuteBufferMinutes={commuteBufferMinutes}
          onSelectAppointment={(appt) => setSelectedAppt(appt)}
        />
      )}

      {activeTab === 'work_hours' && (
        <WorkHoursView
          rules={rules}
          overrides={overrides}
          commuteBufferMinutes={commuteBufferMinutes}
          adminKey={adminKey}
          onApplyPreset={handleApplyPreset}
          onSaveRule={handleSaveRule}
          onSaveAllRules={handleSaveAllRules}
          onSaveWeekOverrides={handleSaveWeekOverrides}
          onResetWeekOverrides={handleResetWeekOverrides}
          onUpdateCommuteBuffer={handleUpdateCommuteBuffer}
          onAddOverride={handleAddOverride}
          onDeleteOverride={handleDeleteOverride}
        />
      )}

      {activeTab === 'simulator' && (
        <main className="calendar-app-container">
          <div className="simulator-tab-card">
            <WhatsAppSimulator
              onRefreshData={loadAppointments}
              showToast={showToast}
            />
          </div>
        </main>
      )}

      {/* Manual Appointment Entry Modal */}
      <ManualBookingModal
        isOpen={isManualBookingOpen}
        onClose={() => setIsManualBookingOpen(false)}
        onSubmit={handleManualBooking}
      />

      {/* Reservation Details Modal */}
      <ReservationModal
        appointment={selectedAppt}
        onClose={() => setSelectedAppt(null)}
        onCancel={handleCancelAppointment}
        onComplete={handleCompleteAppointment}
        onOpenReschedule={(appt) => {
          setSelectedAppt(null);
          setRescheduleAppt(appt);
        }}
        onOpenQuickMsg={(appt) => {
          setSelectedAppt(null);
          setQuickMsgAppt(appt);
        }}
      />

      {/* Weekly Work Hours & Commute Modal */}
      <WorkHoursModal
        isOpen={isWorkHoursOpen}
        rules={rules}
        overrides={overrides}
        commuteBufferMinutes={commuteBufferMinutes}
        onClose={() => setIsWorkHoursOpen(false)}
        onApplyPreset={handleApplyPreset}
        onSaveRule={handleSaveRule}
        onSaveAllRules={handleSaveAllRules}
        onUpdateCommuteBuffer={handleUpdateCommuteBuffer}
        onAddOverride={handleAddOverride}
        onDeleteOverride={handleDeleteOverride}
      />

      {/* Move & Reschedule Modal (Direct Move or AI Outreach) */}
      <RescheduleModal
        appointment={rescheduleAppt}
        onClose={() => setRescheduleAppt(null)}
        onSubmit={handleSubmitReschedule}
        onDirectMove={handleDirectReschedule}
      />

      {/* Quick Automated Message Modal */}
      <QuickMessageModal
        appointment={quickMsgAppt}
        onClose={() => setQuickMsgAppt(null)}
        onSubmit={handleSubmitQuickMessage}
      />

      {/* Toast */}
      {toast && (
        <div className="toast-container">
          <div className="toast">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--emerald-text)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{toast}</span>
          </div>
        </div>
      )}
    </div>
  );
};
