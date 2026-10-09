import re

def patch_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # 1. Update root CSS variables to include light mode
    css_patch = """
    :root {
      /* Default dark theme */
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f2937;
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --text-dim: #6b7280;
      --green: #10b981;
      --red: #ef4444;
      --blue: #3b82f6;
      --yellow: #facc15;
      --cyan: #06b6d4;
      --orange: #f97316;
      --btn-bg: #1f2937;
      --btn-border: #374151;
      --btn-active-bg: #374151;
      --input-bg: #1f2937;
      --header-bg: rgba(17, 24, 39, 0.85);
      --overlay-bg: rgba(0, 0, 0, 0.6);
    }

    html.light {
      --bg: #f3f4f6;
      --card-bg: #ffffff;
      --card-border: #e5e7eb;
      --text-main: #111827;
      --text-muted: #4b5563;
      --text-dim: #9ca3af;
      --green: #059669;
      --red: #dc2626;
      --blue: #2563eb;
      --yellow: #ca8a04;
      --cyan: #0891b2;
      --orange: #ea580c;
      --btn-bg: #e5e7eb;
      --btn-border: #d1d5db;
      --btn-active-bg: #d1d5db;
      --input-bg: #ffffff;
      --header-bg: rgba(255, 255, 255, 0.9);
      --overlay-bg: rgba(255, 255, 255, 0.7);
    }
    """
    
    # Replace existing root
    root_pattern = r':root\s*\{[^}]+\}'
    content = re.sub(root_pattern, css_patch, content, count=1)

    # 2. Update specific hardcoded colors in CSS
    content = content.replace('background: #1f2937;', 'background: var(--btn-bg);')
    content = content.replace('border: 1px solid #374151;', 'border: 1px solid var(--btn-border);')
    content = content.replace('background: #374151;', 'background: var(--btn-active-bg);')
    content = content.replace('background-color: #1f2937;', 'background-color: var(--input-bg);')
    content = content.replace('background: rgba(17, 24, 39, 0.85);', 'background: var(--header-bg);')
    content = content.replace('background: rgba(0, 0, 0, 0.6);', 'background: var(--overlay-bg);')

    # 3. Add Theme Toggle Button to controls-wrap
    btn_html = """
      <!-- Theme Toggle -->
      <button id="themeToggleBtn" class="btn-pill" style="border: 1px solid var(--card-border); background: var(--card-bg);" onclick="toggleTheme()" title="Toggle Theme">
        <svg id="themeIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      </button>
    """
    
    if '<div class="controls-wrap">' in content:
        content = content.replace('<div class="controls-wrap">', f'<div class="controls-wrap">{btn_html}')
    elif '<body>' in content: # For signals.html if it doesn't have controls-wrap
        content = content.replace('<body>', f'<body>\n<div style="position: absolute; top: 16px; right: 24px; z-index: 100;">{btn_html}</div>')

    # 4. Add JavaScript for Theme Toggle
    js_code = """
    <script>
      // Theme initialization
      function initTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'light' || (!savedTheme && window.matchMedia('(prefers-color-scheme: light)').matches)) {
          document.documentElement.classList.add('light');
          updateThemeIcon(true);
        } else {
          updateThemeIcon(false);
        }
      }

      function toggleTheme() {
        const isLight = document.documentElement.classList.toggle('light');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
        updateThemeIcon(isLight);
        
        // Dispatch custom event so chart can update
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { isLight } }));
      }

      function updateThemeIcon(isLight) {
        const icon = document.getElementById('themeIcon');
        if (!icon) return;
        if (isLight) {
          icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>'; // Moon
        } else {
          icon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>'; // Sun
        }
      }
      
      initTheme();
    </script>
    """
    content = content.replace('</body>', f'{js_code}\n</body>')
    
    # 5. Fix Chart Background in index.html dynamically if theme changes
    if 'chart = LightweightCharts.createChart' in content:
        # We need to make sure the chart initialization uses the correct colors based on current theme,
        # and also responds to the `themeChanged` event.
        
        # Replace hardcoded layout colors in initChart
        content = content.replace("background: { color: '#111827' }", "background: { color: document.documentElement.classList.contains('light') ? '#ffffff' : '#111827' }")
        content = content.replace("textColor: '#9ca3af'", "textColor: document.documentElement.classList.contains('light') ? '#4b5563' : '#9ca3af'")
        content = content.replace("vertLines: { color: 'rgba(31, 41, 55, 0.6)' }", "vertLines: { color: document.documentElement.classList.contains('light') ? 'rgba(229, 231, 235, 1)' : 'rgba(31, 41, 55, 0.6)' }")
        content = content.replace("horzLines: { color: 'rgba(31, 41, 55, 0.6)' }", "horzLines: { color: document.documentElement.classList.contains('light') ? 'rgba(229, 231, 235, 1)' : 'rgba(31, 41, 55, 0.6)' }")

        # Add event listener for themeChanged
        listener_code = """
    window.addEventListener('themeChanged', (e) => {
      if (typeof chart !== 'undefined' && chart) {
        const isLight = e.detail.isLight;
        chart.applyOptions({
          layout: {
            background: { color: isLight ? '#ffffff' : '#111827' },
            textColor: isLight ? '#4b5563' : '#9ca3af',
          },
          grid: {
            vertLines: { color: isLight ? 'rgba(229, 231, 235, 1)' : 'rgba(31, 41, 55, 0.6)' },
            horzLines: { color: isLight ? 'rgba(229, 231, 235, 1)' : 'rgba(31, 41, 55, 0.6)' },
          }
        });
      }
    });
    """
        content = content.replace('function initChart() {', f'{listener_code}\n    function initChart() {{')

    with open(filepath, 'w') as f:
        f.write(content)

patch_file('public/index.html')
patch_file('public/signals.html')
print("Patched!")
