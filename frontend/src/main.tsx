import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DesktopUpdateBanner } from './components/DesktopUpdateBanner';
import { HomePage } from './pages/HomePage';
import { RoomPage } from './pages/RoomPage';
import './styles.css';

// Không dùng StrictMode: nó mount 2 lần khi dev, làm WebSocket vào/ra phòng 2 lần.
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <DesktopUpdateBanner />
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/room/:roomId" element={<RoomPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>,
);
