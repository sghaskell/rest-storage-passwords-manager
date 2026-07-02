/**
 * TagColorPicker.jsx — Shared color picker for tag operations.
 *
 * Exports COLOR_PRESETS and ColorPresetPicker used by TagManagementDashboard
 * and BulkTagModal for consistent tag color selection.
 */

const React = require('react');

// ─── Color Palette Presets ─────────────────────────────────────────────────

var COLOR_PRESETS = [
    { name: 'Blue',   hex: '#3b82f6' },
    { name: 'Green',  hex: '#10b981' },
    { name: 'Amber',  hex: '#f59e0b' },
    { name: 'Red',    hex: '#ef4444' },
    { name: 'Purple', hex: '#8b5cf6' },
    { name: 'Pink',   hex: '#ec4899' },
    { name: 'Cyan',   hex: '#06b6d4' },
    { name: 'Orange', hex: '#f97316' },
    { name: 'Teal',   hex: '#14b8a6' },
    { name: 'Indigo', hex: '#6366f1' }
];

// ─── Color Preset Picker ────────────────────────────────────────────────────

function ColorPresetPicker({ selectedColor, onChange, idPrefix }) {
    var prefix = idPrefix || 'cp';
    return React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }
    },
        COLOR_PRESETS.map(function(p) {
            var isActive = p.hex === selectedColor;
            return React.createElement('span', {
                key: p.hex,
                onClick: function() { onChange(p.hex); },
                title: p.name,
                style: {
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    backgroundColor: p.hex,
                    display: 'inline-block',
                    cursor: 'pointer',
                    border: isActive ? '3px solid var(--td-text)' : '2px solid transparent',
                    boxSizing: 'border-box',
                    boxShadow: isActive ? '0 0 0 1px ' + p.hex : 'none',
                    transition: 'transform 0.1s',
                    flexShrink: 0
                }
            });
        }),
        React.createElement('span', {
            title: 'Custom color',
            style: {
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
                display: 'inline-block',
                cursor: 'pointer',
                border: '2px solid var(--td-border)',
                boxSizing: 'border-box',
                position: 'relative',
                flexShrink: 0
            },
            onClick: function() {
                var el = document.getElementById(prefix + '-custom');
                if (el) el.click();
            }
        }),
        React.createElement('input', {
            id: prefix + '-custom',
            type: 'color',
            value: selectedColor,
            onChange: function(e) { onChange(e.target.value); },
            style: { position: 'absolute', opacity: 0, width: '1px', height: '1px', overflow: 'hidden' }
        })
    );
}

module.exports = { COLOR_PRESETS: COLOR_PRESETS, ColorPresetPicker: ColorPresetPicker };
