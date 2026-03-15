# -*- coding: utf-8 -*-
import os
import sys
from gi.repository import Gtk
import cairo
from gi.repository import Pango
from gi.repository import PangoCairo
from .. drawing.dispatcher import DrawMixin
from .. drawing.datasheets import labels
from .. boss import boss
curr = boss.get_state()
opts = boss.opts

version = boss.get_version()
PDFH = 845.04685*0.9

def draw_page(op,context,npages,boss):
    cr = context.get_cairo_context()

    w = 597.50787 # A4 points
    h = 845.04685

    if curr.opmode == 'double':
        w,h = h,w
    dr = DrawMixin(opts)
    
    if curr.opmode != 'simple':
        dr.dispatch_pres(cr,w,h)
    else:
        getattr(dr,curr.curr_op)(cr,w,h)

def printpage(boss, parent=None):
    filename = "test.pdf"
    print_ = Gtk.PrintOperation()
    print_.set_unit(Gtk.UNIT_POINTS)
    print_.set_n_pages(1)
    print_.set_export_filename(filename)

    print_.connect('draw_page', draw_page,boss)
    if parent is None:
        parent = getattr(boss, 'mainwin', None)
    res = print_.run(Gtk.PRINT_OPERATION_ACTION_PRINT, parent)
    return

