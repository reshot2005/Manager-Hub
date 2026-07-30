import { Routes, Route } from 'react-router-dom';
import AppLayout from './components/AppLayout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import EmployeesPage from './pages/EmployeesPage.jsx';
import AttendancePage from './pages/AttendancePage.jsx';
import EodReportsPage from './pages/EodReportsPage.jsx';
import TasksPage from './pages/TasksPage.jsx';
import CandidatesPage from './pages/CandidatesPage.jsx';
import InterviewsPage from './pages/InterviewsPage.jsx';
import SyncPage from './pages/SyncPage.jsx';
import LeavePage from './pages/LeavePage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<ChatPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/leave" element={<LeavePage />} />
        <Route path="/eod" element={<EodReportsPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/candidates" element={<CandidatesPage />} />
        <Route path="/interviews" element={<InterviewsPage />} />
        <Route path="/sync" element={<SyncPage />} />
      </Route>
    </Routes>
  );
}
