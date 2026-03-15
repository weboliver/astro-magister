# -*- coding: utf-8 -*-
from gi.repository import Gtk, Gdk
from .. surfaces.sdasurface import  DrawAux
from .gtk_helpers import safe_show_all

class AuxWindow(Gtk.Window):
    def __init__(self,parent,chart=None):
        self.boss = parent.boss
        Gtk.Window.__init__(self)
        self.set_type_hint(Gdk.WindowTypeHint.DIALOG)
        #self.set_transient_for(parent)
        self.set_destroy_with_parent(True)
        self.set_title("Astro-Nex")

        accel_group = Gtk.AccelGroup()
        accel_group.connect(Gdk.KEY_Escape,0,Gtk.AccelFlags.LOCKED,self.escape)
        accel_group.connect(Gdk.KEY_plus,0,Gtk.AccelFlags.LOCKED,self.house_change)
        accel_group.connect(Gdk.KEY_minus,0,Gtk.AccelFlags.LOCKED,self.house_change)
        accel_group.connect(Gdk.KEY_Menu,0,Gtk.AccelFlags.LOCKED,self.popup_menu)
        accel_group.connect(Gdk.KEY_Up,Gdk.ModifierType.CONTROL_MASK,Gtk.AccelFlags.LOCKED,self.fake_scroll_up)
        accel_group.connect(Gdk.KEY_Down,Gdk.ModifierType.CONTROL_MASK,Gtk.AccelFlags.LOCKED,self.fake_scroll_down)
        self.add_accel_group(accel_group) 

        self.sda = DrawAux(self.boss,chart)
        self.add(self.sda)

        aux_size = int(self.boss.opts.aux_size)
        #self.set_size_request(450,450)
        self.set_default_size(aux_size,aux_size)
        self.connect('destroy', self.cb_exit,parent)
        self.show_all()

    def escape(self,a,b,c,d):
        self.destroy() 

    def cb_exit(self,e,parent):
        self.boss.da.auxwins.remove(self)
        return False
    
    def house_change(self,acgroup,actable,keyval,mod):
        #if self.boss.da.hselvisible:
        if  keyval == Gdk.KEY_plus:
            self.boss.da.hsel.child.house_updown(1)
        else:
            self.boss.da.hsel.child.house_updown(-1)

    def popup_menu(self,acgroup,actable,keyval,mod):
        self.sda.popup_menu()

    def fake_scroll_up(self,acgroup,actable,keyval,mod):
        event = Gdk.Event(Gdk.SCROLL)
        event.direction = Gdk.SCROLL_UP
        self.sda.on_scroll(self.sda,event)
    
    def fake_scroll_down(self,acgroup,actable,keyval,mod):
        event = Gdk.Event(Gdk.SCROLL)
        event.direction = Gdk.SCROLL_DOWN
        self.sda.on_scroll(self.sda,event)

