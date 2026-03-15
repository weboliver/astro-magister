# -*- coding: utf-8 -*-
from gi.repository import Gtk, Gdk
from gi.repository import Pango
from .. drawing.dispatcher import DrawMixin
from .gtk_helpers import safe_show_all

class PlanSelector(Gtk.Dialog):
    '''Planet selector'''

    def __init__(self,parent):
        self.parnt = parent
        self.notwanted = set()
        self.plet = ['d','f','h','j','k','l','g','z','x','c','v','b','9']
        
        Gtk.Dialog.__init__(self,
                _("Selector de aspectos"), parent,
                Gtk.DialogFlags.DESTROY_WITH_PARENT,
                (_("Cerrar"), Gtk.ResponseType.NONE,))

        #self.set_size_request(400,580)
        self.vbox.set_border_width(3)
        frame = Gtk.Frame.new(_("Ocultar"))
        frame.set_border_width(3)
        
        frame.add(self.create_buttonlist())
        self.vbox.pack_start(frame, False, False, 0)
        
        self.connect("response", self.dlg_response)
        self.connect('key-press-event', self.on_key_press_event,parent) 

        self.show_all()
        self.parnt.da.redraw()

    def create_buttonlist(self):
        font = Pango.FontDescription("Astro-Nex")
        vbuttonbox = Gtk.VButtonBox() 
        for let in self.plet:
            but = Gtk.ToggleButton(let)
            label = but.get_children()[0] if but.get_children() else None
            if label:
                label.override_font(font)
            but.set_mode(True)
            but.connect("toggled",self.on_but_toggled)
            vbuttonbox.pack_start(but, False, False, 0)
        return vbuttonbox

    def on_but_toggled(self,but):
        let = but.get_label()
        if but.get_active():
            self.notwanted.add(self.plet.index(let))
        else:
            self.notwanted.discard(self.plet.index(let))
        DrawMixin.notwanted = list(self.notwanted)
        self.parnt.da.redraw()
        self.parnt.da.redraw_auxwins() 

    def dlg_response(self,dialog,rid):
        self.parnt.boss.mpanel.toolbar.get_nth_item(3).set_active(False) 
        return
    
    def on_key_press_event(self,window,event,parent): 
        if event.keyval == Gdk.KEY_Escape:
            parent.boss.mpanel.toolbar.get_nth_item(3).set_active(False) 
        return True

    def exit(self):
        DrawMixin.notwanted  = []
        #self.parnt.da.drawer.notwanted
        self.parnt.da.redraw()
        self.parnt.da.plselector = None
        self.destroy()
