import React from 'react';
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconPlus,
} from './Icons';

interface HeaderProps {
  activeTab: 'appointments' | 'work_hours';
  onTabChange: (tab: 'appointments' | 'work_hours') => void;
  currentWeekMonday: Date;
  commuteBufferMinutes?: number;
  onUpdateCommuteBuffer?: (minutes: number) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onTodayWeek: () => void;
  showHoursOverlay: boolean;
  onToggleHoursOverlay: () => void;
  onNewAppointment?: () => void;
  googleStatus?: { configured: boolean; connected: boolean; calendarId?: string } | null;
  onConnectGoogle?: () => void;
  onDisconnectGoogle?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  currentWeekMonday,
  commuteBufferMinutes = 30,
  onUpdateCommuteBuffer,
  onPrevWeek,
  onNextWeek,
  onTodayWeek,
  showHoursOverlay,
  onToggleHoursOverlay,
  onNewAppointment,
  googleStatus,
  onConnectGoogle,
  onDisconnectGoogle,
}) => {
  const weekDates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(currentWeekMonday);
    d.setDate(currentWeekMonday.getDate() + i);
    weekDates.push(d);
  }

  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const firstD = weekDates[0];
  const lastD = weekDates[6];

  const mainMonthYear = `${months[firstD.getMonth()]} ${firstD.getFullYear()}`;
  const rangeSubtitle = `${shortMonths[firstD.getMonth()]} ${firstD.getDate()} – ${
    firstD.getMonth() === lastD.getMonth() ? '' : shortMonths[lastD.getMonth()] + ' '
  }${lastD.getDate()}`;

  return (
    <header className="teams-top-bar">
      {/* Left: Primary Tabs */}
      <div className="teams-left">
        <div className="nav-tabs-group">
          <button
            className={`nav-tab-btn ${activeTab === 'appointments' ? 'active' : ''}`}
            onClick={() => onTabChange('appointments')}
          >
            <IconCalendar size={14} />
            <span>Appointments</span>
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'work_hours' ? 'active' : ''}`}
            onClick={() => onTabChange('work_hours')}
          >
            <IconClock size={14} />
            <span>Work Hours</span>
          </button>
        </div>
      </div>

      {/* Right: Date Navigator & Functional Doctor Tools */}
      <div className="teams-right">
        {activeTab === 'appointments' && (
          <>
            {/* Date Navigator */}
            <div className="nav-controls">
              <button className="nav-btn-today" onClick={onTodayWeek} title="Jump to current week">
                Today
              </button>
              
              <div className="nav-arrows-group">
                <button className="nav-arrow-btn" onClick={onPrevWeek} title="Previous week">
                  <IconChevronLeft size={15} />
                </button>
                <button className="nav-arrow-btn" onClick={onNextWeek} title="Next week">
                  <IconChevronRight size={15} />
                </button>
              </div>
            </div>

            {/* Date Header */}
            <div className="date-header-block">
              <span className="date-main-title">{mainMonthYear}</span>
              <span className="date-sub-range">{rangeSubtitle}</span>
            </div>
          </>
        )}

        {onConnectGoogle && (
          googleStatus?.connected ? (
            <button
              type="button"
              className="google-cal-btn connected"
              onClick={onDisconnectGoogle}
              title="Google Calendar is connected & synced with your phone! Click to disconnect."
              style={{
                background: 'rgba(0, 245, 155, 0.1)',
                color: 'var(--emerald-primary)',
                border: '1px solid var(--emerald-border)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
              }}
            >
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#00f59b', boxShadow: '0 0 8px #00f59b' }} />
              <span>Google Synced</span>
            </button>
          ) : (
            <button
              type="button"
              className="google-cal-btn"
              onClick={onConnectGoogle}
              title="Connect Dr. Ziad's Google Calendar to sync with iPhone"
              style={{
                background: 'var(--bg-elevated)',
                color: '#94a3b8',
                border: '1px solid var(--border-default)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
              }}
            >
              <IconCalendar size={13} />
              <span>Connect Google Cal</span>
            </button>
          )
        )}

        {activeTab === 'appointments' && onNewAppointment && (
          <button
            className="btn-new-appointment"
            onClick={onNewAppointment}
            title="Book a new walk-in, phone, or in-person appointment"
            style={{
              background: 'linear-gradient(135deg, #00f59b 0%, #00dc8b 100%)',
              color: '#000000',
              border: 'none',
              borderRadius: '8px',
              padding: '6px 14px',
              fontSize: '12.5px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0, 245, 155, 0.25)',
              transition: 'all 0.15s ease',
            }}
          >
            <IconPlus size={14} color="#000000" />
            <span>New Appointment</span>
          </button>
        )}
      </div>
    </header>
  );
};
