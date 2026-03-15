"""Initialize GObject Introspection for GTK3"""

import gi
import sys
import os

# Suppress GTK log messages at C level before importing GTK
# This prevents the GTK3 calendar assertion error messages
os.environ['G_MESSAGES_DEBUG'] = ''
os.environ['G_DEBUG'] = ''

# Require specific GTK versions
gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
gi.require_version('Pango', '1.0')
gi.require_version('PangoCairo', '1.0')

# Now set up glib message handler to filter out known GTK errors
from gi.repository import GLib

# Store original handlers
_original_print_handler = None

def _gtk_error_handler(log_domain, log_level, message, user_data):
    """Suppress known GTK3 calendar assertion errors that don't affect functionality"""
    msg_str = str(message).lower() if message else ""
    
    # Suppress GTK3 calendar widget bugs
    # These are C-level assertion errors in GTK3's calendar implementation
    # They don't affect application functionality
    calendar_keywords = [
        'calendar_invalidate_day_num',
        'calendar_month_changed',
        'gtk_calendar',
        'invalid_row_ref',
        'row != -1',
        'day_num'
    ]
    
    for keyword in calendar_keywords:
        if keyword in msg_str:
            return True  # Suppress this message
    
    # Suppress GTK assertion failures for calendar
    if 'assertion' in msg_str and 'calendar' in msg_str:
        return True
    if 'assertion' in msg_str and 'row' in msg_str:
        return True
        
    # Let other messages through
    return False

# Install custom log handler for Gtk messages
GLib.log_set_handler(
    "Gtk",
    GLib.LogLevelFlags.LEVEL_CRITICAL | GLib.LogLevelFlags.LEVEL_WARNING | GLib.LogLevelFlags.LEVEL_MESSAGE,
    _gtk_error_handler,
    None
)

# Also suppress Gdk messages that might be related
GLib.log_set_handler(
    "Gdk",
    GLib.LogLevelFlags.LEVEL_CRITICAL,
    _gtk_error_handler,
    None
)

# Provide GTK2-style constants for backward compatibility with legacy code
from gi.repository import Gtk, Gdk

if not hasattr(Gdk, 'BUTTON_PRESS'):
    Gdk.BUTTON_PRESS = Gdk.EventType.BUTTON_PRESS
if not hasattr(Gdk, 'BUTTON_RELEASE'):
    Gdk.BUTTON_RELEASE = Gdk.EventType.BUTTON_RELEASE
if not hasattr(Gdk, '_2BUTTON_PRESS'):
    Gdk._2BUTTON_PRESS = Gdk.EventType._2BUTTON_PRESS
if not hasattr(Gdk, 'SCROLL'):
    Gdk.SCROLL = Gdk.EventType.SCROLL
if not hasattr(Gdk, 'SCROLL_UP'):
    Gdk.SCROLL_UP = Gdk.ScrollDirection.UP
if not hasattr(Gdk, 'SCROLL_DOWN'):
    Gdk.SCROLL_DOWN = Gdk.ScrollDirection.DOWN
if not hasattr(Gdk, 'MOTION_NOTIFY'):
    Gdk.MOTION_NOTIFY = Gdk.EventType.MOTION_NOTIFY
if not hasattr(Gtk.Widget, 'allocation'):
    Gtk.Widget.allocation = property(Gtk.Widget.get_allocation)