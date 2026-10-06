import React from 'react';
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconPlus,
} from './Icons';

interface HeaderProps {
  simulatorMode?: boolean;
  activeTab: 'appointments' | 'work_hours' | 'simulator';
  onTabChange: (tab: 'appointments' | 'work_hours' | 'simulator') => void;
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
  simulatorMode = false,
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
      {/* Left: Clean Navigation Tabs */}
      <div className="teams-left">
        <div className="nav-tabs-group">
          <button
            className={`nav-tab-btn ${activeTab === 'appointments' ? 'active' : ''}`}
            onClick={() => onTabChange('appointments')}
          >
            <IconCalendar size={14} />
            <span>Calendar</span>
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'work_hours' ? 'active' : ''}`}
            onClick={() => onTabChange('work_hours')}
          >
            <IconClock size={14} />
            <span>Work Hours</span>
          </button>
          {simulatorMode && <button className={`nav-tab-btn ${activeTab === 'simulator' ? 'active' : ''}`} onClick={() => onTabChange('simulator')}>
            <IconCalendar size={14} /><span>Patient Simulator</span>
          </button>}
        </div>
        {simulatorMode && <span style={{color:'var(--emerald-primary)',fontSize:12,marginLeft:12}}>Sandbox calendar</span>}
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
            >
              <span className="google-sync-dot" />
              <span>Google Synced</span>
            </button>
          ) : (
            <button
              type="button"
              className="google-cal-btn"
              onClick={onConnectGoogle}
              title="Connect Dr. Ziad's Google Calendar to sync with iPhone"
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
          >
            <IconPlus size={14} />
            <span>New Appointment</span>
          </button>
        )}
      </div>
    </header>
  );
};
