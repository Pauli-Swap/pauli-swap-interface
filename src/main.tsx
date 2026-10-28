import './polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './state/app';
import { TxProvider } from './state/tx';
import { WalletProvider } from './state/wallet';
import './styles/tokens.css';
import './styles/app.css';
import './styles/motion.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider>
      <AppProvider>
        <TxProvider>
          <App />
        </TxProvider>
      </AppProvider>
    </WalletProvider>
  </StrictMode>,
);
