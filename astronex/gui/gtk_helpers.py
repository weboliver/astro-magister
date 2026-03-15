from gi.repository import Gtk


def create_combo_with_entry(model, text_column=0, editable=True):
    """Return a Gtk.ComboBox with an entry and the given model/text column."""
    combo = Gtk.ComboBox.new_with_model_and_entry(model)
    combo.set_entry_text_column(text_column)
    entry = combo.get_child()
    if entry is not None:
        entry.set_editable(editable)
    return combo


def get_combo_active_text(combo, text_column=0):
    """Fetch active text from a ComboBox-with-entry, falling back to entry text."""
    model = combo.get_model()
    itr = combo.get_active_iter()
    if itr is not None and model is not None:
        return model.get_value(itr, text_column)
    entry = combo.get_child()
    return entry.get_text() if entry is not None else None


def apply_bg_color(widget, color, class_name):
    """Apply a simple background color via CSS to avoid deprecated modify_bg/fg."""
    provider = Gtk.CssProvider()
    provider.load_from_data(f".{class_name} {{ background-color: {color}; }}".encode())
    context = widget.get_style_context()
    context.add_provider(provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
    context.add_class(class_name)
    return provider


def safe_show_all(widget, max_depth=None):
    """
    Safely show a widget and its children.
    For dialogs (no max_depth): uses show_all() 
    For main window (max_depth=3): uses limited recursion to avoid Gtk.Layout crash
    """
    if max_depth is None:
        # Simple dialogs without Gtk.Layout can use show_all()
        widget.show_all()
    else:
        # Main window with Gtk.Layout needs limited depth
        def show_recursive(w, depth):
            if depth > max_depth:
                return
            w.show()
            if hasattr(w, 'get_children'):
                for child in w.get_children():
                    show_recursive(child, depth + 1)
        
        show_recursive(widget, 0)
