# -*- coding: utf-8 -*-
import math
from datetime import datetime, timedelta, date, time
from pytz import timezone
RAD = math.pi / 180

class PersonInfo(object):
    count = 1
    def __init__(self):
        self.first = _("sin_nombre%d") % self.count
        self.last = ""

    def set_first(self,noname=False):
        if noname:
            self.first = ''
        else:
            self.first = _("sin_nombre%d") % self.count
            PersonInfo.count += 1


def degtodec(d):
    sign = 1
    if d.startswith('-'):
        sign = -sign
        d = d[1:]
    sec, rest = d[-2:], d[:-2]
    mint, deg = rest[-2:], rest[:-2]
    mint = int(mint) + int(sec)/60.0
    if not deg: deg = '0'
    deg = int(deg) + mint/60
    deg *= sign
    return deg

def dectodeg(d):
    import math
    sign = ''
    if d < 0 :  sign = '-'
    absd = abs(d)
    deg = int(math.floor(absd))
    rest = (absd - deg) * 60
    mint = int(math.floor(rest))
    sec = int(math.floor((rest - mint) * 60))
    return (sign+str(deg)+str(mint).zfill(2)+str(sec).zfill(2))

def parsestrtime(strdate):
    strdate = str(strdate or '')
    date, _, time = strdate.partition('T')
    date = "/".join(reversed(date.split('-'))) if date else ''

    base_time = time[:5] if len(time) >= 5 else '00:00'
    zone = time[8:] if len(time) > 8 else ''
    if not zone and len(time) > 5:
        zone = time[5:]

    zone = zone.strip()
    delta = '+00'

    if zone:
        if ':' in zone:
            maybe_delta = zone[:6]
            if len(maybe_delta) >= 6 and maybe_delta[0] in ['+', '-']:
                delta = maybe_delta
                zone = zone[6:]
            else:
                zone = zone
        else:
            maybe_delta = zone[:5]
            if len(maybe_delta) == 5 and maybe_delta[0] in ['+', '-'] and maybe_delta[1:5].isdigit():
                d1, d2 = maybe_delta[1:3], maybe_delta[3:5]
                delta = maybe_delta[0] + str(int(d1) + int(d2)).rjust(2, '0')
                zone = zone[5:]

    time = base_time + ' ' + delta + zone
    return (date, time)

        

def format_longitud(long):
    longitud = dectodeg(long)[:-2]
    if longitud[0] == '-':
        let = 'W'
        longitud = longitud[1:]
    else:
        let = 'E'
    return longitud[0:-2]+let+longitud[-2:]

def format_latitud(lat):
    latitud = dectodeg(lat)[:-2]
    if latitud[0] == '-':
        let = 'S'
        latitud = latitud[1:]
    else:
        let = 'N'
    return latitud[0:-2]+let+latitud[-2:]

def points_from_angle(angles):
    points = []
    for a in angles:
        points.append((math.cos(a*RAD),math.sin(a*RAD)))
    return points

def strdate_to_date(strdate):
    date,_,time = strdate.partition('T')
    try:
        y,mo,d = [ int(x) for x in date.split('-')]
    except ValueError:
        print(date)
    zone, time  = time[8:], time[:5]
    delta = '+00'
    tot = 0.0
    if zone:
        try:
            zone.index(':')
            candidate = zone[:6]
            if len(candidate) >= 6 and candidate[0] in ['+', '-']:
                delta = candidate
                d1, d2 = delta[1:3], delta[4:6]
                tot = int(d1)+int(d2)/60.0
        except ValueError:
            candidate = zone[:5]
            if len(candidate) == 5 and candidate[0] in ['+', '-'] and candidate[1:5].isdigit():
                delta = candidate
                d1, d2 = delta[1:3], delta[3:5]
                tot = int(d1)+int(d2)
    sign = {'+': 1, '-': -1}.get(delta[0], 1)
    delta = tot*sign
    h,m = [int(x) for x in time.split(':')]
    #h = (h + m/60.0) - delta
    #m = int((h - int(h))*60)
    dt = datetime(y,mo,d,int(h),m,0,tzinfo=timezone('UTC'))
    dt = datetime.combine(dt.date(),dt.time())
    return dt
