#!/usr/bin/python
from optparse import OptionParser
import sys
import os

# Add the project root to sys.path so relative imports work
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

parser = OptionParser()

parser.add_option("-c", "--console", action="store_true", default=False)
(options, args) = parser.parse_args()

from astronex.extensions.path import path
appath = path.getcwd() 
from astronex import nex
nex.main(appath,options.console)
