# -*- coding: utf-8 -*-
from gi.repository import Gtk
from . localwidget import LocWidget
from .gtk_helpers import safe_show_all
curr = None


class LocSelector(Gtk.Dialog):
    '''New chart inputs dialog'''

    def __init__(self,parent,calc=False):
        global curr
        self.boss = parent.boss
        curr = self.boss.state
        #self.usa = curr.usa
        
        Gtk.Dialog.__init__(self,
                _("Localidad"), parent,
                Gtk.DialogFlags.DESTROY_WITH_PARENT,
                ())
        self.connect('configure-event', self.on_configure_event) 

        self.set_size_request(400,500)
        self.vbox.set_border_width(3)
        
        loc = self.create_locwidget()
        self.vbox.pack_start(loc, True, True, 0)
        
        self.connect("response", self.quit_response,parent)
        self.show_all()
        
        wpos = self.window.get_position()
        self.pos_x = wpos[0]
        self.pos_y = wpos[1]

    def on_configure_event(self,widget,event):
        self.pos_x = event.x
        self.pos_y = event.y
    
    def quit_response(self,dialog,rid,parent):
        parent.locsel = None
        self.boss.mainwin.locselflag = False
        dialog.destroy()
        return

    def dlg_response(self,but,dialog,rid,parent):
        parent.locsel = None
        self.boss.mainwin.locselflag = False
        dialog.destroy()
        return
    
   
    def create_locwidget(self):
        loc = LocWidget()
        frame = Gtk.Frame()
        frame.set_border_width(3)
        frame.add(loc)
        return frame

