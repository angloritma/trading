import re

def fix():
    with open('public/signals.html', 'r') as f:
        content = f.read()
    
    # 1. Remove the old absolute div block
    old_block_pattern = r'<div style="position: absolute; top: 16px; right: 24px; z-index: 100;">\s*<!-- Theme Toggle -->\s*<button id="themeToggleBtn"[^>]+>\s*<svg[^>]+>.*?</svg>\s*</button>\s*</div>'
    content = re.sub(old_block_pattern, '', content, flags=re.DOTALL)
    
    # 2. Insert the button inside the header's right controls div
    btn_html = """
      <!-- Theme Toggle -->
      <button id="themeToggleBtn" class="btn-pill" style="border: 1px solid var(--card-border); background: var(--card-bg); padding:6px; margin-left: 8px;" onclick="toggleTheme()" title="Toggle Theme">
        <svg id="themeIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      </button>"""
    
    target_div = '<div style="display:flex; align-items:center; gap:12px;">'
    if target_div in content:
        content = content.replace(target_div, f'{target_div}{btn_html}')
        
    with open('public/signals.html', 'w') as f:
        f.write(content)

fix()
print("Fixed button positioning")
