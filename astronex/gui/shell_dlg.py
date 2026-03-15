# -*- coding: utf-8 -*-
from gi.repository import Gtk
from .. extensions.ipython_view import IPythonView
from gi.repository import Pango

import platform
if platform.system()=="Windows":
        FONT = "Lucida Console 9"
else:
        FONT = "Luxi Mono 10"

class ShellDialog(Gtk.Window):
    def __init__(self,manager):
        Gtk.Window.__init__(self)
        self.set_size_request(600,550)
        self.set_resizable(True)
        S = Gtk.ScrolledWindow()
        S.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        V = IPythonView()
        V.modify_font(Pango.FontDescription(FONT))
        V.set_wrap_mode(Gtk.WRAP_CHAR)
        V.updateNamespace({'boss': manager})
        V.show()
        S.add(V)
        S.show()
        self.add(S)
        self.show()
        self.connect('delete_event',lambda x,y:False)
        #self.connect('destroy',lambda x:Gtk.main_quit())
