# -*- coding: utf-8 -*-

import os
from gi.repository import Gtk
from gi.repository import GObject as gobject
import cairo
from gi.repository import Pango
from io import StringIO 
from configobj import ConfigObj, ConfigObjError
from .. extensions.path import path
from .. config import reload_config
from .gtk_helpers import apply_bg_color, safe_show_all

boss = None

class IniEditor(Gtk.Dialog):
    def __init__(self,parent):
        global boss
        boss = parent.boss
        Gtk.Window.__init__(self)
        Gtk.Dialog.__init__(self,
                _("Editor cfg.ini"), parent,
                Gtk.DialogFlags.DESTROY_WITH_PARENT,
                (_("Cerrar"), Gtk.ResponseType.NONE,
                    _("Guardar"), Gtk.ResponseType.OK))
        
        self.set_size_request(480,520)
        self.set_transient_for(parent)
        self.set_resizable(True)

        self.vbox.set_border_width(6)
        sw = Gtk.ScrolledWindow()
        sw.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        textview = Gtk.TextView()
        apply_bg_color(textview, "#000", "ini-editor-bg")
        textbuffer = textview.get_buffer()
        sw.add(textview)
        self.vbox.pack_start(sw, True, True, 0)

        cfgfile = path.joinpath(boss.opts.home_dir,'cfg.ini')
        infile = open(cfgfile, "r")

        if infile:
            self.cfgfile = cfgfile
            self.textbuffer = textbuffer
            string = infile.read()
            infile.close()
            textbuffer.set_text(string)


        self.connect("response", self.dlg_response)
        self.show_all()

    def dlg_response(self,dialog,rid):
        if rid == Gtk.ResponseType.OK:
            start = self.textbuffer.get_start_iter()
            end = self.textbuffer.get_end_iter()
            text = self.textbuffer.get_text(start,end)
            infile = StringIO(text)
            try:
                conf = ConfigObj(infile)
                conf.filename =  self.cfgfile
                conf.write()
                reload_config(conf,boss)
            except ConfigObjError as e:
                errdialog = Gtk.MessageDialog(None, Gtk.DialogFlags.MODAL,
                        Gtk.MESSAGE_ERROR,
                        Gtk.BUTTONS_OK, e.message);
                result = errdialog.run()
                errdialog.destroy()
                line = int(e.message[22:-2])
                iter = self.textbuffer.get_iter_at_line_index(line,0)
                self.textbuffer.place_cursor(iter)
                return
        dialog.destroy()
        return
