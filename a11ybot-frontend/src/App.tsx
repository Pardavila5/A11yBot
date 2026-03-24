import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './layout/Layout';
import DashboardPage from './pages/DashboardPage';
import AuditsPage from './pages/AuditsPage';
import ComparePage from './pages/ComparePage';
import OpsPage from './pages/OpsPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/audits" element={<AuditsPage />} />
        <Route path="/audits/:id" element={<AuditsPage />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/ops" element={<OpsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
