# -*- coding: utf-8 -*-
from gi.repository import Gtk, Gdk
from .gtk_helpers import create_combo_with_entry, get_combo_active_text, safe_show_all
import sys,os,re
import pickle 
from .. extensions.path import path
from . searchview import SearchView

curr = None
boss = None
regex = re.compile("[A-Za-z][_A-Za-z0-9]*$")

class MixerPanel(Gtk.HBox):
    TARGETS = [
        ('MY_TREE_MODEL_ROW', Gtk.TargetFlags.SAME_WIDGET, 0),
        ('text/plain', 0, 1),
        ('TEXT', 0, 2),
        ('STRING', 0, 3),
        ]
    
    def __init__(self,parent):
        global curr,boss
        boss = parent.boss
        curr = boss.get_state()
        Gtk.HBox.__init__(self)
        self.views = {}
        self.menus = {}
        self.clip = None 
        self.changes = False

        hbox = Gtk.HBox()
        selector = self.make_tables_selector()
        hbox.pack_start(selector, False, False, 0)
        hbox.pack_start(Gtk.VSeparator(), False, False, 0)
        vbox = Gtk.VBox() 
        vbox.set_border_width(6)
        self.copy_button = Gtk.RadioButton.new_with_label(None, _('Copiar'))
        self.copy_button.connect('toggled',self.on_action_toggled)
        vbox.pack_start(self.copy_button, False, False, 0)
        self.move_button = Gtk.RadioButton.new_with_label_from_widget(self.copy_button, _('Mover'))
        self.move_button.connect('toggled',self.on_action_toggled)
        vbox.pack_start(self.move_button, False, False, 0) 
        align = Gtk.Alignment.new(0.5, 0.5, 0.0, 0.0)
        align.add(vbox)
        hbox.pack_start(align, False, False, 0)
        hbox.pack_start(Gtk.VSeparator(), False, False, 0)

        selector = self.make_tables_selector()
        hbox.pack_start(selector, False, False, 0)

        frame = Gtk.Frame()
        frame.add(hbox)
        frame.set_border_width(6)
        self.pack_start(frame, False, False, 0)
        #frame = Gtk.Frame()
        #frame.set_border_width(6)
        adminpanel = self.make_admin_panel()  
        #frame.add(adminpanel)
        #self.pack_start(frame, False, False, 0)
        self.pack_start(adminpanel, False, False, 0)

    def make_tables_selector(self): 
        vbox = Gtk.VBox()        
        liststore = Gtk.ListStore(str)
        tables = create_combo_with_entry(liststore, editable=False)
        tables.set_size_request(182,-1)
        tablelist = curr.datab.get_databases()
        
        for c in tablelist:
            liststore.append([c])
        index = 0
        for i,r in enumerate(liststore):
            if r[0] == curr.database:
                index = i
                break 
        tables.set_active(index) 
        
        but = Gtk.Button()
        img = Gtk.Image()
        appath = boss.app.appath
        imgfile = path.joinpath(appath,"astronex/resources/refresh-18.png")
        img.set_from_file(str(imgfile))
        but.set_image(img)
        but.connect('clicked',self.on_refresh_clicked,tables)
        hbox = Gtk.HBox()
        hbox.pack_start(tables, False, False, 0)
        hbox.pack_start(but, False, False, 0) 
        vbox.pack_start(hbox, False, False, 0)

        chartmodel = Gtk.ListStore(str,int)
        #chartview = Gtk.TreeView(chartmodel)
        chartview = SearchView(chartmodel)
        selection = chartview.get_selection()
        selection.set_mode(Gtk.SelectionMode.SINGLE)
        chartlist = curr.datab.get_chartlist(get_combo_active_text(tables))

        for c in chartlist:
            glue = ", "
            if c[2] == '':  glue = ''
            chartmodel.append([c[2]+glue+c[1],int(c[0])])
        
        cell = Gtk.CellRendererText()
        column = Gtk.TreeViewColumn(None,cell,text=0)
        chartview.append_column(column) 
        chartview.set_headers_visible(False)
        sel = chartview.get_selection()
        sel.set_mode(Gtk.SelectionMode.SINGLE)
        #sel.connect('changed',self.on_sel_changed)
        sel.select_path(0,)
        
        menu = Gtk.Menu()
        self.delete_menu_item = Gtk.MenuItem(_('Eliminar'))
        menu.append(self.delete_menu_item)
        self.delete_menu_item.connect('activate', self.on_menuitem_activate,chartview)
        self.delete_menu_item.show()
        self.undo_menu_item = Gtk.MenuItem(_('Deshacer'))
        menu.append(self.undo_menu_item)
        self.undo_menu_item.connect('activate', self.on_menuitem_activate,chartview)
        self.undo_menu_item.show()
        chartview.connect('button_press_event', self.on_view_clicked,menu)

        sw = Gtk.ScrolledWindow()
        sw.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        sw.add(chartview) 
        vbox.pack_start(sw, True, True, 0) 
        tables.connect('changed',self.on_tables_changed,chartview)
        vbox.set_size_request(210,-1)
        
        chartview.enable_model_drag_source( Gdk.ModifierType.BUTTON1_MASK,
                                                self.TARGETS,
                                                Gdk.DragAction.COPY)
        chartview.enable_model_drag_dest(self.TARGETS, Gdk.DragAction.DEFAULT)

        chartview.connect("drag_data_get", self.drag_data_get_data)
        chartview.connect("drag_data_received", self.drag_data_received_data)
        chartview.connect("row-activated", self.on_row_activated)
        self.views[chartview] = tables

        return vbox

    def on_action_toggled(self,but):
        action = 'move' if but is self.move_button else 'copy'
        action = [Gdk.DragAction.COPY, Gdk.DragAction.MOVE][action == 'move']
        for view in self.views:
            view.enable_model_drag_source(Gdk.ModifierType.BUTTON1_MASK,self.TARGETS,action)
            view.enable_model_drag_dest(self.TARGETS,action) 
    
    def on_row_activated(self,view,path,col):
        table = get_combo_active_text(self.views[view])
        self.parent.set_current_page(0)
        combo = self.parent.get_nth_page(0).tables
        model = combo.get_model()
        iter = model.get_iter_root()
        index = 0
        while iter:
            if model.get_value(iter,0) == table:
                index = int(model.get_path(iter)[0])
                break
            iter = model.iter_next(iter)
        combo.set_active(index)
        m,i = view.get_selection().get_selected()
        first,last = m.get_value(i,0).split(',')
        self.parent.get_nth_page(0).findchart(first,last)

    def on_view_clicked(self,view, event,menu):
        if event.type == Gdk.BUTTON_PRESS and event.button == 3:
            x = int(event.x)
            y = int(event.y)
            pthinfo = view.get_path_at_pos(x, y)
            if pthinfo is not None:
                path, col, cellx, celly = pthinfo
                view.grab_focus()
                view.set_cursor(path,col,0)
                if  self.clip is None:
                    menu.get_children()[1].set_sensitive(False)
                else:
                    menu.get_children()[1].set_sensitive(True)
                menu.popup_at_pointer(event)
            return True
    
    def on_menuitem_activate(self,menuitem,view): 
        op = 'delete' if menuitem is self.delete_menu_item else 'undo'
        table = self.views[view]
        tablename = get_combo_active_text(table)
        if op == 'delete':
            model,iter = view.get_selection().get_selected()
            id = model.get_value(iter,1)
            chart = curr.newchart()
            curr.datab.load_chart(tablename,id,chart)
            self.clip = chart
            if not self.safe_delete(tablename,id):
                return
            curr.datab.delete_chart(tablename,id)
            model.remove(iter)
        elif op == 'undo' and self.clip:
            rowid = self.new_chart(self.clip,tablename)
            if rowid: 
                model,iter = view.get_selection().get_selected()
                row = [", ".join([self.clip.last,self.clip.first]),rowid]
                path = model.get_path(iter)
                model.insert(int(path[0]),row)
                self.clip = None
        self.changes = True

    def on_refresh_clicked(self,but,combo):
        combo.emit('changed')

    def on_tables_changed(self,combo,chartview): 
        if combo.get_active() == -1: return
        if chartview:
            chartmodel = Gtk.ListStore(str,int)
            chartlist = curr.datab.get_chartlist(get_combo_active_text(combo)) 
            for c in chartlist:
                glue = ", "
                if not c[2]:  glue = ''
                chartmodel.append([c[2]+glue+c[1] , int(c[0]) ])
            chartview.set_model(chartmodel)
            chartview.get_selection().select_path(0,)
            self.views[chartview] = combo
    
    def drag_data_get_data(self,treeview,context,selection,target_id,etime):
        treeselection = treeview.get_selection()
        model, iter = treeselection.get_selected() 
        data = ";".join([model.get_value(iter, 0),str(model.get_value(iter, 1))])
        selection.set(selection.target, 8, data)

    def drag_data_received_data(self,treeview,context,x,y,selection,info,etime):
        for key in self.views.keys():
            if key == treeview:
                mytab = get_combo_active_text(self.views[key])
            else:
                othertab = get_combo_active_text(self.views[key])
        if mytab == othertab:
            return
        model = treeview.get_model()
        data = selection.data.split(";")
        srcid = int(data[-1])
        
        chart = curr.newchart()
        curr.datab.load_chart(othertab,srcid,chart)
        id = self.new_chart(chart,mytab)
        if not id:
            return
        data[-1] = id
        
        drop_info = treeview.get_dest_row_at_pos(x, y)
        if drop_info:
            path, position = drop_info
            iter = model.get_iter(path)
            if (position == Gtk.TREE_VIEW_DROP_BEFORE
                or position == Gtk.TREE_VIEW_DROP_INTO_OR_BEFORE):
                model.insert_before(iter, data)
            else:
                model.insert_after(iter, data)
        else:
            model.append(data)

        for key in self.views.keys():
            if key == treeview:
                mytab = get_combo_active_text(self.views[key])
            else:
                othertab = get_combo_active_text(self.views[key])
        self.changes = True
        if context.action == Gdk.ACTION_MOVE:
            context.finish(True, True, etime)
            if not self.safe_delete(othertab,srcid):
                return
            curr.datab.delete_chart(othertab,srcid)
        return

    def constrainterror_dlg(self,fi,la):
        msg = _("Una carta con este nombre: %s %s existe. Sobrescribir?") % (fi,la)
        dialog = Gtk.MessageDialog(None, Gtk.DIALOG_MODAL,
                Gtk.MESSAGE_WARNING,
                Gtk.BUTTONS_OK_CANCEL, msg);
        result = dialog.run()
        dialog.destroy()
        return result
    
    def new_chart(self,chart,table):
        from sqlite3 import DatabaseError
        try:
            lastrow = curr.datab.store_chart(table, chart) 
        except DatabaseError:
            result = self.constrainterror_dlg(chart.first,chart.last)
            if result != Gtk.ResponseType.OK:
                return None
            curr.datab.delete_chart_from_name(table,chart.first,chart.last)
            lastrow = curr.datab.store_chart(table, chart) 
            curr.fix_couples(table,chart.first,chart.last,lastrow)
        return lastrow
    
    def clear_selected(self, button):
        selection = self.treeview.get_selection()
        model, iter = selection.get_selected()
        if iter:
            model.remove(iter)
        return

    def make_admin_panel(self):
        appath = boss.app.appath
        thebox = Gtk.VBox()
        vbox = Gtk.VButtonBox()
        vbox.set_layout(Gtk.ButtonBoxStyle.SPREAD)
        vbox.set_border_width(3)
        
        #hbox = Gtk.HBox()
        #but = Gtk.Button(_('Compactar'))
        #but.connect('clicked',self.on_compact)
        #hbox.pack_start(but, True, True, 0)
        #vbox.pack_start(hbox, False, False, 0)

        hbox = Gtk.HBox()
        img = Gtk.Image()
        imgfile = path.joinpath(appath,"astronex/resources/gtk-new-18.png")
        img.set_from_file(imgfile)
        hbox.pack_start(img, True, True, 0)
        but = Gtk.Button(_('_Crear tabla'))
        but.connect('clicked',self.on_create_table)
        hbox.pack_start(but, True, True, 0)
        vbox.pack_start(hbox, False, False, 0)
        
        hbox = Gtk.HBox()
        img = Gtk.Image()
        imgfile = path.joinpath(appath,"astronex/resources/stock_delete.png")
        img.set_from_file(imgfile)
        hbox.pack_start(img, True, True, 0)
        but = Gtk.Button(_('E_liminar tabla'))
        but.connect('clicked',self.on_delete_table)
        hbox.pack_start(but, True, True, 0)
        vbox.pack_start(hbox, False, False, 0)
        
        hbox = Gtk.HBox()
        img = Gtk.Image()
        imgfile = path.joinpath(appath,"astronex/resources/gtk-convert-18.png")
        img.set_from_file(imgfile)
        hbox.pack_start(img, True, True, 0)
        but = Gtk.Button(_('_Renombrar'))
        but.connect('clicked',self.on_rename_table)
        hbox.pack_start(but, True, True, 0)
        vbox.pack_start(hbox, False, False, 0)
        
        frame = Gtk.Frame()
        frame.set_border_width(6)
        frame.add(vbox)
        thebox.pack_start(frame, True, True, 0)
        
        vbox = Gtk.VButtonBox()
        vbox.set_layout(Gtk.ButtonBoxStyle.SPREAD)
        vbox.set_border_width(3)
        
        hbox = Gtk.HBox()
        but = Gtk.Button(_('_Exportar  tabla'))
        but.connect('clicked',self.on_table_export)
        hbox.pack_start(but, True, True, 0)
        vbox.pack_start(hbox, False, False, 0)
        
        hbox = Gtk.HBox()
        but = Gtk.Button(_('_Importar  tabla'))
        but.connect('clicked',self.on_table_import)
        hbox.pack_start(but, True, True, 0)
        vbox.pack_start(hbox, False, False, 0)
        
        frame = Gtk.Frame()
        frame.set_border_width(6)
        frame.add(vbox)

        thebox.pack_start(frame, True, True, 0)
        return thebox

    def check_name(self,name):
        ok = regex.match(name)
        if not ok: 
            msg = [_("El nombre de las tablas solo puede comenzar con"),
                    _("'_' o letra*, seguida de letra*, numero o '_'."),
                    _("* A-Z, a-z, sin tildes ni caracteres compuestos") ]
            self.messagedialog("\n".join(msg))
        return ok

    def on_create_table(self,but):
        entry = Gtk.Entry()
        dialog = Gtk.Dialog(_("Nombre:"), None,
                Gtk.DIALOG_MODAL|Gtk.DIALOG_DESTROY_WITH_PARENT,
                (Gtk.STOCK_CANCEL, Gtk.RESPONSE_NONE,
                    Gtk.STOCK_OK, Gtk.ResponseType.OK))
        dialog.vbox.pack_end(entry, True, True, 0)
        entry.grab_focus()
        dialog.connect("response", self.create_response)
        dialog.show_all()
    
    def create_response(self,dialog,rid):
        if rid == Gtk.RESPONSE_NONE or rid == Gtk.ResponseType.DELETE_EVENT:
            dialog.destroy()
            return
        tablelist = curr.datab.get_databases() 
        new = dialog.vbox.get_children()[0].get_text()
        if not self.check_name(new):
            return 
        if new in tablelist:
            result = self.replacedialog(new)
            if result != Gtk.ResponseType.OK:
                return 
        #if not self.safe_delete_table(new):
        #    return
        curr.datab.create_table(new)
        self.relist(new)
        dialog.destroy()
    
    def replacedialog(self,tbl):
        msg = _("La tabla %s existe. Reemplazarla, perdiendo los datos?") % tbl
        dialog = Gtk.MessageDialog(None, Gtk.DIALOG_MODAL,
                Gtk.MESSAGE_WARNING,
                Gtk.BUTTONS_OK_CANCEL, msg);
        result = dialog.run()
        dialog.destroy()
        return result
    
    def relist(self,new):
        liststore = Gtk.ListStore(str)
        tablelist = curr.datab.get_databases() 
        for c in tablelist:
            liststore.append([c])
        index = 0
        for i,r in enumerate(liststore):
            if r[0] == new:
                index = i
                break 
        for key in self.views.keys():
            table = self.views[key]
            table.set_model(liststore)
        table.set_active(index)
        self.changes = True

    def on_delete_table(self,but): 
        dialog = Gtk.Dialog(_("Eliminar tabla"), None,
                Gtk.DIALOG_MODAL|Gtk.DIALOG_DESTROY_WITH_PARENT,
                (Gtk.STOCK_CANCEL, Gtk.RESPONSE_NONE,
                    Gtk.STOCK_OK, Gtk.ResponseType.OK))
        liststore = Gtk.ListStore(str)
        tables = create_combo_with_entry(liststore, editable=False)
        tables.set_size_request(250,-1)
        tablelist = curr.datab.get_databases() 
        for c in tablelist:
            liststore.append([c])
        tables.set_active(0) 
        dialog.vbox.pack_start(tables, True, True, 0)
        dialog.connect("response", self.delete_response)
        dialog.show_all()

    def delete_response(self,dialog,rid):
        if rid == Gtk.RESPONSE_NONE or rid == Gtk.ResponseType.DELETE_EVENT:
            dialog.destroy()
            return
        combo = dialog.vbox.get_children()[0]
        tbl = get_combo_active_text(combo)
        if tbl == boss.opts.database or tbl == boss.opts.favourites:
            self.messagedialog(_("No puedo eliminar una tabla predeterminada."))
            return
        if not self.safe_delete_table(tbl):
            return
        result = self.deletedialog(tbl)
        if result == Gtk.ResponseType.OK:
            curr.datab.delete_table(tbl)
            self.relist('')
            dialog.destroy()

    def messagedialog(self,msg):
        dialog = Gtk.MessageDialog(None, Gtk.DIALOG_MODAL,
                Gtk.MESSAGE_INFO,
                Gtk.BUTTONS_OK, msg);
        result = dialog.run()
        dialog.destroy()
    
    def deletedialog(self,tbl):
        msg = _("Desea realmente eliminar la tabla %s?") % tbl
        dialog = Gtk.MessageDialog(None, Gtk.DIALOG_MODAL,
                Gtk.MESSAGE_WARNING,
                Gtk.BUTTONS_OK_CANCEL, msg);
        result = dialog.run()
        dialog.destroy()
        return result

    def on_rename_table(self,but): 
        dialog = Gtk.Dialog(_("Cambiar nombre"), None,
                Gtk.DIALOG_MODAL|Gtk.DIALOG_DESTROY_WITH_PARENT,
                (Gtk.STOCK_CANCEL, Gtk.RESPONSE_NONE,
                    Gtk.STOCK_OK, Gtk.ResponseType.OK))
        liststore = Gtk.ListStore(str)
        tables = create_combo_with_entry(liststore, editable=False)
        tables.set_size_request(250,-1)
        tablelist = curr.datab.get_databases() 
        for c in tablelist:
            liststore.append([c])
        tables.set_active(0) 
        dialog.vbox.pack_start(tables, True, True, 0)
        entry = Gtk.Entry()
        entry.set_text(get_combo_active_text(tables))
        dialog.vbox.pack_start(entry, True, True, 0)
        tables.connect('changed',self.on_renamecombo_changed,entry)        
        dialog.connect("response", self.rename_response)
        dialog.show_all()

    def on_renamecombo_changed(self,combo,entry):
        entry.set_text(get_combo_active_text(combo)) 

    def rename_response(self,dialog,rid): 
        if rid == Gtk.RESPONSE_NONE or rid == Gtk.ResponseType.DELETE_EVENT:
            dialog.destroy()
            return
        oldname = get_combo_active_text(dialog.vbox.get_children()[0])
        newname = dialog.vbox.get_children()[1].get_text()
        if oldname == boss.opts.database or oldname == boss.opts.favourites:
            self.messagedialog(_("No puedo cambiar el nombre a una tabla predeterminada."))
            return
        if not self.safe_delete_table(oldname):
            return
        if not self.check_name(newname):
            return 
        curr.datab.rename_chart(oldname,newname)
        self.relist(newname)
        dialog.destroy()

    def on_table_export(self,but):
        dialog = Gtk.Dialog(_("Exportar tabla"), None,
                Gtk.DIALOG_MODAL|Gtk.DIALOG_DESTROY_WITH_PARENT,
                (Gtk.STOCK_CANCEL, Gtk.RESPONSE_NONE,
                    Gtk.STOCK_OK, Gtk.ResponseType.OK))
        liststore = Gtk.ListStore(str)
        tables = create_combo_with_entry(liststore, editable=False)
        tables.set_size_request(250,-1)
        tablelist = curr.datab.get_databases() 
        for c in tablelist:
            liststore.append([c])
        tables.set_active(0) 
        dialog.vbox.pack_start(tables, True, True, 0)
        dialog.connect("response", self.export_response)
        dialog.show_all()

    def export_response(self,dialog,rid):
        if rid == Gtk.RESPONSE_NONE or rid == Gtk.ResponseType.DELETE_EVENT:
            dialog.destroy()
            return
        table = get_combo_active_text(dialog.vbox.get_children()[0])

        if sys.platform == 'win32':
            import winshell
            folder = winshell.my_documents() + os.path.sep 
        else: 
            folder = os.path.expanduser("~") + os.path.sep
        name = folder + table + ".nxt"
        export = []
        
        chartlist = curr.datab.get_chartlist(table) 
        for c in chartlist:
            id = int(c[0])
            chart = curr.newchart()
            curr.datab.load_chart(table,id,chart)
            export.append(chart)
        
        output = open(name, 'wb')
        pickle.dump(export,output,-1)
        output.close()
        dialog.destroy()

    def on_table_import(self,but): 
        dialog = Gtk.Dialog(_("Importar tabla"), None,
                Gtk.DIALOG_MODAL|Gtk.DIALOG_DESTROY_WITH_PARENT,
                (Gtk.STOCK_CANCEL, Gtk.RESPONSE_NONE,
                    Gtk.STOCK_OK, Gtk.ResponseType.OK))
        
        table = Gtk.Table(2,3,False)
        table.set_col_spacings(3)
        lbl = Gtk.Label(_('Archivo'))
        table.attach(lbl,0,1,0,1)
        entry = Gtk.Entry()
        table.attach(entry,1,2,0,1)
        but = Gtk.Button(_('Examinar'))
        table.attach(but,2,3,0,1)
        tname = Gtk.Label(_('Tabla'))
        table.attach(tname,0,1,1,2)
        tentry = Gtk.Entry()
        table.attach(tentry,1,2,1,2)
        info = Gtk.Label()
        table.attach(info,2,3,1,2)
        dialog.vbox.pack_start(table, False, False, 0)
        but.connect('clicked',self.on_filebrowse,entry,tentry)

        dialog.connect("response", self.import_response,entry,tentry,info)
        dialog.show_all()
        
    def import_response(self,dialog,rid,entry,tentry,info):
        if rid == Gtk.RESPONSE_NONE or rid == Gtk.ResponseType.DELETE_EVENT:
            dialog.destroy()
            return 
        elif rid == Gtk.ResponseType.OK:
            name = tentry.get_text()
            if not self.check_name(name):
                return 
            tablelist = curr.datab.get_databases() 
            if name in tablelist:
                result = self.replacedialog(name)
                if result != Gtk.ResponseType.OK:
                    return 
            filename = entry.get_text()
            try:
                input = open(filename,'rb')
                imported = pickle.load(input)
            except IOError:
                self.messagedialog(_('Error abriendo el archivo'))
                return 
            except:
                self.messagedialog(_('Error importando la tabla'))
                return 
            curr.datab.create_table(name) 
            li = len(imported) 
            info.set_text('(%s)' % (li))
            for i,data in enumerate(imported):
                self.new_chart(data,name) 
                info.set_text(_('%s de %s') % (i,li))
                while (Gtk.events_pending()):
                    Gtk.main_iteration()
            self.relist('') 
            dialog.destroy()
            return

    def on_filebrowse(self,but,entry,tentry):
        dialog = Gtk.FileChooserDialog("Abrir archivo...",
                                    None,
                                    Gtk.FileChooserAction.OPEN,
                                    (Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL,
                                        Gtk.STOCK_OPEN, Gtk.ResponseType.OK))
        dialog.set_default_response(Gtk.ResponseType.OK)

        if sys.platform == 'win32':
            import winshell
            dialog.set_current_folder(winshell.my_documents())
        else: 
            dialog.set_current_folder(os.path.expanduser("~"))

        filename = None
        response = dialog.run()
        if response == Gtk.ResponseType.OK:
            filename = dialog.get_filename()
            entry.set_text(filename) 
            name = os.path.basename(os.path.splitext(filename)[0])
            tentry.set_text(name) 
        elif response == Gtk.ResponseType.CANCEL:
            pass
        dialog.destroy()
        return

    def on_compact(self,but):
        curr.datab.vacuum()

    def safe_delete(self,table,id): 
        if not curr.safe_delete_chart(table,id):
            msg = _('No puedo eliminar una carta con pareja!' )
            dialog = Gtk.MessageDialog(None, Gtk.DIALOG_MODAL,
                    Gtk.MESSAGE_WARNING,
                    Gtk.BUTTONS_OK, msg);
            result = dialog.run()
            dialog.destroy()
            return False
        return True

    def safe_delete_table(self,table):
        if not curr.safe_delete_table(table):
            msg = _('No puedo eliminar una tabla con pareja!' )
            dialog = Gtk.MessageDialog(None, Gtk.DIALOG_MODAL,
                    Gtk.MESSAGE_WARNING,
                    Gtk.BUTTONS_OK, msg);
            result = dialog.run()
            dialog.destroy()
            return False
        return True
