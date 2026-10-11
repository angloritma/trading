/**
 * Angloritma Quant - Shared Frontend Utilities
 * Theme management, Toast, Formatting, and Watchlist storage
 */

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const isLight = savedTheme === 'light' || (!savedTheme && prefersLight);

  if (isLight) {
    document.documentElement.classList.add('light');
  } else {
    document.documentElement.classList.remove('light');
  }
  updateThemeIcon(isLight);
}

function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  updateThemeIcon(isLight);
  window.dispatchEvent(new CustomEvent('themeChanged', { detail: { isLight } }));
}

function updateThemeIcon(isLight) {
  const icon = document.getElementById('themeIcon');
  if (!icon) return;
  if (isLight) {
    // Moon icon for switching to dark
    icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
  } else {
    // Sun icon for switching to light
    icon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
  }
}

// Toast Notifications
function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'warn') icon = '⚠️';
  if (type === 'error') icon = '❌';

  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

// Price and Currency Formatter
function formatPrice(val) {
  if (val === null || val === undefined || isNaN(val)) return '-';
  const num = Number(val);
  if (num >= 1000) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (num >= 1) {
    return num.toFixed(3);
  }
  if (num >= 0.0001) {
    return num.toFixed(5);
  }
  return num.toFixed(8);
}

// Percentage Formatter
function formatPct(val) {
  if (val === null || val === undefined || isNaN(val)) return '0.00%';
  const num = Number(val);
  return (num >= 0 ? '+' : '') + num.toFixed(2) + '%';
}

// Watchlist (Favorite Tokens) helper
const Watchlist = {
  get() {
    try {
      return JSON.parse(localStorage.getItem('angloritma_favorites') || '["BTCUSD", "ETHUSD", "SOLUSD"]');
    } catch {
      return ['BTCUSD', 'ETHUSD', 'SOLUSD'];
    }
  },
  has(symbol) {
    return this.get().includes(symbol.toUpperCase());
  },
  toggle(symbol) {
    const sym = symbol.toUpperCase();
    let list = this.get();
    if (list.includes(sym)) {
      list = list.filter(s => s !== sym);
      showToast(`${sym} dihapus dari favorit`, 'info');
    } else {
      list.push(sym);
      showToast(`${sym} ditambahkan ke favorit ⭐`, 'success');
    }
    localStorage.setItem('angloritma_favorites', JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('watchlistUpdated', { detail: { list } }));
    return list.includes(sym);
  }
};

// Auto-run theme initialization
document.addEventListener('DOMContentLoaded', initTheme);
