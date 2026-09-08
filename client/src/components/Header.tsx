import React from 'react';
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconCar,
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
      {/* Left: Branding & Primary Tabs */}
      <div className="teams-left">
        <div className="clinic-logo-badge">
          <IconCalendar size={18} color="#00ff88" />
          <span className="clinic-name">Doctor Schedule</span>
        </div>

        <div className="nav-divider"></div>

        {/* Primary View Tabs */}
        <div className="nav-tabs-group">
          <button
            className={`nav-tab-btn ${activeTab === 'appointments' ? 'active' : ''}`}
            onClick={() => onTabChange('appointments')}
          >
            <IconCalendar size={14} />
            <span>Scheduled Appointments</span>
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'work_hours' ? 'active' : ''}`}
            onClick={() => onTabChange('work_hours')}
          >
            <IconClock size={14} />
            <span>Set Work Hours</span>
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

            <div className="nav-divider"></div>
          </>
        )}

        {/* Road Travel Commute Buffer Selector */}
        <div className="nav-select-wrapper" title="Automatic road travel buffer before & after home visit appointments">
          <IconCar size={14} color="#38bdf8" />
          <span className="select-prefix">Travel Buffer:</span>
          <select
            value={commuteBufferMinutes}
            onChange={(e) => onUpdateCommuteBuffer && onUpdateCommuteBuffer(Number(e.target.value))}
            className="nav-buffer-select"
          >
            <option value="15">15 mins</option>
            <option value="30">30 mins</option>
            <option value="45">45 mins</option>
            <option value="60">60 mins</option>
          </select>
        </div>

        {activeTab === 'appointments' && (
          <button
            className={`nav-toggle-btn ${showHoursOverlay ? 'active' : ''}`}
            onClick={onToggleHoursOverlay}
            title="Toggle working shifts highlight on the calendar"
          >
            <IconClock size={14} />
            <span>{showHoursOverlay ? 'Shifts Visible' : 'Shifts Hidden'}</span>
          </button>
        )}
      </div>
    </header>
  );
};
