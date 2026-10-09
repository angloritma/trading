import re

def patch_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # In initChart
    crosshair_patch = """crosshair: {
          mode: LightweightCharts.CrosshairMode.Normal,
          vertLine: {
            color: 'rgba(156, 163, 175, 0.4)',
            labelBackgroundColor: document.documentElement.classList.contains('light') ? '#4b5563' : '#1f2937'
          },
          horzLine: {
            color: 'rgba(156, 163, 175, 0.4)',
            labelBackgroundColor: document.documentElement.classList.contains('light') ? '#4b5563' : '#1f2937'
          },
        },"""
    
    # Replace existing crosshair block
    crosshair_pattern = r'crosshair:\s*\{[^\}]+\n\s*vertLine:\s*\{[^\}]+\},\n\s*horzLine:\s*\{[^\}]+\},\n\s*\},'
    content = re.sub(crosshair_pattern, crosshair_patch, content)

    # In themeChanged event listener
    theme_patch = """chart.applyOptions({
          layout: {
            background: { color: isLight ? '#ffffff' : '#111827' },
            textColor: isLight ? '#4b5563' : '#9ca3af',
          },
          grid: {
            vertLines: { color: isLight ? 'rgba(229, 231, 235, 1)' : 'rgba(31, 41, 55, 0.6)' },
            horzLines: { color: isLight ? 'rgba(229, 231, 235, 1)' : 'rgba(31, 41, 55, 0.6)' },
          },
          crosshair: {
            vertLine: { labelBackgroundColor: isLight ? '#4b5563' : '#1f2937' },
            horzLine: { labelBackgroundColor: isLight ? '#4b5563' : '#1f2937' }
          }
        });"""
    content = content.replace("chart.applyOptions({\n          layout:", theme_patch.split("chart.applyOptions({\n          layout:")[0] + "chart.applyOptions({\n          layout:")

    with open(filepath, 'w') as f:
        f.write(content)

patch_file('public/index.html')
print("Patched chart crosshair colors!")
