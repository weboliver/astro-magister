# -*- coding: utf-8 -*-
import os
from gi.repository import Gtk, Gdk
from .gtk_helpers import create_combo_with_entry, get_combo_active_text, safe_show_all
from gi.repository import Pango
from configobj import ConfigObj
from .. extensions.path import path
from . localwidget import LocWidget 
from itertools import count
izip = zip
from configobj import ConfigObj
from . searchview import SearchView

from .. boss import boss
curr = boss.get_state()

MARKUP = "<b><i>%s</i></b>"
elem = ["fire","earth","air","water"]
plan = ["pers","trans","tool","node"]
asp = ["orange","red","blue","green"]
aux = ['click1','click2','inv','low','transcol']

class ConfigDlg(Gtk.Dialog):
    '''Property dialog'''
    groups = [_("Localidad"), _("Tablas"), _("Colores"),
            _("Lineas"), _("Fuentes"), _("Orbes"),_("Lenguage"), _("PNG")]

    def __init__(self,parent):
        opts = boss.opts
        self.config_file = path.joinpath(boss.home_dir,boss.config_file)

        Gtk.Dialog.__init__(self,
                _("Configuracion"), parent,
                Gtk.DialogFlags.DESTROY_WITH_PARENT,
                (_("Cerrar"), Gtk.ResponseType.NONE,
                    _("Guardar"), Gtk.ResponseType.OK))
        self.set_size_request(550,380)

        hbox = Gtk.HBox()
        hbox.set_border_width(3)
        hbox.pack_start(self.index_table(), False, False, 0)
        hbox.pack_start(Gtk.VSeparator(), False, False, 0)

        self.notebook = Gtk.Notebook()
        self.notebook.set_show_tabs(False)
        self.notebook.set_show_border(True)

        widget = ConfLocWidget()
        self.notebook.append_page(self.build_nbpage(widget,
            (_("Localidad por defecto"))))

        widget = TablesPage(boss.datab)
        self.notebook.append_page(self.build_nbpage(widget,
            (_("Tablas por defecto"))))

        widget = ColorsPage()
        self.notebook.append_page(self.build_nbpage(widget,
            (_("Colores"))))
        
        widget = LinesPage()
        self.notebook.append_page(self.build_nbpage(widget,
            (_("Lineas"))))
        
        widget = FontsPage()
        self.notebook.append_page(self.build_nbpage(widget,
            (_("Fuentes"))))
        
        widget = OrbsPage()
        self.notebook.append_page(self.build_nbpage(widget,
            (_("Orbes"))))
        
        widget = LangPage()
        self.notebook.append_page(self.build_nbpage(widget,
            (_("Lenguage por defecto"))))
        
        widget = PngPage()
        self.notebook.append_page(self.build_nbpage(widget,
            (_("Tamano de imagen PNG"))))
        
        hbox.pack_start(self.notebook, True, True, 0) 
        self.vbox.pack_start(hbox, True, True, 0)
        self.connect("response", self.dlg_response)
        self.show_all()

        win = self.get_window()
        if win is not None:
            try:
                wpos = win.get_position()
                self.pos_x = wpos[0]
                self.pos_y = wpos[1]
            except Exception:
                self.pos_x = 0
                self.pos_y = 0
        else:
            self.pos_x = 0
            self.pos_y = 0

    def dlg_response(self,dialog,rid):
        if rid == Gtk.ResponseType.OK:
            conf = ConfigObj(self.config_file)
            boss.opts.opts_to_config(conf)
            conf.write()
        dialog.destroy()
        return
    
    def on_configure_event(self,widget,event):
        self.pos_x = event.x
        self.pos_y = event.y
    
    def index_table(self):
        model = Gtk.ListStore(str)
        #view = Gtk.TreeView(model)
        view = SearchView(model)
        view.set_size_request(100,-1)
        view.set_rules_hint(True)
        selection = view.get_selection()
        selection.set_mode(Gtk.SelectionMode.SINGLE)
        for o in self.groups:
            model.append((o,))
        cell = Gtk.CellRendererText()
        cell.weight = 600
        column = Gtk.TreeViewColumn(None,cell,text=0)
        view.append_column(column)
        view.set_headers_visible(False) 
        view.set_enable_search(False)
        sel = view.get_selection()
        sel.set_mode(Gtk.SelectionMode.SINGLE)
        sel.connect('changed',self.on_sel_changed)
        return view
    
    def on_sel_changed(self,sel):
        model, iter = sel.get_selected()
        index = model.get_path(iter)[0]
        self.notebook.set_current_page(index)
    
    def build_nbpage(self,widget,text):
        vbox = Gtk.VBox()
        label = Gtk.Label()
        label.set_markup(MARKUP % text)
        vbox.pack_start(label, False, False, 0)
        vbox.pack_start(Gtk.HSeparator(), False, False, 0)
        vbox.pack_start(widget, True, True, 0) 
        return vbox

class ConfLocWidget(LocWidget):
    def __init__(self): 
        LocWidget.__init__(self,default=True)
        self.country_combo.set_size_request(-1,-1)
        self.reg_combo.set_size_request(-1,-1)
        
    def on_row_activate(self,tree,path,col):
        return

    def actualize_if_needed(self,city,code):
        curr.setloc(city,code) 
        boss.opts.locality = city
        boss.opts.region = code
    
    def set_country_code(self,code):
        curr.country = code
        boss.opts.country = code

    def on_usa_toggled(self,check,cpl,lbl):
        LocWidget.on_usa_toggled(self,check,cpl,lbl)
        usa = ['false','true'][check.get_active()]
        boss.opts.usa = usa

class TablesPage(Gtk.VBox):
    def __init__(self,datab):
        Gtk.VBox.__init__(self)
        self.set_border_width(6)

        wtab = Gtk.Table(3,2)
        wtab.set_row_spacings(6)
        wtab.set_col_spacings(6)
        wtab.set_homogeneous(False)
        label = Gtk.Label(_('Inicio: ')) 
        liststore,index = self.get_table_list(datab,boss.opts.database)
        table = create_combo_with_entry(liststore, editable=False)
        table.connect('changed',self.on_tables_changed)
        table.set_active(index)
        hb = Gtk.HBox(); hb.pack_end(label, False, False, 0)
        wtab.attach(hb,0,1,0,1)
        wtab.attach(table,1,2,0,1)
        
        label = Gtk.Label(_('Favoritos: ')) 
        liststore,index = self.get_table_list(datab,boss.opts.favourites)
        table = create_combo_with_entry(liststore, editable=False)
        table.connect('changed',self.on_fav_changed)
        if index > -1:
            table.set_active(index)
        
        hb = Gtk.HBox(); hb.pack_end(label, False, False, 0)
        wtab.attach(hb,0,1,1,2)
        wtab.attach(table,1,2,1,2)
        
        label = Gtk.Label(_('N. favoritos: ')) 
        nfav = int(boss.opts.nfav)
        adj = Gtk.Adjustment(nfav, 1, 10, 1, 1, 1)
        spin = Gtk.SpinButton()
        spin.set_adjustment(adj)
        spin.set_alignment(1.0)
        spin.connect('value-changed', self.on_spin_changed)
        hb = Gtk.HBox(); hb.pack_end(label, False, False, 0)
        wtab.attach(hb,0,1,2,3)
        wtab.attach(spin,1,2,2,3,xpadding=60)
        
        align = Gtk.Alignment.new(0.5, 0.5, 0.0, 0.0)
        align.add(wtab)
        self.pack_start(align, False, False, 0)

    def get_table_list(self,datab,default):
        liststore = Gtk.ListStore(str)
        tablelist = datab.get_databases() 
        for c in tablelist:
            liststore.append([c])
        index = -1
        for i,r in enumerate(liststore):
            if r[0] == default:
                index = i
                break 
        return (liststore,index)
    
    def on_tables_changed(self,combo):
        boss.opts.database = get_combo_active_text(combo)
    
    def on_fav_changed(self,combo):
        tbl = boss.opts.favourites = get_combo_active_text(combo) 
        nfav = int(boss.opts.nfav)
        curr.fav = curr.datab.get_favlist(tbl,nfav,curr.newchart()) 

    def on_spin_changed(self,spin):
        value = spin.get_value_as_int()
        boss.opts.nfav = value
        tbl = boss.opts.favourites 
        curr.fav = curr.datab.get_favlist(tbl,value,curr.newchart()) 
    
class ColorsPage(Gtk.VBox):
    def __init__(self):
        Gtk.VBox.__init__(self)
        self.set_border_width(6)
        self.color_buttons = {}
        cols = boss.get_colors()

        table = Gtk.Table(6,4) 
        labels = [(_("Fuego"),'fire'),(_("Tierra"),'earth'),
                (_("Aire"),'air'),(_("Agua"),'water'),
                (_("Pers."),'pers'),(_("Herr."),'tool'),
                (_("Trans."),'trans'),(_("Nodo"),'node'),
                (_("Conj."),'orange'),(_("Rojo"),'red'),
                (_("Azul"),'blue'),(_("Verde"),'green')]
        
        self.make_table(table,labels,4,cols) 
        table.set_col_spacing(1,3)
        table.set_col_spacing(3,3)
        table.set_row_spacing(3,6)
        self.pack_start(table, False, False, 0)

        table = Gtk.Table(4,3) 
        labels = [(_("Primera pers."),'click1'),(_("Segunda pers."),'click2'),
                (_("P. Inversion"),'inv'),(_("P. Reposo"),'low')]
        self.make_table(table,labels,2,cols) 
            
        lbl = Gtk.Label(_('Transitos'))
        lbl.set_alignment(0.0,0.5)
        trans_rgba = self.parse_rgba(cols['transcol'])
        colbut = Gtk.ColorButton()
        colbut.set_use_alpha(False)
        colbut.set_rgba(trans_rgba)
        colbut.connect('color_set',self.color_set_cb, 'transcol')
        table.attach(lbl,0,1,3,4)
        table.attach(colbut,1,2,3,4)
        table.set_col_spacings(10)
        self.pack_start(table, False, False, 0)

        buttbox = Gtk.HButtonBox()
        buttbox.set_layout(Gtk.ButtonBoxStyle.END) 
        button = Gtk.Button(_("Restablecer"))
        button.connect('clicked',self.color_reset)
        buttbox.pack_start(button, False, False, 0)
        self.pack_end(buttbox, False, False, 0)
    
    def make_table(self,table,labels,ix,cols):
        for i in range(len(labels)):
            lbl = Gtk.Label(labels[i][0])
            lbl.set_alignment(0.0,0.5)
            rgba = self.parse_rgba(cols[labels[i][1]])
            colbut = Gtk.ColorButton()
            colbut.set_use_alpha(False)
            colbut.set_rgba(rgba)
            self.color_buttons[labels[i][1]] = colbut  # Store reference
            colbut.connect('color_set',self.color_set_cb, labels[i][1])
            r = i % ix ; cc = (i / ix) * 2
            table.attach(lbl,cc,cc+1,r,r+1)
            table.attach(colbut,cc+1,cc+2,r,r+1)

    def color_set_cb(self,colbut,lbl):
        rgba = colbut.get_rgba()
        def to_hex(comp):
            return format(int(comp * 65535), '04x')
        r = to_hex(rgba.red)
        g = to_hex(rgba.green)
        b = to_hex(rgba.blue)
        cols = boss.get_colors()
        cols[lbl] = '#'+r+g+b
        setattr(boss.opts,lbl,r+g+b)
        if lbl in elem:
            boss.opts.zodiac.set_zodcolors()
        elif lbl in plan:
            boss.opts.zodiac.set_plancolors()
        elif lbl in asp:
            boss.opts.zodiac.set_aspcolors()
        elif lbl in aux:
            boss.opts.zodiac.set_auxcolors()
        boss.redraw()

    def color_reset(self,but):
        boss.reset_colors()
        boss.opts.zodiac.set_allcolors()
        boss.redraw()
        cols = boss.get_colors()
        for lbl, colbut in self.color_buttons.items():
            colbut.set_rgba(self.parse_rgba(cols[lbl]))

    def parse_rgba(self, color_value):
        rgba = Gdk.RGBA()
        text = color_value if isinstance(color_value, str) else str(color_value)
        if not text.startswith('#'):
            text = '#' + text
        rgba.parse(text)
        return rgba


class LinesPage(Gtk.VBox):
    def __init__(self):
        Gtk.VBox.__init__(self)
        self.set_border_width(6)

        buttbox = Gtk.HButtonBox()
        buttbox.set_layout(Gtk.ButtonBoxStyle.EDGE) 
        label = Gtk.Label(_("Base"))
        buttbox.pack_start(label, True, True, 0)
        base = float(boss.opts.base)
        adj = Gtk.Adjustment(base, 0.2, 2.4, 0.05, 0.1, 0)
        spin = Gtk.SpinButton()
        spin.set_adjustment(adj)
        spin.set_digits(2)
        spin.set_value(base)
        spin.connect('value-changed', self.line_set_cb)
        buttbox.pack_start(spin, True, True, 0)
        self.pack_start(buttbox, False, False, 0)

    def line_set_cb(self, spin):
        value = spin.get_value()
        boss.opts.base = value
        boss.redraw()

class FontsPage(Gtk.VBox):
    def __init__(self):
        Gtk.VBox.__init__(self)
        self.set_border_width(6)
        self.set_spacing(8)

        buttbox = Gtk.HButtonBox()
        buttbox.set_layout(Gtk.ButtonBoxStyle.SPREAD) 
        fontbutton = Gtk.FontButton(boss.opts.font)
        fontbutton.set_use_font(True)
        fontbutton.set_title(_("Elige una fuente"))
        fontbutton.connect('font-set', self.font_set_cb)
        buttbox.pack_start(fontbutton, True, True, 0)
        self.pack_start(buttbox, False, True, 0)
        
        font = Pango.FontDescription("Astro-Nex")
        buttbox = Gtk.HButtonBox() 
        buttbox.set_layout(Gtk.ButtonBoxStyle.SPREAD) 
        store = Gtk.ListStore(str)
        store.append([' z c '])
        store.append([' Z C '])
        combo = Gtk.ComboBox()
        combo.set_model(store)
        combo.set_border_width(3)
        cell = Gtk.CellRendererText()
        cell.set_property('font-desc',font)
        cell.set_property('alignment',Pango.Alignment.RIGHT)
        combo.pack_start(cell, True)
        combo.add_attribute(cell,'text',0) 
        combo.connect('changed',self.style_set_cb)
        style = [0,1][boss.opts.transtyle == 'classic' ] 
        combo.set_active(style)
        buttbox.pack_start(combo, False, True, 0) 
        self.pack_start(buttbox, False, False, 0)
    
    def font_set_cb(self, fontbutton):
        font = fontbutton.get_font_name()
        boss.opts.font = font
        boss.redraw()

    def style_set_cb(self,combo):
        s = ['huber','classic'][combo.get_active()]
        if s != boss.opts.transtyle:
            boss.opts.transtyle = s
            boss.opts.zodiac.swap_plan_style()
            zodiac = boss.opts.zodiac.__class__
            glyphs = zodiac.plan[:]
            boss.da.drawer.planetmanager.moon_f = glyphs[1]
            boss.da.drawer.planetmanager.moon_b = glyphs.pop()
            boss.da.drawer.planetmanager.glyphs = glyphs
            boss.da.redraw()

class OrbsPage(Gtk.VBox):
    def __init__(self):
        Gtk.VBox.__init__(self)
        self.set_border_width(6)

        hbox = Gtk.HBox()
        vbox = Gtk.VBox()
        vbox.set_border_width(4)
        vbox.set_size_request(54,-1)
        font = Pango.FontDescription("Astro-Nex")
        labs = ['','d,f', 'h,j,l', 'k,g','z,x,c']
        for l in labs:
            lbl = Gtk.Label(l)
            lbl.modify_font(font)
            vbox.pack_start(lbl,False,False,4)
        frame = Gtk.Frame()
        frame.add(vbox)
        hbox.pack_start(frame, False, False, 0)
        
        frame = Gtk.Frame()
        table = Gtk.Table(5,5)
        table.set_border_width(6)
        table.set_row_spacings(3)
        table.set_col_spacings(12) 
        frame.add(table)
        labs = ['2','36','4','5','17']
        for j,l in enumerate(labs):
            lbl = Gtk.Label(l)
            lbl.modify_font(font)
            table.attach(lbl,j,j+1,0,1)
        cat = ['lum','normal','short','far']
        for i,c in enumerate(cat):
            for j,o in enumerate(getattr(boss.opts,c)):
                lbl = Gtk.Label(o)
                table.attach(lbl,j,j+1,i+1,i+2)
        hbox.pack_start(frame, False, False, 0)
        align = Gtk.Alignment.new(0.5, 0.5, 0.0, 0.0)
        align.add(hbox)
        self.pack_start(align, False, False, 0)

class LangPage(Gtk.VBox):
    def __init__(self):
        self.langs = ['es','en','de','ca']
        init_lang = self.langs.index(boss.opts.lang)
        Gtk.VBox.__init__(self)
        self.set_border_width(6)

        buttbox = Gtk.HButtonBox()
        buttbox.set_layout(Gtk.ButtonBoxStyle.SPREAD) 
        label = Gtk.Label(_("Cambiar lenguage"))
        buttbox.pack_start(label, True, True, 0)
        
        store = Gtk.ListStore(str)
        store.append([_('espanol')])
        store.append([_('ingles')])
        store.append([_('aleman')])
        store.append([_('catalan')])
        combo = Gtk.ComboBox()
        combo.set_model(store)
        cell = Gtk.CellRendererText()
        combo.pack_start(cell, True)
        combo.add_attribute(cell,'text',0)
        combo.set_size_request(100,28)
        combo.connect('changed',self.lang_set_cb)
        combo.set_active(init_lang)
        buttbox.pack_start(combo, True, True, 0)
        self.pack_start(buttbox, False, False, 0)
        hbox = Gtk.HBox()
        align = Gtk.Alignment.new(0.5, 0.5, 0.0, 0.0)
        label = Gtk.Label(_("Los cambios tendran lugar depues de reiniciar la aplicacion"))
        label.set_size_request(300,-1)
        label.set_justify(Gtk.Justification.CENTER)
        label.set_line_wrap(True)
        align.add(label)
        hbox.pack_start(align, True, True, 0)
        hbox.set_border_width(6)
        self.pack_start(hbox, False, False, 0)

    def lang_set_cb(self,combo): 
        lang = self.langs[combo.get_active()]
        boss.opts.lang = lang
        #boss.app.langs[lang].install()

class PngPage(Gtk.VBox):
    def __init__(self):
        Gtk.VBox.__init__(self)
        self.set_border_width(6)

        buttbox = Gtk.HButtonBox()
        buttbox.set_layout(Gtk.ButtonBoxStyle.EDGE) 
        label = Gtk.Label(_("Horizontal"))
        buttbox.pack_start(label, True, True, 0)
        hdim = Gtk.Entry()
        hdim.set_text(str(boss.opts.hsize))
        lbl = 'hsize'
        hdim.connect('changed', self.png_set_cb,lbl)
        buttbox.pack_start(hdim, True, True, 0)
        self.pack_start(buttbox, False, False, 0)

        buttbox = Gtk.HButtonBox()
        buttbox.set_layout(Gtk.ButtonBoxStyle.EDGE) 
        label = Gtk.Label(_("Vertical"))
        buttbox.pack_start(label, True, True, 0)
        vdim = Gtk.Entry()
        vdim.set_text(str(boss.opts.vsize))
        lbl = 'vsize'
        vdim.connect('changed', self.png_set_cb,lbl)
        buttbox.pack_start(vdim, True, True, 0) 
        self.pack_start(buttbox, False, False, 0)

        buttbox = Gtk.HButtonBox()
        buttbox.set_layout(Gtk.ButtonBoxStyle.EDGE) 
        lcheck = Gtk.CheckButton(_("Etiquetas"))
        buttbox.pack_start(lcheck, True, True, 0)
        active = boss.opts.labels == 'true'
        lcheck.set_active(active)
        lcheck.connect('toggled', self.png_lbl_cb)
        self.pack_start(buttbox, False, False, 0)
    
    def png_set_cb(self,entry,lbl):
        opt = getattr(boss.opts,lbl)
        try:
            opt = int(entry.get_text())            
            setattr(boss.opts,lbl,opt)
        except ValueError:
            entry.set_text(str(opt)) 

    def png_lbl_cb(self,but):
        opt = ['false','true'][but.get_active()]
        boss.opts.labels = opt

