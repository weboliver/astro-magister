#!/usr/bin/python
# -*- coding: utf-8 -*-

# Suppress GTK3 warnings about calendar widget assertion errors
# The GTK3 Gtk.Calendar widget sometimes triggers assertion errors like:
# "calendar_invalidate_day_num: assertion 'row != -1' failed"
# This is a known GTK3 issue and doesn't affect functionality
import os
import warnings
warnings.filterwarnings('ignore')
os.environ['G_DEBUG'] = ''

from . import gi_init  # Initialize GObject Introspection for GTK3
import sys
import glob
import gettext
import atexit
from . import countries
from . config import read_config
from .gui.gtk_helpers import safe_show_all
domain = 'astronex'
localedir = './astronex/locale'
gettext.bindtextdomain(domain, localedir)
gettext.textdomain(domain)

lang_es = gettext.translation(domain, localedir, languages=['es'])
lang_en = gettext.translation(domain, localedir, languages=['en'])
lang_ca = gettext.translation(domain, localedir, languages=['ca'])
lang_de = gettext.translation(domain, localedir, languages=['de'])
langs = { 'en': lang_en, 'es': lang_es, 'ca': lang_ca, 'de': lang_de }

from astronex.extensions.path import path
version = "1.2"

def die(message):
    """Die in a command line way."""
    sys.exit(1)

try:
    import gi
    gi.require_version('Gtk', '3.0')
    from gi.repository import Gtk
    from gi.repository import Gdk
    from gi.repository import GObject as gobject
    from gi.repository import GdkPixbuf
except ImportError:
    die('Astro-Nex requires Python GTK bindings. They were not found.')


home_dir = '.astronex'
config_file = 'cfg.ini'
default_db = 'charts.db'
ephe_path = 'ephe'
ephe_flag = 4

def check_home_dir(appath):
    """Set home dir, copying needed files"""
    global home_dir, ephe_flag
    default_home = path.joinpath(path.expanduser(path('~')), home_dir)

    if not path.exists(default_home):
        path.mkdir(default_home, 2770)
    ephepath = path.joinpath(default_home,ephe_path)
    if not path.exists(ephepath):
        path.mkdir(path.joinpath(default_home,ephe_path), 2770)
        path.copy(path.joinpath(appath,"astronex/resources/README"),ephepath)
    if ephepath.glob("*.se1"):
        ephe_flag = 2
    if not path.exists(path.joinpath(default_home,default_db)):
        path.copy(path.joinpath(appath,"astronex/resources/charts.db"),default_home)

    home_dir = default_home


def init_config(homedir,opts,state):
    ephepath = path.joinpath(homedir,opts.ephepath)
    from pysw import setpath
    setpath(str(ephepath))

    state.country = opts.country
    state.usa = {'false':False,'true':True}[opts.usa]
    state.database = opts.database
    state.setloc(opts.locality,opts.region)
    state.init_nowchart()
    state.curr_chart = state.now
    state.epheflag = ephe_flag
    opts.epheflag = ephe_flag

    if opts.favourites:
        try:
            tbl = opts.favourites
            nfav = int(opts.nfav)
            favs = state.datab.get_favlist(tbl,nfav,state.newchart())
            state.fav = favs
        except:
            pass

    from . chart import orbs as ch_orbs
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

class Splash (Gtk.Window):
    def __init__(self,appath):
        Gtk.Window.__init__(self)
        self.set_decorated(False)
        self.set_type_hint(Gdk.WindowTypeHint.SPLASHSCREEN)
        self.set_default_size(400, 250)
        self.set_position (Gtk.WindowPosition.CENTER)
        vbox = Gtk.VBox()
        img = Gtk.Image()
        splashimg = path.joinpath(appath,"astronex/resources/splash.png")
        pixbuf = GdkPixbuf.Pixbuf.new_from_file(str(splashimg))
        img.set_from_pixbuf(pixbuf)
        vbox.pack_start(img, expand=True, fill=True, padding=0)
        self.add(vbox)
    
    def show_all(self):
        Gtk.Window.show_all(self)
        self.present()  # Ensure window is positioned correctly by window manager

def init_ipshell():
    ''' ipython suport (for linux)'''
    if sys.platform != 'win32':
        try:
            from IPython.terminal.embed import InteractiveShellEmbed
            from IPython.terminal.prompts import Prompts, Token
            
            # Modern IPython API (8.0+)
            shell = InteractiveShellEmbed(banner2='*** Nested interpreter ***')
            shell.user_ns = {}
            return shell
        except ImportError:
            # IPython not available or old version - return dummy shell
            class DummyShell:
                def __call__(self):
                    print("IPython not available. Install with: pip install ipython")
                    import code
                    code.interact(local=globals())
            return DummyShell()
    return None

class application(object):
    """The Nex Application."""

    def __init__(self,appath):
        self.home_dir = home_dir
        self.config_file = config_file
        self.default_db = default_db
        self.appath = appath
        self.version = version
        self.langs = langs

    def run(self):
        """Start Nex"""
        splash = Splash(self.appath)
        splash.show_all()
        gobject.timeout_add(1000, splash.hide) # 1 second
        gobject.idle_add(self.setup_app)
        Gtk.main()

    def run_console(self):
        opts = read_config(self.home_dir)
        opts.home_dir = self.home_dir
        langs[opts.lang].install()
        countries.install(opts.lang)
        self.lang = opts.lang
        from . state import Current
        from . boss import Manager
        state = Current(self)
        init_config(self.home_dir,opts,state)
        boss = Manager(self,opts,state)
        boss.ipshell = init_ipshell()
        boss.ipshell()

    def setup_app(self):
        opts = read_config(self.home_dir)
        opts.home_dir = self.home_dir
        langs[opts.lang].install()
        countries.install(opts.lang)
        self.lang = opts.lang
        from . state import Current
        from . boss import Manager
        state = Current(self)
        atexit.register(state.save_pool,self)
        init_config(self.home_dir,opts,state)
        boss = Manager(self,opts,state)
        from . gui.winnex import WinNex
        mainwin = WinNex(boss)
        boss.set_mainwin(mainwin)
        #if 'DEBUG_NEX' in os.environ:
        #    boss.ipshell = init_ipshell()

    def stop(self):
        """Stop Nex."""
        Gtk.main_quit()

def main(appath,console=False):
    # Enable Python fault handler for better crash diagnostics
    import faulthandler
    faulthandler.enable()
    
    # Set up enhanced error logging when DEBUG_NEX is set
    if 'DEBUG_NEX' in os.environ:
        import logging
        logging.basicConfig(
            level=logging.DEBUG,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('/tmp/astronex_debug.log'),
                logging.StreamHandler(sys.stderr)
            ]
        )
        logger = logging.getLogger('astronex')
        logger.info("Starting Astro-Nex in DEBUG mode...")
    
    check_home_dir(appath)
    app = application(appath)
    if console:
        app.run_console()
    else:
        app.run()

