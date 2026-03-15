# -*- coding: utf-8 -*-
from . import gi_init  # Must be first!
from .extensions.path import path
from gi.repository import Gtk
from gi.repository import Gdk
from configobj import ConfigObj

default_colors = {'pers': 'ff5600', 'tool': '0000ff',
        'trans': '0000ff', 'node': '0000ff',
        'fire': 'dd0000', 'earth': '00bb00', 'air': 'ffb600',
        'water': '0000ff', 'orange': 'ff8000',
        'green': '00cc00', 'blue': '0000f7', 
        'red': 'ee0000', 'click1': '3300e6', 
        'click2': 'cc001a', 'inv': '7f7f99', 'low': '7f997f',
        'transcol': '7f7f99', 'overlay': '803480' ,'clicksoul': 'c227ff' }
COLORS = default_colors
PNG = {'hsize': 600, 'vsize': 600, 'labels': 'true' , 'pngviewer':'display', 'resolution': 300 }
PDF = {'pdfviewer': 'kpdf'}
LANG = { 'lang': 'es' }
FONT = { 'font': 'Sans 11' , 'transtyle':  'huber'} #'classic' 
LINES = { 'base': 0.85 }
ORBS = { 'transits': [1.0,1.0,1.0,1.0,1.0,2.0,2.0,2.0,2.0,2.0,1.0,1.0,1.0],
        'lum' :[3.0,5.0,6.0,8.0,9.0],
        'normal': [2.0,4.0,5.0,6.0,7.0],
        'short': [1.5,3.0,4.0,5.0,6.0],
        'far' : [1.0,2.0,3.0,4.0,5.0],
        'useless' : [1.0,2.0,2.0,3.0,4.0], 
        'pelum' :[3.0,5.0,6.0,8.0,9.0],
        'penormal': [2.0,4.0,5.0,6.0,7.0],
        'peshort': [1.5,3.0,4.0,5.0,6.0],
        'pefar' : [1.0,2.0,3.0,4.0,5.0],
        'peuseless' : [1.0,2.0,2.0,3.0,4.0], 
        'discard': []  }#[0,1,2,3,4,5]
DEFAULT = { 'usa': 'false', 'favourites': '', 'nfav': 3, 'aux_size': 800,
        'database' : 'personal', 'ephepath': 'ephe',
        'country' : 'SP', 'region': 53,
        'locality' :'Las Palmas de Gran Canaria' }

class NexConf(object):
    sections = { 'DEFAULT': DEFAULT, 'ORBS': ORBS,
            'COLORS': COLORS, 'LINES': LINES,
            'FONT': FONT, 'PNG': PNG, 'LANG': LANG , 'PDF': PDF}

    def __init__(self):
        for sec  in self.sections.values():
            self.__dict__.update(sec)
        import locale
        try:
            locale.setlocale(locale.LC_ALL, '')
        except Exception:
            pass
        try:
            lang = locale.getlocale()[0]
        except Exception:
            lang = None
        if lang:
            lang = lang.split('_')[0]
            if lang not in ['es','de','ca']:
                lang = 'en'
        else:
            lang = 'es'
        self.lang = lang

    def opts_to_config(self,config):
        for sec,val in self.sections.items():
            config[sec] = {}
            for s in val.keys():
                config[sec][s] = getattr(self,s)

cfgcols = {}

def _parse_color_components(value):
    rgba = Gdk.RGBA()
    if not rgba.parse(value):
        rgba.parse('#000000')
    return rgba.red, rgba.green, rgba.blue

def read_config(homedir):
    global cfgcols
    cfgfile = path.joinpath(homedir,'cfg.ini')
    conf = ConfigObj(cfgfile)
    popts = {}
    for k in conf.keys():
        popts.update(conf[k])

    if 'transits' in popts and not isinstance(popts['transits'],list):
        popts.pop('transits')

    opts = NexConf()
    opts.__dict__.update(popts)

    for keyc in default_colors.keys():
        val = getattr(opts,keyc)
        cfgcols[keyc] = ''.join(['#',val])

    if not path.exists(cfgfile) or len(opts.__dict__) != popts:
        opts.opts_to_config(conf)
        conf.write()

    return opts

def reload_config(conf,boss): 
    global cfgcols
    opts = boss.opts
    state = boss.state

    ephepath = path.joinpath(opts.home_dir,opts.ephepath)
    from pysw import setpath
    setpath(str(ephepath))

    if opts.favourites:
        try:
            tbl = opts.favourites
            nfav = int(opts.nfav)
            favs = state.datab.get_favlist(tbl,nfav,state.newchart())
            state.fav = favs
        except:
            pass
    
    popts = {}
    for k in conf.keys():
        popts.update(conf[k])
    opts.__dict__.update(popts)

    for keyc in default_colors.keys():
        val = getattr(opts,keyc)
        cfgcols[keyc] = ''.join(['#',val])

    from chart import orbs as ch_orbs
    orbs = [opts.lum,opts.normal,opts.short,opts.far,opts.useless]
    for l in orbs:
        state.orbs.append(list(map(float,l)))
        ch_orbs.append(list(map(float,l))) 
    peorbs = [opts.pelum,opts.penormal,opts.peshort,opts.pefar,opts.peuseless]
    for l in peorbs:
        state.peorbs.append(list(map(float,l)))
    if len(opts.transits) < 13:
        opts.transits = list(opts.transits) + [1.0] * (13 - len(opts.transits))
    for l in opts.transits:
        state.transits.append(float(l)) 
    opts.discard = [ int(x) for x in opts.discard ]

def parse_aux_colors():
    auxcol = {}
    for cl in 'click1','click2','clicksoul','inv','low','transcol':
        auxcol[cl] = _parse_color_components(cfgcols[cl])
    return auxcol
    
def parse_zod_colors():
    zodcol = [] 
    for cl in 'fire','earth','air','water':
        zodcol.append(_parse_color_components(cfgcols[cl])) 
    return zodcol

def parse_plan_colors():
    plancol = {}
    for cl in 'pers','tool','trans','node':
        plancol[cl] = _parse_color_components(cfgcols[cl])
    return plancol

def parse_asp_colors():
    aspcol = {}
    for cl in 'orange','green','blue','red':
        aspcol[cl] = _parse_color_components(cfgcols[cl])
    return aspcol

def reset_colors(opts):
    global cfgcols
    for keyc,val in default_colors.items():
        setattr(opts,keyc,val)
        cfgcols[keyc] = ''.join(['#',val])
