# -*- coding: utf-8 -*-
from gi.repository import Gtk, Gdk
from gi.repository import Pango
from .gtk_helpers import safe_show_all

class CycleSelector(Gtk.Dialog):
    '''Planet selector'''

    def __init__(self,parent):
        self.parnt = parent
        
        Gtk.Dialog.__init__(self,
                _("Selector de ciclos PE"), parent,
                Gtk.DialogFlags.DESTROY_WITH_PARENT,
                (_("Cerrar"), Gtk.ResponseType.NONE,))

        self.vbox.set_border_width(3)
        frame = Gtk.Frame.new(_("Ciclos PE"))
        frame.set_border_width(3)
        
        self.person2 = False
        cycles = self.parnt.boss.state.get_cycles()
        
        adj = Gtk.Adjustment(cycles+1,-10,30,1,1)
        spin = Gtk.SpinButton()
        spin.set_adjustment(adj)
        spin.set_wrap(False)
        spin.set_alignment(1.0)
        adj.connect("value-changed",self.on_spin_changed,spin)
        frame.add(spin)
        self.vbox.pack_start(frame, False, False, 0)
        self.adj = adj
        
        self.connect("response", self.dlg_response)
        self.connect('key-press-event', self.on_key_press_event,parent) 
        self.set_size_request(120,-1)
        self.show_all()


    def on_spin_changed(self,widget,spin):
        delta = spin.get_value_as_int()-1
        prev_cyc = self.parnt.boss.state.get_cycles(self.person2)
        self.parnt.da.panel.update_cycles(delta-prev_cyc)

    def refresh_spin(self):
        cycles = self.parnt.boss.state.get_cycles()
        self.set_value(cycles+1)

    def set_value(self,value):
        self.adj.set_value(value)

    def dlg_response(self,dialog,rid):
        self.parnt.boss.mpanel.toolbar.get_nth_item(4).set_active(False) 
        return
    
    def on_key_press_event(self, window, event,parent): 
        keyval = event.keyval
        state = event.state & Gtk.accelerator_get_default_mod_mask()
        if (keyval == Gdk.KEY_Escape or state == Gdk.ModifierType.MOD1_MASK):
            parent.boss.mpanel.toolbar.get_nth_item(4).set_active(False) 
        return True
    
    def exit(self):
        self.parnt.da.cycleselector = None
        self.parnt.da.redraw()
        self.destroy()
