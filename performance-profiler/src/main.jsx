import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { applyAppearance, readAppearance } from './theme.js';
import './themes.css';
import './styles.css';

// Before first paint, so the page never flashes the wrong theme.
applyAppearance(readAppearance());

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
