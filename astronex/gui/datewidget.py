
from gi.repository import Gtk
from gi.repository import GObject as gobject
from gi.repository import Pango
from gi.repository import Gdk as gdk
from gi.repository import Gdk
import gi
# keysyms should be from Gdk
keysyms = Gdk
import datetime
from pytz import timezone
from .. extensions.validation import MaskEntry,ValidationError
import time
from .. boss import boss
from .gtk_helpers import safe_show_all
curr = boss.get_state()

def set_background(widget, color, state=Gtk.StateFlags.NORMAL):
    rgba = gdk.RGBA()
    if not rgba.parse(color):
        rgba.parse('#000000')
    widget.modify_base(state, rgba.to_color())

class _DateEntryPopup(Gtk.Window):
    __gsignals__ = {
            'date-selected': (gobject.SIGNAL_RUN_FIRST, gobject.TYPE_NONE,(object,)),
            }

    def __init__(self, dateentry):
        Gtk.Window.__init__(self, Gtk.WindowType.TOPLEVEL)
        self.set_type_hint(Gdk.WindowTypeHint.DIALOG)
        self.set_skip_taskbar_hint(True)
        self.set_skip_pager_hint(True)
        self.connect('key-press-event', self._on__key_press_event)
        self.connect('focus-out-event', self._on__focus_out_event)
        self._dateentry = dateentry

        frame = Gtk.Frame()
        frame.set_shadow_type(Gtk.ShadowType.ETCHED_IN)
        self.add(frame)
        frame.show()

        vbox = Gtk.VBox()
        vbox.set_border_width(6)
        frame.add(vbox)
        vbox.show()
        self._vbox = vbox

        self.calendar = Gtk.Calendar()
        
        # Monkey-patch the calendar to prevent assertion errors
        # GTK3 calendar widget has a bug with invalid day numbers
        original_select_month = self.calendar.select_month
        original_select_day = self.calendar.select_day
        
        def safe_select_month(month, year):
            """Safe wrapper around select_month that suppresses GTK errors"""
            try:
                # Clamp month to valid range (0-11)
                safe_month = max(0, min(month, 11))
                # Clamp year to reasonable range
                if 1 <= year <= 9999:
                    original_select_month(safe_month, year)
            except Exception:
                pass  # Silently ignore any errors
        
        def safe_select_day(day):
            """Safe wrapper around select_day that suppresses GTK errors"""
            try:
                # Clamp day to valid range (0-31, GTK will ignore invalid days)
                safe_day = max(0, min(day, 31))
                if safe_day > 0:
                    original_select_day(safe_day)
            except Exception:
                pass  # Silently ignore any errors
        
        self.calendar.select_month = safe_select_month
        self.calendar.select_day = safe_select_day
        
        self.calendar.connect('day-selected-double-click',
                               self._on_calendar__day_selected_double_click)
        vbox.pack_start(self.calendar, False, False, 0)
        self.calendar.show()

        buttonbox = Gtk.HButtonBox()
        buttonbox.set_border_width(6)
        buttonbox.set_layout(Gtk.ButtonBoxStyle.SPREAD)
        vbox.pack_start(buttonbox, False, False, 0)
        buttonbox.show()

        for label, callback in [(_('_Hoy'), self._on_today__clicked),
                                (_('_Cancelar'), self._on_cancel__clicked),
                                (_('_Aceptar'), self._on_select__clicked)]:
            button = Gtk.Button(label, use_underline=True)
            button.connect('clicked', callback)
            buttonbox.pack_start(button, True, True, 0)
            button.show()

        self.set_resizable(False)
        self.set_screen(dateentry.get_screen())
        self.set_decorated(False)

        self.realize()
        self.height = self._vbox.size_request().height

    def _on_calendar__day_selected_double_click(self, calendar):
        self.emit('date-selected', self.get_date())

    def _on__focus_out_event(self, window, event):
        # When popup loses focus, hide it
        self.popdown()
        return False

    def _on__key_press_event(self, window, event):
        keyval = event.keyval
        state = event.state & Gtk.accelerator_get_default_mod_mask()
        if (keyval == keysyms.Escape or
            ((keyval == keysyms.Up or keyval == keysyms.KP_Up) and
             state == gdk.MOD1_MASK)):
            self.popdown()
            return True
        elif keyval == keysyms.Tab:
            self.popdown()
            return True
        elif (keyval == keysyms.Return or
              keyval == keysyms.space or
              keyval == keysyms.KP_Enter or
              keyval == keysyms.KP_Space):
            self.emit('date-selected', self.get_date())
            return True

        return False

    def _on_select__clicked(self, button):
        self.emit('date-selected', self.get_date())

    def _on_cancel__clicked(self, button):
        self.popdown()

    def _on_today__clicked(self, button):
        self.set_date(datetime.date.today())

    def _popup_grab_window(self):
        # Use modern Seat API (GTK 3.20+) instead of deprecated pointer_grab
        display = Gdk.Display.get_default()
        seat = display.get_default_seat()
        window = self.get_window()
        
        if seat and window:
            # Grab with KEYBOARD and POINTER capabilities
            capabilities = Gdk.SeatCapabilities.KEYBOARD | Gdk.SeatCapabilities.POINTER
            try:
                status = seat.grab(
                    window,
                    capabilities,
                    True,   # owner_events - allow events to reach widgets inside
                    None,   # cursor
                    None,   # event
                    None    # prepare_func
                )
                if status == Gdk.GrabStatus.SUCCESS:
                    return True
                else:
                    # Grab failed, try without keyboard
                    import sys
                    print(f"Seat grab failed with status {status}, trying pointer only", file=sys.stderr, flush=True)
                    status = seat.grab(
                        window,
                        Gdk.SeatCapabilities.POINTER,
                        True,
                        None,
                        None,
                        None
                    )
                    return status == Gdk.GrabStatus.SUCCESS
            except Exception as e:
                import sys
                print(f"Exception in seat.grab(): {e}", file=sys.stderr, flush=True)
                return False
        return False

    def _try_popup_grab(self):
        """Try to grab window on idle - window should be mapped by then"""
        import sys
        print("DEBUG: _try_popup_grab called", file=sys.stderr, flush=True)
        if not self.get_visible():
            print("DEBUG: popup not visible, aborting grab", file=sys.stderr, flush=True)
            return False
        
        # Don't use seat.grab() - it prevents clicks on the calendar
        # Just use grab_add() for keyboard focus
        print("DEBUG: using grab_add only (no seat grab)", file=sys.stderr, flush=True)
        self.grab_add()
        return False

    def _get_position(self):
        self.realize()
        calendar = self
        sample = self._dateentry

        # Make sure the widget is realized and has a window
        if not sample.get_realized():
            sample.realize()
        
        window = sample.get_window()
        if window:
            # Get absolute screen coordinates
            _, x, y = window.get_origin()
            # Get widget allocation to find actual position within the window
            alloc = sample.get_allocation()
            x += alloc.x
            y += alloc.y
        else:
            # Fallback to (0, 0) if no window available
            x, y = 0, 0
        
        requisition = calendar.size_request()
        width, height = requisition.width, requisition.height
        height = self.height

        screen = sample.get_screen()
        if sample.get_window():
            monitor_num = screen.get_monitor_at_window(sample.get_window())
        else:
            monitor_num = 0
        monitor = screen.get_monitor_geometry(monitor_num)

        if x < monitor.x:
            x = monitor.x
        elif x + width > monitor.x + monitor.width:
            x = monitor.x + monitor.width - width

        if y + sample.allocation.height + height <= monitor.y + monitor.height:
            y += sample.allocation.height
        elif y - height >= monitor.y:
            y -= height
        elif (monitor.y + monitor.height - (y + sample.allocation.height) >
              y - monitor.y):
            y += sample.allocation.height
            height = monitor.y + monitor.height - y
        else :
            height = y - monitor.y
            y = monitor.y

        return x, y, width, height

    def popup(self, date):
        """
        Shows the calendar popup. And optionally selects a date
        @param date: date to select (optional, can be None)
        """
        combo = self._dateentry
        if not combo.get_realized():
            return

        # Check if popup is already visible
        if self.get_visible():
            return
            
        x, y, width, height = self._get_position()
        self.set_size_request(width, height)
        
        # Safely set the date if provided
        if date:
            # Validate date before using
            try:
                if isinstance(date, datetime.date) and 1 <= date.year <= 9999:
                    self._safe_select_date(date)
                else:
                    # If date is invalid, use today
                    self._safe_select_date(datetime.date.today())
            except:
                # On any error, just use today
                try:
                    self._safe_select_date(datetime.date.today())
                except:
                    pass
        else:
            # If no date provided, use today
            try:
                today = datetime.date.today()
                self._safe_select_date(today)
            except:
                pass
        
        # Move and show
        self.move(x, y)
        self.show_all()
        self.present()
        
        # Grab focus to calendar
        try:
            if not self.calendar.has_focus():
                self.calendar.grab_focus()
        except:
            pass

    def popdown(self):
        combo = self._dateentry
        if not combo.get_realized():
            return

        # No grab_remove() since we don't use grab_add()
        # No seat.ungrab() since we don't use seat.grab()
        
        self.hide()

    def get_date(self):
        try:
            y, m, d = self.calendar.get_date()
            return datetime.date(y, m + 1, d)
        except (ValueError, TypeError):
            # Fallback to today if calendar date is invalid
            return datetime.date.today()

    def _safe_select_date(self, date):
        """Safely select a date in the calendar without GTK assertion errors
        
        This method uses direct calendar property setting instead of select_month/select_day
        to avoid GTK3 calendar widget bugs that cause assertion errors.
        """
        import calendar as cal_module
        
        try:
            # Validate the date
            if not isinstance(date, datetime.date):
                return False
                
            # Check if date is in valid range
            if date.year < 1 or date.year > 9999:
                return False
            
            # Get the last day of the month
            _, last_day = cal_module.monthrange(date.year, date.month)
            
            # Clamp day to valid range
            safe_day = max(1, min(date.day, last_day))
            
            # Instead of using select_month/select_day which trigger GTK3 bugs,
            # we directly set the internal calendar properties
            # This avoids the assertion error in calendar_invalidate_day_num
            try:
                # Use direct GObject property setting if possible
                # This bypasses the buggy select_month/select_day methods
                self.calendar.props.year = date.year
                self.calendar.props.month = date.month - 1  # GTK uses 0-indexed months
                self.calendar.props.day = safe_day
                
                # Clear any marks and mark the selected day
                self.calendar.clear_marks()
                self.calendar.mark_day(safe_day)
            except:
                # Fallback to the safe monkey-patched methods
                self.calendar.select_month(date.month - 1, date.year)
                self.calendar.select_day(safe_day)
                self.calendar.clear_marks()
                self.calendar.mark_day(safe_day)
            
            return True
        except Exception as e:
            # Silently fall back to today if anything goes wrong
            try:
                today = datetime.date.today()
                try:
                    self.calendar.props.year = today.year
                    self.calendar.props.month = today.month - 1
                    self.calendar.props.day = today.day
                    self.calendar.clear_marks()
                    self.calendar.mark_day(today.day)
                except:
                    self.calendar.select_month(today.month - 1, today.year)
                    self.calendar.select_day(today.day)
                    self.calendar.clear_marks()
                    self.calendar.mark_day(today.day)
            except:
                pass
            return False

    def set_date(self, date):
        """Set the calendar to display the given date (with safety checks)"""
        self._safe_select_date(date)



class DateEntry(Gtk.HBox):
    __gsignals__ = {
            'changed': (gobject.SIGNAL_RUN_FIRST, gobject.TYPE_NONE,()),
            }

    def __init__(self,manager,fullpanel=True):
        self.boss = manager
        Gtk.HBox.__init__(self)
        self._popping_down = False
        dt = datetime.datetime.now()
        self.date = dt.date()
        self.time = dt.time()
        self.dateformat = "%d/%m/%Y"
        self.timeformat = "%H:%M:%S"

        vbox = Gtk.VBox()
        self.dateentry = MaskEntry()
        self.dateentry.set_mask('00/00/0000')
        self.dateentry.connect('changed',self.on_entry_changed)
        self.dateentry.connect('focus_out_event',self.on_entry_focus_out)
        mask = self.dateentry.get_mask()
        self.dateentry.set_width_chars(len(mask))
        hbox1 = Gtk.HBox()
        if fullpanel:
            label = Gtk.Label("    "+_("Fecha:")+"    ")
            hbox1.pack_start(label, False, False, 0)
            sg = Gtk.SizeGroup(Gtk.SizeGroupMode.HORIZONTAL)
            sg.add_widget(label)
        hbox1.pack_start(self.dateentry, False, False, 0)

        self._button = Gtk.ToggleButton()
        self._button.connect('scroll-event', self.on_entry_scroll_event)
        self._button.connect('toggled', self.on_button_toggled)
        self._button.set_focus_on_click(False)
        hbox1.pack_start(self._button, False, False, 0)
        self._button.show()

        arrow = Gtk.Arrow(Gtk.ArrowType.DOWN, Gtk.ShadowType.NONE)
        self._button.add(arrow)
        arrow.show()

        self._popup = _DateEntryPopup(self)
        self._popup.connect('date-selected', self._on_popup__date_selected)
        self._popup.connect('hide', self._on_popup__hide)
        self._popup.set_size_request(-1, 24)

        vbox.pack_start(hbox1, False, False, 0)
        if fullpanel:
            label = Gtk.Label(_("Hora:"))
            self.timeentry = MaskEntry()
            self.timeentry.set_mask('00:00:00')
            self.timeentry.connect('changed',self.on_entry_changed)
            self.timeentry.connect('focus_out_event',self.on_entry_focus_out)
            mask = self.timeentry.get_mask()
            self.timeentry.set_width_chars(len(mask))
            hbox2 = Gtk.HBox()
            hbox2.pack_start(label, False, False, 0)
            hbox2.pack_start(self.timeentry, False, False, 0)
            sg.add_widget(label)
            vbox.pack_start(hbox2, False, False, 0)
            self.pack_end(self.create_delta_panel(), False, False, 0)

        self.pack_start(vbox, False, False, 0)

    def create_delta_panel(self):
        vbox = Gtk.VBox()
        adj = Gtk.Adjustment(1,1,15,1,5)
        spin = Gtk.SpinButton()
        spin.set_adjustment(adj)
        spin.set_wrap(True)
        spin.set_alignment(1.0)
        self.spin = spin
        vbox.pack_start(spin, False, False, 0)

        hbox = Gtk.HBox()
        self.left_arrow_button = Gtk.Button()
        arrow = Gtk.Arrow(Gtk.ArrowType.LEFT, Gtk.ShadowType.NONE)
        self.left_arrow_button.add(arrow)
        self.left_arrow_button.set_size_request(26,-1)
        self.left_arrow_button.connect('clicked',self.on_panel_arrow_clicked)
        hbox.pack_start(self.left_arrow_button, False, False, 0)

        button = Gtk.ToggleButton(_('minutos'))
        button.set_size_request(60,-1)
        button.connect('toggled',self.on_delta_toggled)
        button.connect('scroll-event', self.on_delta_scroll_event)
        self.hintbut = button
        hbox.pack_start(button, False, False, 0)

        self.right_arrow_button = Gtk.Button()
        arrow = Gtk.Arrow(Gtk.ArrowType.RIGHT, Gtk.ShadowType.NONE)
        self.right_arrow_button.add(arrow)
        self.right_arrow_button.set_size_request(26,-1)
        self.right_arrow_button.connect('clicked',self.on_panel_arrow_clicked)
        hbox.pack_start(self.right_arrow_button, False, False, 0)
        vbox.pack_start(hbox, False, False, 0)
        return vbox

    def do_grab_focus(self):
        self.dateentry.grab_focus()

    def on_entry_changed(self,entry):
        self.calc_and_set(entry)

    def on_entry_focus_out(self,entry,event):
        self.calc_and_set(entry)

    def calc_and_set(self,entry):
        if entry is self.dateentry:
            try:
                self.date = self.get_date()
                set_background(entry, "#ffffff")
            except ValidationError as e:
                self.date = None
                set_background(entry, "#ff699a")
        elif entry is self.timeentry:
            try:
                self.time = self.get_time()
                set_background(entry, "#ffffff")
            except ValidationError as e:
                self.time = None
                set_background(entry, "#ff699a")
        if self.date is not None and self.time is not None:
            curr.calcdt.setdt(datetime.datetime.combine(self.date,self.time))
        active = self.boss.mpanel.active_slot
        curr.setchart()
        curr.act_pool(active,curr.calc)

    def set_date(self,date):
        if not isinstance(date,datetime.date):
            raise TypeError("date must be a datetime.date instance")
        if date.year < 1900:
            year = date.year
            month = str(date.month).rjust(2,'0')
            day = str(date.day).rjust(2,'0')
            strdate = "%s/%s/%s" % (day,month,year)
            self.dateentry.set_text(strdate)
        else:
            self.dateentry.set_text(date.strftime(self.dateformat))

    def get_date(self):
        text = self.dateentry.get_text()
        if text == "":
            return None
        try:
            dateinfo = time.strptime(text, self.dateformat)
            return datetime.date(*dateinfo[:3])
        except ValueError:
            raise ValidationError('value error: %s' % text)
        return None

    def set_time(self,time):
        if not isinstance(time,datetime.time):
            raise TypeError("date must be a datetime.time instance")
        self.timeentry.set_text(time.strftime(self.timeformat))

    def get_time(self):
        text = self.timeentry.get_text()
        if text == "":
            return None
        try:
            dateinfo = time.strptime(text, self.timeformat)
            return datetime.time(*dateinfo[3:6])
        except ValueError:
            raise ValidationError('value error: %s' % text)

    def on_entry_scroll_event(self,entry,event):
        if event.direction == gdk.SCROLL_UP:
            amount = 1
        elif event.direction == gdk.SCROLL_DOWN:
            amount = -1
        else:
            return
        try:
            date = self.get_date()
            newdate = date + datetime.timedelta(days=amount)
        except ValidationError:
            newdate = datetime.date.today()
        self.set_date(newdate)

    def on_button_toggled(self,button):
        if self._popping_down:
            return
        try:
            date = self.get_date()
        except ValidationError:
            date = None
        self._popup.popup(date)

    def _on_popup__hide(self, popup):
        self._popping_down = True
        self._button.set_active(False)
        self._popping_down = False

    def _on_popup__date_selected(self, popup, date):
        self.set_date(date)
        popup.popdown()
        self.dateentry.grab_focus()
        self.dateentry.set_position(len(self.dateentry.get_text()))

    def on_panel_arrow_clicked(self,but):
        delta = self.spin.get_value_as_int()
        if but is self.left_arrow_button:
            delta = -delta
        self.change_on_delta(delta)

    def on_delta_toggled(self,but):
        hint = [_('minutos'),_('horas')]
        lbl = hint[but.get_active()]
        but.set_label(lbl)

    def on_delta_scroll_event(self,entry,event):
        delta = self.spin.get_value_as_int()
        if event.direction == gdk.SCROLL_UP:
            amount = 1 * delta
        elif event.direction == gdk.SCROLL_DOWN:
            amount = -1 * delta
        else:
            return
        self.change_on_delta(amount)

    def change_on_delta(self,delta):
        changes = {_('minutos'):'minutes',_('horas'):'hours'}
        hof = None
        change = changes[self.hintbut.get_label()]
        try:
            time = self.get_time()
        except ValidationError:
            time = None
        if not time:
            time = datetime.time.min
        h = time.hour
        m = time.minute
        s = time.second
        if change == 'minutes':
            mof,m = divmod(m+delta,60)
            if mof:
                hof,h = divmod(h+mof,24)
        else:
            hof,h = divmod(h+delta,24)
        newtime = datetime.time(h,m,s)
        self.set_time(newtime)
        if hof:
            try:
                date = self.get_date()
                newdate = date + datetime.timedelta(days=hof)
            except ValidationError:
                newdate = datetime.date.today()
            self.set_date(newdate)
