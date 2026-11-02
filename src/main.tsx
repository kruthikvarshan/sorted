import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {LiveApp} from './live/LiveApp.tsx';
import './index.css';

// /live is the multi-phone group (people join from their phones); everything else is the full Sorted workspace.
// The app people use is Sorted; the bare address opens it.
if (window.location.pathname === '/') window.location.replace('/live');
const live = window.location.pathname.startsWith('/live');
// The service worker only receives images shared from the phone's share menu into Sorted (installed app, Android).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
createRoot(document.getElementById('root')!).render(live ? <LiveApp /> : <App />);
