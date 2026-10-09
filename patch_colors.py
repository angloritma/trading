def patch_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # index.html specific replacements
    content = content.replace('background: #0f172a;', 'background: var(--card-bg);')
    content = content.replace('background: #1e293b;', 'background: var(--btn-bg);')
    content = content.replace('border: 1px solid #334155;', 'border: 1px solid var(--btn-border);')
    content = content.replace('background: #334155;', 'background: var(--btn-active-bg);')
    content = content.replace('color: white;\n      border-color: #64748b;', 'color: var(--text-main);\n      border-color: var(--blue);')
    
    # Tooltip / Modal
    content = content.replace('background: rgba(17, 24, 39, 0.88);', 'background: var(--header-bg);')
    content = content.replace('background: rgba(9, 13, 22, 0.7);', 'background: var(--overlay-bg);')
    content = content.replace('background: rgba(31, 41, 55, 0.4);', 'background: var(--btn-bg);')
    
    # Table header
    content = content.replace('background: rgba(255, 255, 255, 0.08);', 'background: var(--btn-bg);')
    
    # signals.html specific replacements
    content = content.replace('background:#1f2937;', 'background:var(--btn-bg);')
    content = content.replace('border-color:#374151;', 'border-color:var(--btn-border);')
    content = content.replace('color:#9ca3af;', 'color:var(--text-muted);')

    # Remove inline hardcoded colors for TP/SL text
    content = content.replace('color:#10b981;', 'color:var(--green);')
    content = content.replace('color:#ef4444;', 'color:var(--red);')
    content = content.replace('color:#3b82f6;', 'color:var(--blue);')
    content = content.replace('color:#60a5fa;', 'color:var(--blue);')
    content = content.replace('color:#34d399;', 'color:var(--green);')
    content = content.replace('color:#f87171;', 'color:var(--red);')

    with open(filepath, 'w') as f:
        f.write(content)

patch_file('public/index.html')
patch_file('public/signals.html')
print("Patched colors!")
